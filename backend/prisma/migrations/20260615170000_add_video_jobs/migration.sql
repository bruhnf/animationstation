-- AI Video (image-to-video) feature. Videos reuse the tryon_jobs table,
-- discriminated by `kind`, so every existing surface (feed, profile, looks,
-- comments, likes, share, moderation, S3 cleanup) works unchanged.

-- Discriminator enum.
CREATE TYPE "TryOnKind" AS ENUM ('IMAGE', 'VIDEO');

-- New columns. kind defaults to IMAGE so every existing row is a try-on.
ALTER TABLE "tryon_jobs" ADD COLUMN "kind" "TryOnKind" NOT NULL DEFAULT 'IMAGE';
ALTER TABLE "tryon_jobs" ADD COLUMN "videoUrl" TEXT;
ALTER TABLE "tryon_jobs" ADD COLUMN "motionPrompt" VARCHAR(300);

-- Clothing is required for a try-on but absent for a video (its single input is
-- the source image in bodyPhotoUrl). Relax the NOT NULL constraint.
ALTER TABLE "tryon_jobs" ALTER COLUMN "clothingPhoto1Url" DROP NOT NULL;
