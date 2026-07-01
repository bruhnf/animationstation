-- Optional user-authored title/caption for a try-on, shown under the result
-- image on the community feed and the web "My Try-Ons" page. Nullable so all
-- existing rows are valid without a backfill.
ALTER TABLE "tryon_jobs" ADD COLUMN "title" VARCHAR(140);
