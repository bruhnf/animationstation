import { UserTier } from '@prisma/client';

// Configuration for every Apple In-App Purchase product we sell.
// Keep in sync with the Product IDs configured in App Store Connect.
//
// Product IDs carry NO version suffix — they match the IDs created in App
// Store Connect for the ai.animationstation.app bundle exactly. If an IAP ever
// gets stuck in "Needs Developer Attention" and must be reissued, note that App
// Store Connect treats deleted product IDs as permanently burned (they can
// never be recreated), so a reissue needs a NEW id (e.g. a `.v2` suffix) —
// update both this map and frontend/app.json in lockstep when that happens.
//
// Credit packs: there are 4 sizes (10 / 25 / 50 / 100) and 3 tier variants
// per size (free / basic / premium), for a total of 12 consumable SKUs.
// Every variant of the same size grants the SAME number of credits — the
// tier suffix only affects the price set in App Store Connect (Free pays
// the most per credit, Premium the least). The mobile client is responsible
// for offering only the variant that matches the user's current tier.

export type AppleProduct =
  | { type: 'subscription'; tier: UserTier }
  | { type: 'credits'; credits: number; tierVariant: UserTier };

export const PRODUCTS: Record<string, AppleProduct> = {
  // Auto-renewing subscriptions
  'ai.animationstation.app.basic.monthly': { type: 'subscription', tier: 'BASIC' },
  'ai.animationstation.app.premium.monthly': { type: 'subscription', tier: 'PREMIUM' },

  // Consumable credit packs — Free-tier prices (most expensive)
  'ai.animationstation.app.credits.10.free': {
    type: 'credits',
    credits: 10,
    tierVariant: 'FREE',
  },
  'ai.animationstation.app.credits.25.free': {
    type: 'credits',
    credits: 25,
    tierVariant: 'FREE',
  },
  'ai.animationstation.app.credits.50.free': {
    type: 'credits',
    credits: 50,
    tierVariant: 'FREE',
  },
  'ai.animationstation.app.credits.100.free': {
    type: 'credits',
    credits: 100,
    tierVariant: 'FREE',
  },

  // Consumable credit packs — Basic-tier prices
  'ai.animationstation.app.credits.10.basic': {
    type: 'credits',
    credits: 10,
    tierVariant: 'BASIC',
  },
  'ai.animationstation.app.credits.25.basic': {
    type: 'credits',
    credits: 25,
    tierVariant: 'BASIC',
  },
  'ai.animationstation.app.credits.50.basic': {
    type: 'credits',
    credits: 50,
    tierVariant: 'BASIC',
  },
  'ai.animationstation.app.credits.100.basic': {
    type: 'credits',
    credits: 100,
    tierVariant: 'BASIC',
  },

  // Consumable credit packs — Premium-tier prices (cheapest)
  'ai.animationstation.app.credits.10.premium': {
    type: 'credits',
    credits: 10,
    tierVariant: 'PREMIUM',
  },
  'ai.animationstation.app.credits.25.premium': {
    type: 'credits',
    credits: 25,
    tierVariant: 'PREMIUM',
  },
  'ai.animationstation.app.credits.50.premium': {
    type: 'credits',
    credits: 50,
    tierVariant: 'PREMIUM',
  },
  'ai.animationstation.app.credits.100.premium': {
    type: 'credits',
    credits: 100,
    tierVariant: 'PREMIUM',
  },
};

export function getProduct(productId: string | undefined | null): AppleProduct | null {
  if (!productId) return null;
  return PRODUCTS[productId] ?? null;
}

// Backwards-compatible helper used by code that only cares about subscription tier.
export function tierForProductId(productId: string | undefined | null): UserTier | null {
  const product = getProduct(productId);
  return product?.type === 'subscription' ? product.tier : null;
}
