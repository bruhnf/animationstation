import { Router, Request, Response } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import prisma from '../lib/prisma';
import { presignTryOnJob, presignAvatarOnly } from '../services/imageUrlService';
import { isUniqueConstraintError } from '../utils/prismaErrors';
import { getInvisibleUserIds } from '../utils/blocks';
import { stripNonOwnerJobInputs } from '../utils/jobVisibility';

// "Saved Looks" — a user's bookmarked try-on results. Real accounts only.
const router = Router();
router.use(requireAuth);
router.use(blockGuests);

// GET /api/looks — the caller's saved looks, newest first, with presigned images.
router.get('/', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const userId = req.user.userId;

  // Re-enforce visibility at READ time, not just when the look was saved: a job
  // saved while public can later be made private, FAIL, or its owner can block
  // the viewer. Mirror the feed/POST rules — own job, or a public COMPLETE job
  // from a user who isn't on either side of a block.
  const invisible = await getInvisibleUserIds(userId);
  const saved = await prisma.savedLook.findMany({
    where: {
      userId,
      job: {
        status: 'COMPLETE',
        OR: [{ userId }, { isPrivate: false, userId: { notIn: invisible } }],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      job: {
        include: {
          user: { select: { username: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      },
    },
  });

  const looks = await Promise.all(
    saved.map(async (s) => {
      const { user, ...job } = s.job;
      const isOwn = job.userId === userId;
      const [presignedJob, presignedUser] = await Promise.all([
        presignTryOnJob(job),
        presignAvatarOnly(user),
      ]);
      // Never expose another user's INPUT photos (body photo + clothing) — only
      // results are public. (Shared helper keeps a VIDEO's poster, which is its
      // intended public thumbnail.) Owners get their inputs back.
      const safeJob = stripNonOwnerJobInputs(presignedJob, isOwn);
      return { savedAt: s.createdAt, ...safeJob, user: presignedUser };
    }),
  );
  res.json({ looks, count: looks.length });
});

// POST /api/looks/:jobId — save a look. Idempotent (unique [userId, jobId]).
// You can save your own job or any public (non-private) COMPLETE job, but not
// content from a user you've blocked / who blocked you.
router.post('/:jobId', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const userId = req.user.userId;
  const { jobId } = req.params;

  const job = await prisma.tryOnJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, isPrivate: true, status: true },
  });
  if (!job || job.status !== 'COMPLETE') {
    res.status(404).json({ error: 'NOT_FOUND', message: 'That try-on is not available.' });
    return;
  }
  if (job.userId !== userId) {
    if (job.isPrivate) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const invisible = await getInvisibleUserIds(userId);
    if (invisible.includes(job.userId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
  }

  try {
    await prisma.savedLook.create({ data: { userId, jobId } });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err; // already saved — idempotent
  }
  res.status(201).json({ saved: true });
});

// DELETE /api/looks/:jobId — remove a saved look.
router.delete('/:jobId', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  await prisma.savedLook.deleteMany({
    where: { userId: req.user.userId, jobId: req.params.jobId },
  });
  res.json({ saved: false });
});

export default router;
