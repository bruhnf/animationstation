import { NotificationType } from '@prisma/client';
import prisma from '../lib/prisma';
import { deleteFromS3, keyFromUrl } from './s3Service';
import { createChildLogger } from './logger';

const log = createChildLogger('AccountDeletion');

/**
 * Notification types that are meaningless once their ACTOR is gone: "Someone
 * liked your creation / followed you / liked your comment." The schema's
 * `actor onDelete: SetNull` would otherwise null `actorId` and leave the inbox
 * rendering a useless, un-clickable "Someone" tombstone. We delete these on
 * account deletion instead. Durable types (COMMENT / COMMENT_REPLY) are
 * intentionally NOT included — those relate to comment threads worth keeping a
 * tombstone for (Reddit-style), so they keep the SetNull behavior.
 */
export const ACTOR_ORPHAN_NOTIFICATION_TYPES: NotificationType[] = [
  NotificationType.LIKE,
  NotificationType.FOLLOW,
  NotificationType.COMMENT_LIKE,
];

/**
 * Delete the transient notifications a user GENERATED for others (where they are
 * the actor) before their account row is removed — so they don't degrade into
 * "Someone …" tombstones. Call this BEFORE deleting the user (afterwards the
 * SetNull cascade has already wiped `actorId`, so the rows can't be targeted).
 */
export async function deleteActorOrphanedNotifications(userId: string): Promise<number> {
  const { count } = await prisma.notification.deleteMany({
    where: { actorId: userId, type: { in: ACTOR_ORPHAN_NOTIFICATION_TYPES } },
  });
  return count;
}

/**
 * Hard-delete a user and every asset they own. Shared by the user-initiated
 * account deletion (profileController.deleteAccount) and the scheduled
 * stale-guest cleanup (queue/guestCleanupWorker), so the cascade + S3 cleanup
 * stay in sync.
 *
 * Gathers all S3 keys BEFORE deleting the row — once the User row is gone Prisma
 * cascades the Creation rows and the keys are lost. Deletes the DB row first
 * (cascades clean up Likes, Follows, Comments, CommentLikes, CreditTransactions,
 * ApplePurchases, Notifications, RefreshTokens, UserLocations, Creations,
 * Reports, UserBlocks), then fires async S3 deletes so the account is
 * unreachable even if S3 partially fails. Failures are logged for an orphan
 * sweep rather than blocking deletion.
 *
 * Returns counts for logging, or null if no such user exists.
 */
export async function deleteUserAndAssets(
  userId: string,
): Promise<{ s3KeysQueued: number; jobsScanned: number } | null> {
  const [user, jobs, closetItems] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, fullBodyUrl: true, mediumBodyUrl: true },
    }),
    prisma.creation.findMany({
      where: { userId },
      select: {
        refImage1Url: true,
        refImage2Url: true,
        resultImageUrl: true,
        resultImage2Url: true,
        // sourceImageUrl points at the same object as user.fullBodyUrl /
        // mediumBodyUrl — already covered by the user select above.
      },
    }),
    prisma.closetItem.findMany({
      where: { userId },
      select: { imageUrl: true },
    }),
  ]);

  if (!user) return null;

  const s3Keys = new Set<string>();
  if (user.avatarUrl) s3Keys.add(keyFromUrl(user.avatarUrl));
  if (user.fullBodyUrl) s3Keys.add(keyFromUrl(user.fullBodyUrl));
  if (user.mediumBodyUrl) s3Keys.add(keyFromUrl(user.mediumBodyUrl));
  for (const j of jobs) {
    if (j.refImage1Url) s3Keys.add(keyFromUrl(j.refImage1Url));
    if (j.refImage2Url) s3Keys.add(keyFromUrl(j.refImage2Url));
    if (j.resultImageUrl) s3Keys.add(keyFromUrl(j.resultImageUrl));
    if (j.resultImage2Url) s3Keys.add(keyFromUrl(j.resultImage2Url));
  }
  for (const c of closetItems) {
    s3Keys.add(keyFromUrl(c.imageUrl));
  }

  // Remove the "Someone liked/followed you" notifications this user generated
  // for others BEFORE the row is gone (SetNull would otherwise orphan them).
  await deleteActorOrphanedNotifications(userId);

  await prisma.user.delete({ where: { id: userId } });

  for (const key of s3Keys) {
    deleteFromS3(key).catch((err) => {
      log.warn('S3 delete failed during account deletion', {
        userId,
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { s3KeysQueued: s3Keys.size, jobsScanned: jobs.length };
}
