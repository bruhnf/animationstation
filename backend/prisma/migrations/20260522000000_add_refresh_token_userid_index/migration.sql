-- Index refresh_tokens.userId. PostgreSQL does not auto-index foreign-key
-- columns, so the deleteMany({ where: { userId } }) calls in reset-password /
-- change-password — and the onDelete: Cascade run when a user is deleted — were
-- doing full table scans. This index keeps them fast as the table grows.
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
