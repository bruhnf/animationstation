import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import * as Sentry from '@sentry/node';
import { getStripe, isStripeConfigured } from '../services/stripeService';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { getStripeProduct } from '../config/stripeProducts';
import { createChildLogger } from '../services/logger';
import { resetUserThrottle } from '../services/throttleService';

const router = Router();
const log = createChildLogger('StripeWebhook');

// Prisma unique-constraint violation — same idempotency pattern as
// /api/credits/verify-receipt: a retried webhook delivery for a Checkout
// Session we've already processed hits the unique index on
// stripeCheckoutSessionId instead of double-granting.
function isUniqueConstraintError(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002'
  );
}

// POST /api/webhooks/stripe
//
// Endpoint configured in the Stripe Dashboard (or `stripe listen` for local
// dev) → Webhooks → this URL, subscribed to: checkout.session.completed,
// customer.subscription.updated, customer.subscription.deleted.
//
// Mounted in index.ts with express.raw() BEFORE the global express.json() —
// Stripe's signature check needs the exact raw request body bytes.
router.post('/stripe', async (req: Request, res: Response) => {
  if (!isStripeConfigured()) {
    res.status(503).end();
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    log.warn('Stripe webhook hit without stripe-signature header', { ip: req.ip });
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, env.stripe.webhookSecret);
  } catch (err) {
    log.error('Stripe webhook signature verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      default:
        // We only need the events above; Stripe may deliver others depending on
        // Dashboard config. Not an error — just nothing to do.
        log.info('Unhandled Stripe event type', { type: event.type });
    }
    res.status(200).end();
  } catch (err) {
    log.error('Stripe webhook handler failed', {
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    Sentry.captureException(
      err instanceof Error ? err : new Error('Stripe webhook handler failed'),
      {
        tags: { area: 'stripe-webhook' },
        extra: { type: event.type },
      },
    );
    // 500 so Stripe retries — a dropped webhook here means a missed
    // credit/tier grant, same revenue-critical class as the Apple webhook.
    res.status(500).json({ error: 'processing failed' });
  }
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId || session.client_reference_id || undefined;
  const productKey = session.metadata?.productKey;
  if (!userId || !productKey) {
    log.warn('Checkout session missing userId/productKey metadata', { sessionId: session.id });
    return;
  }

  const product = getStripeProduct(productKey);
  if (!product) {
    log.warn('Checkout session productKey not in catalog', { sessionId: session.id, productKey });
    return;
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customerId) {
    log.warn('Checkout session missing customer id', { sessionId: session.id });
    return;
  }

  try {
    if (product.kind === 'credits') {
      await prisma.$transaction([
        prisma.stripePurchase.create({
          data: {
            userId,
            stripeCheckoutSessionId: session.id,
            stripeCustomerId: customerId,
            productKey,
            type: 'CREDITS',
            credits: product.credits,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { credits: { increment: product.credits } },
        }),
        prisma.creditTransaction.create({
          data: {
            userId,
            type: 'PURCHASE',
            amount: product.credits,
            description: `Stripe: ${productKey} (+${product.credits} credits)`,
          },
        }),
      ]);
      log.info('Credit pack granted via Stripe checkout', {
        userId,
        productKey,
        credits: product.credits,
        sessionId: session.id,
      });
    } else {
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      await prisma.$transaction([
        prisma.stripePurchase.create({
          data: {
            userId,
            stripeCheckoutSessionId: session.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId ?? null,
            productKey,
            type: 'SUBSCRIPTION',
            tier: product.tier,
            subscriptionStatus: 'active',
          },
        }),
        prisma.user.update({ where: { id: userId }, data: { tier: product.tier } }),
      ]);
      log.info('Subscription granted via Stripe checkout', {
        userId,
        productKey,
        tier: product.tier,
        sessionId: session.id,
      });
    }
    void resetUserThrottle(userId);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      log.info('Stripe checkout session already processed — skipping', { sessionId: session.id });
      return;
    }
    throw err;
  }
}

const ACTIVE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    log.warn('Subscription event missing userId metadata', { subscriptionId: subscription.id });
    return;
  }

  const productKey = subscription.metadata?.productKey;
  const product = getStripeProduct(productKey);
  const status = subscription.status;
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end
    ? new Date(subscription.items.data[0].current_period_end * 1000)
    : null;

  await prisma.stripePurchase.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: { subscriptionStatus: status, currentPeriodEnd },
  });

  // Same last-webhook-wins model the existing Apple integration uses for
  // User.tier — a user actively subscribed on BOTH platforms at once is an
  // unsupported edge case, not handled here.
  if (ACTIVE_STATUSES.has(status) && product?.kind === 'subscription') {
    await prisma.user.update({ where: { id: userId }, data: { tier: product.tier } });
  } else {
    await prisma.user.update({ where: { id: userId }, data: { tier: 'FREE' } });
  }

  log.info('Stripe subscription status synced', {
    userId,
    subscriptionId: subscription.id,
    status,
  });
}

export default router;
