import { UserTier } from '@prisma/client';

export interface TierConfig {
  // Included try-on sessions per rolling 7-day window; FREE has 0 (credits-only)
  weeklyLimit: number;
  // Per-credit price in dollars for buying additional credits
  creditPrice: number;
}

export const TIER_CONFIG: Record<UserTier, TierConfig> = {
  FREE: { weeklyLimit: 0, creditPrice: 0.6 },
  BASIC: { weeklyLimit: 12, creditPrice: 0.5 },
  PREMIUM: { weeklyLimit: 24, creditPrice: 0.25 },
};

// Free-credit policy: 10 credits granted ONCE at email verification
// (see authController.verifyEmail). There is no recurring grant — users
// who exhaust their initial credits must purchase more or subscribe.
