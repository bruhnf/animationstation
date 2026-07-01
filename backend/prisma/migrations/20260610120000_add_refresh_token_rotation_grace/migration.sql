-- Rotation grace bookkeeping for refresh tokens.
-- Both columns are nullable and additive, so this is safe on a live table with
-- existing rows (no backfill required). Only used when REFRESH_TOKEN_ROTATION
-- is enabled.
ALTER TABLE "refresh_tokens" ADD COLUMN "rotatedAt" TIMESTAMP(3);
ALTER TABLE "refresh_tokens" ADD COLUMN "replacedByToken" TEXT;
