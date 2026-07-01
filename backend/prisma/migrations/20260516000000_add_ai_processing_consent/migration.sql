-- AlterTable
-- Records the timestamp of the user's most recent explicit consent to send
-- body + clothing photos to xAI's Grok Imagine API. Null = no consent on
-- file or revoked. Required by App Store Review Guidelines 5.1.1(i) /
-- 5.1.2(i). The /api/tryon submit endpoint rejects with AI_CONSENT_REQUIRED
-- when null and the mobile app surfaces an explicit opt-in dialog.
ALTER TABLE "users" ADD COLUMN "aiProcessingConsentAt" TIMESTAMP(3);
