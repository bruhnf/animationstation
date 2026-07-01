-- Rename to match the Prisma camelCase column convention used by the rest of this schema.
-- Guarded so fresh-database setups (where the prior migration already creates the correct
-- column name) don't error here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tryon_jobs' AND column_name = 'credits_at_time'
  ) THEN
    ALTER TABLE "tryon_jobs" RENAME COLUMN "credits_at_time" TO "creditsAtTime";
  END IF;
END $$;
