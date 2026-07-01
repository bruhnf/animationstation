-- One-time sweep: delete already-orphaned transient notifications whose actor
-- account was deleted BEFORE the app-level cleanup existed (those rows had their
-- actorId nulled by the `actor onDelete: SetNull` cascade and now render as an
-- un-attributable "Someone liked your try-on / followed you / liked your comment"
-- in the inbox).
--
-- Scope: GLOBAL (every user's inbox), not one account. Durable COMMENT /
-- COMMENT_REPLY notifications are intentionally left as tombstones. Idempotent —
-- re-running deletes nothing new. Going forward, deleteActorOrphanedNotifications
-- removes these at account-deletion time so no new orphans accumulate.
DELETE FROM "notifications"
WHERE "actorId" IS NULL
  AND "type" IN ('LIKE', 'FOLLOW', 'COMMENT_LIKE');
