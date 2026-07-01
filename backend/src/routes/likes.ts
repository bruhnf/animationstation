import { Router, Request, Response } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

router.use(requireAuth);
// All like/unlike actions are social writes — guests must sign up first.
router.use(blockGuests);

// Like a try-on session
router.post('/:jobId', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { jobId } = req.params;
  const userId = req.user.userId;

  const job = await prisma.tryOnJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, isPrivate: true, status: true },
  });
  if (!job) {
    res.status(404).json({ error: 'Try-on session not found' });
    return;
  }

  // Disallow self-likes (Instagram convention)
  if (job.userId === userId) {
    res.status(400).json({ error: 'Cannot like your own session' });
    return;
  }

  // Disallow liking private jobs
  if (job.isPrivate) {
    res.status(403).json({ error: 'Cannot like a private session' });
    return;
  }

  const existing = await prisma.like.findUnique({
    where: { userId_jobId: { userId, jobId } },
  });
  if (existing) {
    res.status(409).json({ error: 'Already liked' });
    return;
  }

  // Atomically: create like, bump job.likesCount, bump owner.likesCount, create notification
  await prisma.$transaction([
    prisma.like.create({ data: { userId, jobId } }),
    prisma.tryOnJob.update({ where: { id: jobId }, data: { likesCount: { increment: 1 } } }),
    prisma.user.update({ where: { id: job.userId }, data: { likesCount: { increment: 1 } } }),
    prisma.notification.create({
      data: {
        userId: job.userId,
        actorId: userId,
        type: 'LIKE',
        jobId,
      },
    }),
  ]);

  res.json({ liked: true });
});

// Unlike a try-on session
router.delete('/:jobId', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { jobId } = req.params;
  const userId = req.user.userId;

  const existing = await prisma.like.findUnique({
    where: { userId_jobId: { userId, jobId } },
  });
  if (!existing) {
    res.status(404).json({ error: 'Not liked' });
    return;
  }

  const job = await prisma.tryOnJob.findUnique({
    where: { id: jobId },
    select: { userId: true },
  });
  if (!job) {
    res.status(404).json({ error: 'Try-on session not found' });
    return;
  }

  await prisma.$transaction([
    prisma.like.delete({ where: { userId_jobId: { userId, jobId } } }),
    prisma.tryOnJob.update({ where: { id: jobId }, data: { likesCount: { decrement: 1 } } }),
    prisma.user.update({ where: { id: job.userId }, data: { likesCount: { decrement: 1 } } }),
  ]);

  res.json({ liked: false });
});

export default router;
