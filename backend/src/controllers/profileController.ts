import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { isAdminEmail } from '../utils/admin';
import {
  presignUserPhotos,
  presignTryOnJobs,
  presignAvatarOnly,
  presignClosetItems,
} from '../services/imageUrlService';
import { deleteUserAndAssets } from '../services/accountDeletionService';
import { isUniqueConstraintError } from '../utils/prismaErrors';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('ProfileController');

const updateSchema = z.object({
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  bio: z.string().max(200).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
});

export async function getProfile(req: Request, res: Response): Promise<void> {
  const { username } = req.params;
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      bio: true,
      avatarUrl: true,
      // Body photos intentionally omitted from public profile responses
      tryOnCount: true,
      followingCount: true,
      followersCount: true,
      likesCount: true,
      createdAt: true,
    },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Block-aware visibility. If either party has blocked the other:
  //   - If the viewer blocked the target, return the profile shell with a
  //     `viewerHasBlocked: true` flag so the client can render an "Unblock to
  //     see this profile" state.
  //   - If the target blocked the viewer, return 404 to avoid revealing the
  //     block to the blocked party.
  let viewerHasBlocked = false;
  let isSelf = false;
  let isFollowing = false;
  if (req.user) {
    isSelf = req.user.userId === user.id;
    if (!isSelf) {
      const [blockedByThem, weBlockedThem, follow] = await Promise.all([
        prisma.userBlock.findUnique({
          where: { blockerId_blockedId: { blockerId: user.id, blockedId: req.user.userId } },
        }),
        prisma.userBlock.findUnique({
          where: { blockerId_blockedId: { blockerId: req.user.userId, blockedId: user.id } },
        }),
        prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: req.user.userId, followingId: user.id } },
        }),
      ]);
      if (blockedByThem) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      viewerHasBlocked = !!weBlockedThem;
      isFollowing = !!follow;
    }
  }

  // If the viewer has blocked this user, return the bare profile shell with
  // no jobs so they can see who's blocked but not consume their content.
  const jobs = viewerHasBlocked
    ? []
    : await prisma.tryOnJob.findMany({
        where: { userId: user.id, status: 'COMPLETE', isPrivate: false },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          kind: true,
          resultFullBodyUrl: true,
          resultMediumUrl: true,
          videoUrl: true,
          // The public profile grid carousel shows each public post's inputs
          // (clothing + the body-photo perspective fed to Grok) next to the
          // result — same content the feed card surfaces. Private posts are
          // excluded by the where clause above.
          clothingPhoto1Url: true,
          bodyPhotoUrl: true,
          likesCount: true,
          createdAt: true,
        },
      });

  const presignedUser = await presignAvatarOnly(user);
  const presignedJobs = await presignTryOnJobs(jobs);
  res.json({ ...presignedUser, jobs: presignedJobs, isFollowing, isSelf, viewerHasBlocked });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { username, ...rest } = parse.data;

  if (username) {
    // Case-insensitive: "Bruhn" is taken if "bruhn" exists (citext column
    // backs this at the DB level; explicit here for pre-migration safety).
    const conflict = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' }, NOT: { id: req.user.userId } },
    });
    if (conflict) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
  }

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: { ...(username ? { username } : {}), ...rest },
      select: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        fullBodyUrl: true,
        mediumBodyUrl: true,
        tier: true,
        credits: true,
        tryOnCount: true,
        followingCount: true,
        followersCount: true,
        city: true,
        state: true,
      },
    });
  } catch (err) {
    // Concurrent rename lost the race past the pre-check above.
    if (isUniqueConstraintError(err)) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
    throw err;
  }

  res.json(await presignUserPhotos(updated));
}

export async function getMyProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      bio: true,
      avatarUrl: true,
      fullBodyUrl: true,
      mediumBodyUrl: true,
      tier: true,
      credits: true,
      tryOnCount: true,
      followingCount: true,
      followersCount: true,
      likesCount: true,
      city: true,
      state: true,
      aiProcessingConsentAt: true,
      isGuest: true,
      verified: true,
      createdAt: true,
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const presigned = await presignUserPhotos(user);
  res.json({ ...presigned, isAdmin: isAdminEmail(user.email) });
}

