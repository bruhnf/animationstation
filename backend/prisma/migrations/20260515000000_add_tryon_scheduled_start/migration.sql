-- AlterTable
-- Soft per-user throttle stores the effective start time here so the client
-- can render a "starts in X:XX" countdown. Null = run immediately.
-- See backend/src/services/throttleService.ts for the algorithm.
ALTER TABLE "tryon_jobs" ADD COLUMN "scheduledStartAt" TIMESTAMP(3);
