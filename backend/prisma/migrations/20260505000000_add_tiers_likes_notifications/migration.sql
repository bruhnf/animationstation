-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('FREE', 'BASIC', 'PREMIUM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FOLLOW', 'LIKE', 'TRYON_COMPLETE');

-- AlterTable: add new columns to users (tier, tryOnCount, lastFreeCreditGrantAt)
ALTER TABLE "users"
  ADD COLUMN "tier" "UserTier" NOT NULL DEFAULT 'FREE',
  ADD COLUMN "tryOnCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastFreeCreditGrantAt" TIMESTAMP(3);

-- Migrate existing isSubscribed=true users to BASIC tier
UPDATE "users" SET "tier" = 'BASIC' WHERE "isSubscribed" = true;

-- Drop the legacy isSubscribed column now that data is migrated
ALTER TABLE "users" DROP COLUMN "isSubscribed";

-- AlterTable: add likesCount to tryon_jobs
ALTER TABLE "tryon_jobs" ADD COLUMN "likesCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: likes
CREATE TABLE "likes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "likes_userId_jobId_key" ON "likes"("userId", "jobId");

-- CreateIndex
CREATE INDEX "likes_jobId_idx" ON "likes"("jobId");

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "tryon_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "actorId" TEXT,
    "jobId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "tryon_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
