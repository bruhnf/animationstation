import { UserTier } from '@prisma/client';
import { TIER_CONFIG } from '../services/tierService';

// Catalog of everything sold via Stripe Checkout on the website — the
// web-only counterpart to config/appleIap.ts. Prices are NOT pre-created
// Stripe Price objects; we pass Checkout Session `price_data` inline (see
// services/stripeService.ts), so this file is the single source of truth for
// dollar amounts. Keep credit-pack pricing here in sync with TIER_CONFIG's
// creditPrice — a web credit pack costs the same per credit as the same-tier
// Apple IAP credit pack.

export type StripeProduct =
  | { kind: 'subscription'; tier: UserTier; unitAmountCents: number }
  | { kind: 'credits'; credits: number };

// Monthly subscription prices (USD), matching App Store Connect pricing so a
// user pays the same whether they subscribe on web or in the app.
const SUBSCRIPTION_PRICE_CENTS: Record<Extract<UserTier, 'BASIC' | 'PREMIUM'>, number> = {
  BASIC: 999,
  PREMIUM: 1999,
};

export const STRIPE_PRODUCTS: Record<string, StripeProduct> = {
  'subscription.basic': {
    kind: 'subscription',
    tier: 'BASIC',
    unitAmountCents: SUBSCRIPTION_PRICE_CENTS.BASIC,
  },
  'subscription.premium': {
    kind: 'subscription',
    tier: 'PREMIUM',
    unitAmountCents: SUBSCRIPTION_PRICE_CENTS.PREMIUM,
  },
  'credits.10': { kind: 'credits', credits: 10 },
  'credits.25': { kind: 'credits', credits: 25 },
  'credits.50': { kind: 'credits', credits: 50 },
  'credits.100': { kind: 'credits', credits: 100 },
};

export function getStripeProduct(productKey: string | undefined | null): StripeProduct | null {
  if (!productKey) return null;
  return STRIPE_PRODUCTS[productKey] ?? null;
}

// A credit pack's total price depends on the buyer's CURRENT tier (Premium
// subscribers pay less per credit — same discount structure as the Apple IAP
// tier-variant packs). Returns whole cents, rounded to avoid float drift.
export function creditPackPriceCents(credits: number, tier: UserTier): number {
  return Math.round(credits * TIER_CONFIG[tier].creditPrice * 100);
}
