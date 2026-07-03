-- Widen the creation prompt columns from VARCHAR(300) to VARCHAR(1000) so users
-- can write longer prompts. Widening a varchar is a metadata-only, non-blocking
-- change in Postgres (no table rewrite, no data loss).
ALTER TABLE "creations" ALTER COLUMN "motionPrompt" SET DATA TYPE VARCHAR(1000);
ALTER TABLE "creations" ALTER COLUMN "promptText" SET DATA TYPE VARCHAR(1000);
