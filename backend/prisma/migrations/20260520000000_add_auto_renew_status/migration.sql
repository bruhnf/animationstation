-- Adds auto-renew tracking to apple_purchases so the admin dashboard can
-- distinguish active-renewing subscriptions from pending cancellations
-- (auto-renew off, but entitlement still valid until expiresAt).
ALTER TABLE "apple_purchases" ADD COLUMN "autoRenewStatus" BOOLEAN;
