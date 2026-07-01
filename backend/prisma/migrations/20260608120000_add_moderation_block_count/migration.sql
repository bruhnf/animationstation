-- Per-user content-moderation strike tracking. moderationBlockCount is the
-- lifetime number of try-on generations the AI provider blocked for this user
-- (revealing/sexual/banned-content attempts); lastModerationBlockAt stamps the
-- most recent one. Both are additive and backfill safely (count defaults to 0).
ALTER TABLE "users" ADD COLUMN     "moderationBlockCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN     "lastModerationBlockAt" TIMESTAMP(3);
