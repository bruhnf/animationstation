-- AlterTable
-- Soft per-user throttle: when set, the throttle's rolling-window count ignores
-- jobs created before this timestamp, giving the user a clean burst again.
-- Stamped on every successful credit purchase / subscription so a user who buys
-- credits is never stuck in the pacing queue. See services/throttleService.ts.
ALTER TABLE "users" ADD COLUMN "throttleResetAt" TIMESTAMP(3);
