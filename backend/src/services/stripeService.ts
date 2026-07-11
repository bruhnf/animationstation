import Stripe from 'stripe';
import { env } from '../config/env';
import prisma from '../lib/prisma';

// Single Stripe client for the whole process. Constructed lazily (not at
// import time) so a dev box without STRIPE_SECRET_KEY set can still boot and
// run everything except web purchases — the routes throw a clear 503 instead
// of crashing the server at startup.
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!env.stripe.secretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }
  if (!_stripe) {
    _stripe = new Stripe(env.stripe.secretKey);
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!env.stripe.secretKey;
}

// Returns the user's Stripe Customer id, creating (and persisting) one on
// first use. A user who only ever buys via Apple IAP never gets a Stripe
// customer at all.
export async function getOrCreateStripeCustomerId(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, username: true, stripeCustomerId: true },
  });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    name: user.username,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}
