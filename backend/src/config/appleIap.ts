import { UserTier } from '@prisma/client';

// Configuration for every Apple In-App Purchase product we sell.
// Keep in sync with the Product IDs configured in App Store Connect.
//
// SKU versioning: every product ID carries a `.v<N>` suffix matching the app
// version at which the SKU was *last reissued* in App Store Connect (currently
// `.v1` — this is a brand-new app; the products still need to be created in
// App Store Connect for the com.bruhnfreeman.animationstation bundle). The
// suffix is NOT bumped on every app release — it only changes
// when an IAP gets stuck in "Needs Developer Attention" and must be reissued.
// App Store Connect treats deleted product IDs as permanently burned — they
// can never be recreated — so reissues bump the suffix to the current app
// version. When reissuing, update both this map and frontend/app.json.
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
  // Auto-renewing subscriptions (v14)
  'com.bruhnfreeman.animationstation.basic.monthly.v1': { type: 'subscription', tier: 'BASIC' },
  'com.bruhnfreeman.animationstation.premium.monthly.v1': { type: 'subscription', tier: 'PREMIUM' },

  // Consumable credit packs — Free-tier prices (most expensive) — v14
  'com.bruhnfreeman.animationstation.credits.10.free.v1': {
    type: 'credits',
    credits: 10,
    tierVariant: 'FREE',
  },
  'com.bruhnfreeman.animationstation.credits.25.free.v1': {
    type: 'credits',
    credits: 25,
    tierVariant: 'FREE',
  },
  'com.bruhnfreeman.animationstation.credits.50.free.v1': {
    type: 'credits',
    credits: 50,
    tierVariant: 'FREE',
  },
  'com.bruhnfreeman.animationstation.credits.100.free.v1': {
    type: 'credits',
    credits: 100,
    tierVariant: 'FREE',
  },

  // Consumable credit packs — Basic-tier prices — v14
  'com.bruhnfreeman.animationstation.credits.10.basic.v1': {
    type: 'credits',
    credits: 10,
    tierVariant: 'BASIC',
  },
  'com.bruhnfreeman.animationstation.credits.25.basic.v1': {
    type: 'credits',
    credits: 25,
    tierVariant: 'BASIC',
  },
  'com.bruhnfreeman.animationstation.credits.50.basic.v1': {
    type: 'credits',
    credits: 50,
    tierVariant: 'BASIC',
  },
  'com.bruhnfreeman.animationstation.credits.100.basic.v1': {
    type: 'credits',
    credits: 100,
    tierVariant: 'BASIC',
  },

  // Consumable credit packs — Premium-tier prices (cheapest) — v14
  'com.bruhnfreeman.animationstation.credits.10.premium.v1': {
    type: 'credits',
    credits: 10,
    tierVariant: 'PREMIUM',
  },
  'com.bruhnfreeman.animationstation.credits.25.premium.v1': {
    type: 'credits',
    credits: 25,
    tierVariant: 'PREMIUM',
  },
  'com.bruhnfreeman.animationstation.credits.50.premium.v1': {
    type: 'credits',
    credits: 50,
    tierVariant: 'PREMIUM',
  },
  'com.bruhnfreeman.animationstation.credits.100.premium.v1': {
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
