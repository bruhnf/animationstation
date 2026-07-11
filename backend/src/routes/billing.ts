import { Router, Request, Response } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import prisma from '../lib/prisma';
import {
  getStripe,
  isStripeConfigured,
  getOrCreateStripeCustomerId,
} from '../services/stripeService';
import { getStripeProduct, creditPackPriceCents } from '../config/stripeProducts';
import { env } from '../config/env';
import { createChildLogger } from '../services/logger';

const router = Router();
const log = createChildLogger('BillingRoute');

router.use(requireAuth, blockGuests);

// Middleware for this router only: fail clearly (503, not a crash) if the
// deployment has no Stripe key configured — lets the rest of the app run
// fine on a box that hasn't been set up for web purchases yet.
router.use((req: Request, res: Response, next) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: 'Web purchases are not available right now.' });
    return;
  }
  next();
});

// Create a Stripe Checkout Session for a credit pack or subscription plan.
// Web-only counterpart to POST /api/credits/verify-receipt. The client
// redirects the browser to the returned `url`; Stripe redirects back to
// success/cancel URLs on the website, and the actual entitlement is granted
// by the /api/webhooks/stripe handler once payment is confirmed — never by
// this route, so a user can't grant themselves credits by hitting
// success_url directly.
router.post('/checkout', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { product: productKey } = req.body as { product?: string };
  const product = getStripeProduct(productKey);
  if (!product) {
    res.status(400).json({ error: 'Unknown product' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, tier: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomerId(user.id);
  const successUrl = `${env.websiteUrl}/account.html?checkout=success`;
  const cancelUrl = `${env.websiteUrl}/account.html?checkout=cancelled`;

  try {
    if (product.kind === 'credits') {
      const amount = creditPackPriceCents(product.credits, user.tier);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        client_reference_id: user.id,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: { name: `${product.credits} AnimationStation Credits` },
            },
          },
        ],
        metadata: { userId: user.id, productKey: productKey as string },
      });
      res.json({ url: session.url });
      return;
    }

    // Subscription
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: product.unitAmountCents,
            recurring: { interval: 'month' },
            product_data: {
              name: `AnimationStation ${product.tier === 'BASIC' ? 'Basic' : 'Premium'}`,
            },
          },
        },
      ],
      subscription_data: { metadata: { userId: user.id, productKey: productKey as string } },
      metadata: { userId: user.id, productKey: productKey as string },
    });
    res.json({ url: session.url });
  } catch (err) {
    log.error('Failed to create Checkout Session', {
      userId: user.id,
      productKey,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

// Stripe Billing Portal — lets a user update payment method, view invoices,
// or cancel a web subscription themselves, mirroring the "manage in App
// Store" link Apple subscribers use.
router.get('/portal', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    res.status(404).json({ error: 'No billing account on file' });
    return;
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${env.websiteUrl}/account.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    log.error('Failed to create Billing Portal session', {
      userId: req.user.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Could not open billing portal' });
  }
});

export default router;
