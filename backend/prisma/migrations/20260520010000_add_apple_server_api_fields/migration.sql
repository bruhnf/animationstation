-- App Store Server API ("Get All Subscription Statuses") reconciliation fields.
-- `appleStatus` mirrors Apple's Status enum (1=ACTIVE, 2=EXPIRED, 3=BILLING_RETRY,
-- 4=BILLING_GRACE_PERIOD, 5=REVOKED) for the latest entry in the subscription group.
-- `lastSyncedFromAppleAt` records when an admin last pulled live status from Apple,
-- so the dashboard can show snapshot freshness.
ALTER TABLE "apple_purchases" ADD COLUMN "appleStatus" INTEGER;
ALTER TABLE "apple_purchases" ADD COLUMN "lastSyncedFromAppleAt" TIMESTAMP(3);
