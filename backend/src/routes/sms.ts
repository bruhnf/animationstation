import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { createChildLogger } from '../services/logger';

const router = Router();
const log = createChildLogger('SmsOptIn');

// Snapshot of the consent language shown on the website opt-in form (/sms.html).
// Stored with each opt-in so we have a record of exactly what the user agreed to.
const CONSENT_TEXT =
  'I agree to receive recurring automated text messages (account notifications, ' +
  'security alerts, and one-time passcodes) from AnimationStation at the mobile number ' +
  'provided. Consent is not a condition of any purchase. Message frequency varies. ' +
  'Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.';

// US E.164 only (matches the website form, which normalizes to +1XXXXXXXXXX).
const E164_US = /^\+1\d{10}$/;

/**
 * Public SMS opt-in. No auth — website visitors are not logged in.
 * Rate-limited at the app level (see smsOptInLimiter in index.ts).
 * Idempotent on phoneNumber: re-opting-in updates the existing row.
 */
router.post('/opt-in', async (req: Request, res: Response) => {
  const { phoneNumber, consent, source } = req.body ?? {};

  if (consent !== true) {
    res.status(400).json({ error: 'Consent is required to opt in.' });
    return;
  }
  if (typeof phoneNumber !== 'string' || !E164_US.test(phoneNumber)) {
    res.status(400).json({ error: 'A valid U.S. mobile number is required.' });
    return;
  }

  const cleanSource = typeof source === 'string' ? source.slice(0, 64) : null;
  const ipAddress = (req.ip || '').slice(0, 64) || null;

  try {
    await prisma.smsOptIn.upsert({
      where: { phoneNumber },
      create: {
        phoneNumber,
        consent: true,
        consentText: CONSENT_TEXT,
        source: cleanSource,
        ipAddress,
      },
      update: {
        consent: true,
        consentText: CONSENT_TEXT,
        source: cleanSource,
        ipAddress,
        optedInAt: new Date(),
        optedOutAt: null,
      },
    });

    // Log a masked number only — never the full PII in logs.
    log.info('SMS opt-in recorded', {
      phoneSuffix: phoneNumber.slice(-4),
      source: cleanSource,
    });

    res.json({ optedIn: true });
  } catch (err: any) {
    log.error('SMS opt-in failed', { error: err.message });
    res.status(500).json({ error: 'Could not record opt-in. Please try again.' });
  }
});

export default router;
