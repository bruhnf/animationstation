-- Optional free-form user prompt for the multi-image compose path
-- (AnimationStation feature 2). Nullable so all existing rows are valid
-- without a backfill; null/empty means a neutral combine/enhance prompt.
ALTER TABLE "tryon_jobs" ADD COLUMN "promptText" VARCHAR(300);
