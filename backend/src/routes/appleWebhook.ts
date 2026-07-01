import { Router, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { verifyAndDecodeNotification } from '../services/appleNotificationService';
import { enqueueAppleNotification } from '../queue/appleNotificationQueue';
import { env } from '../config/env';
import { createChildLogger } from '../services/logger';
import { describeAppleVerifyError } from '../utils/appleVerifyStatus';

const router = Router();
const log = createChildLogger('AppleWebhook');

// POST /api/webhooks/apple
//
// Endpoint Apple posts App Store Server Notifications V2 to.
// Configure this URL in App Store Connect:
//   App Information → App Store Server Notifications → Production / Sandbox URL
//
// Apple's contract:
//   - Body is JSON: { "signedPayload": "<JWS string>" }
//   - We must verify the JWS against Apple's CA chain before trusting it.
//   - We must respond 2xx fast (Apple retries on non-2xx with backoff).
// Heavy work is delegated to the BullMQ apple-notifications worker.
router.post('/apple', async (req: Request, res: Response) => {
  const signedPayload = req.body?.signedPayload;
  if (!signedPayload || typeof signedPayload !== 'string') {
    log.warn('Apple webhook hit without signedPayload', { ip: req.ip });
    res.status(400).json({ error: 'signedPayload required' });
    return;
  }

  try {
    // Verify + decode synchronously so we can reject malformed/forged payloads
    // with a 400 (Apple should not retry those). Once verified, queue the heavy
    // work and ack immediately.
    const decoded = await verifyAndDecodeNotification(signedPayload);

    // Reject notifications from the wrong environment (e.g. Sandbox payload
    // delivered to Production URL or vice versa) — usually a misconfiguration.
    const expectedEnv = env.apple.environment;
    if (decoded.data?.environment && decoded.data.environment !== expectedEnv) {
      log.warn('Apple notification environment mismatch', {
        expected: expectedEnv,
        received: decoded.data.environment,
        notificationUUID: decoded.notificationUUID,
      });
      // Still 200 so Apple doesn't retry forever; we just don't process it.
      res.status(200).end();
      return;
    }

    if (!decoded.notificationUUID) {
      log.error('Apple notification missing notificationUUID', { decoded });
      res.status(400).json({ error: 'malformed notification' });
      return;
    }

    await enqueueAppleNotification({
      signedPayload,
      notificationUUID: decoded.notificationUUID,
      signedDate: decoded.signedDate ?? Date.now(),
    });

    log.info('Apple notification enqueued', {
      notificationUUID: decoded.notificationUUID,
      notificationType: decoded.notificationType,
      subtype: decoded.subtype,
      environment: decoded.data?.environment,
    });

    res.status(200).end();
  } catch (err) {
    // VerificationException has an EMPTY message — describeAppleVerifyError
    // surfaces the status enum (the actual reason). A failure here means a
    // purchase/renewal notification is being DROPPED, so page via Sentry too.
    log.error('Apple webhook verification failed', { ...describeAppleVerifyError(err) });
    Sentry.captureException(
      err instanceof Error ? err : new Error('Apple webhook verification failed'),
      { tags: { area: 'apple-webhook' }, extra: describeAppleVerifyError(err) },
    );
    // 400, not 500 — Apple should not retry an unverifiable payload.
    res.status(400).json({ error: 'verification failed' });
  }
});

export default router;