// App Store Review Guidelines 5.1.1(i) / 5.1.2(i) require explicit user
// consent before transmitting personal data to a third-party AI service.
// These endpoints record / revoke that consent. The /api/tryon submit path
// rejects with AI_CONSENT_REQUIRED when aiProcessingConsentAt is null.
export async function recordAiConsent(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const updated = await prisma.user.update({
    where: { id: req.user.userId },
    data: { aiProcessingConsentAt: new Date() },
    select: { aiProcessingConsentAt: true },
  });
  log.info('AI processing consent recorded', { userId: req.user.userId });
  res.json({ aiProcessingConsentAt: updated.aiProcessingConsentAt });
}

export async function revokeAiConsent(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  await prisma.user.update({
    where: { id: req.user.userId },
    data: { aiProcessingConsentAt: null },
  });
  log.info('AI processing consent revoked', { userId: req.user.userId });
  res.json({ aiProcessingConsentAt: null });
}

// App Store Review Guideline 5.1.1(v): account deletion must remove the data
// the developer has collected from the user. DB rows are handled by Prisma
// cascade rules; this function additionally enumerates and removes every S3
// object owned by the user (avatar, body photos, clothing photos, results)
// before deleting the User row.
export async function deleteAccount(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const userId = req.user.userId;

  // Shared with the stale-guest cleanup worker: gathers S3 keys, deletes the
  // User row (Prisma cascades clean up all child rows), then fires async S3
  // deletes. DB-first so the account is unreachable even if S3 partially fails.
  const result = await deleteUserAndAssets(userId);
  if (!result) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  log.info('Account deleted', {
    userId,
    s3KeysQueued: result.s3KeysQueued,
    jobsScanned: result.jobsScanned,
  });
  res.json({ message: 'Account deleted' });
}

// Export the authenticated user's personal data (GDPR / CCPA right of access).
// Returns a JSON document the client can save or share. Sensitive fields like
// the password hash and refresh tokens are intentionally omitted.
export async function exportData(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userId = req.user.userId;

  const [
    user,
    tryOnJobs,
    locations,
    follows,
    followers,
    creditTransactions,
    applePurchases,
    likes,
    notifications,
    closetItems,
    savedLooks,
    referralsMade,
    referralReceived,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        verified: true,
        tier: true,
        credits: true,
        tryOnCount: true,
        lastFreeCreditGrantAt: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        fullBodyUrl: true,
        mediumBodyUrl: true,
        followingCount: true,
        followersCount: true,
        likesCount: true,
        referralCode: true,
        address: true,
        city: true,
        state: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.tryOnJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        isPrivate: true,
        clothingPhoto1Url: true,
        clothingPhoto2Url: true,
        resultFullBodyUrl: true,
        resultMediumUrl: true,
        bodyPhotoUrl: true,
        perspectivesUsed: true,
        likesCount: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.userLocation.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.follow.findMany({ where: { followerId: userId } }),
    prisma.follow.findMany({ where: { followingId: userId } }),
    prisma.creditTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.applePurchase.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        transactionId: true,
        originalTransactionId: true,
        productId: true,
        tier: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
        // rawReceipt intentionally omitted — large and not user-meaningful
      },
    }),
    prisma.like.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.closetItem.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.savedLook.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { jobId: true, createdAt: true },
    }),
    prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { referredUserId: true, creditsAwarded: true, rewardedAt: true, createdAt: true },
    }),
    prisma.referral.findUnique({
      where: { referredUserId: userId },
      select: { referrerId: true, creditsAwarded: true, rewardedAt: true, createdAt: true },
    }),
  ]);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const presignedUser = await presignUserPhotos(user);
  const presignedJobs = await presignTryOnJobs(tryOnJobs);

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    user: presignedUser,
    tryOnJobs: presignedJobs,
    locations,
    follows: { following: follows, followers },
    creditTransactions,
    applePurchases,
    likes,
    notifications,
    closetItems: await presignClosetItems(closetItems),
    savedLooks,
    referrals: { made: referralsMade, received: referralReceived },
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="tryon-export-${user.username}-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json(exportPayload);
}
