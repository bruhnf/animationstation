import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../lib/prisma';
import { getInvisibleUserIds } from '../utils/blocks';
import { presignTryOnJob, presignAvatarOnly } from '../services/imageUrlService';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
  const limit = 20;
  const userId = req.user.userId;

  // Exclude content from users involved in a block relationship in either
  // direction. Apple Guideline 1.2 requires blocked users be hidden.
  const invisibleUserIds = await getInvisibleUserIds(userId);

  const baseWhere = {
    status: 'COMPLETE' as const,
    isPrivate: false,
    userId: { notIn: invisibleUserIds },
  };

  // Fetch one extra row (take: limit + 1) to compute `hasMore` without a
  // separate count() query. The old count() ran on EVERY feed request and gets
  // slower as the table grows; dropping it removes a DB round-trip from the hot
  // path (see the connection-pool note in lib/prisma.ts).
  const jobsPlusOne = await prisma.tryOnJob.findMany({
    where: baseWhere,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit + 1,
    include: {
      user: { select: { username: true, firstName: true, lastName: true, avatarUrl: true } },
      likes: {
        where: { userId },
        select: { id: true },
      },
      // Whether the current user has bookmarked this job — drives the yellow
      // bookmark state in the feed (same pattern as `liked`).
      savedLooks: {
        where: { userId },
        select: { id: true },
      },
    },
  });

  const hasMore = jobsPlusOne.length > limit;
  const jobs = hasMore ? jobsPlusOne.slice(0, limit) : jobsPlusOne;

  // Map likes[] to a simple `liked` boolean per job for the current user, and
  // mint presigned URLs for both the result images and the embedded avatar.
  const decorated = await Promise.all(
    jobs.map(async (j) => {
      const { likes, savedLooks, user, ...rest } = j;
      const [presignedJob, presignedUser] = await Promise.all([
        presignTryOnJob(rest),
        presignAvatarOnly(user),
      ]);
      // A public feed post intentionally surfaces its INPUT thumbnails (the body
      // photo + clothing item that produced the result) alongside the result —
      // that's the card design; the user chose to publish this try-on. Only
      // PRIVATE jobs (never in the feed) keep their inputs hidden.
      return {
        ...presignedJob,
        user: presignedUser,
        liked: likes.length > 0,
        saved: savedLooks.length > 0,
      };
    }),
  );

  const shuffled = decorated.sort(() => Math.random() - 0.5);

  res.json({ jobs: shuffled, page, hasMore });
});

export default router;
