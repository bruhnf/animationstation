import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ReportTargetType, ReportReason } from '@prisma/client';
import { requireAuth, blockGuests } from '../middleware/auth';
import prisma from '../lib/prisma';
import { createChildLogger } from '../services/logger';
import { presignAvatarOnly } from '../services/imageUrlService';

const router = Router();
const log = createChildLogger('Moderation');

router.use(requireAuth);

const reportSchema = z.object({
  targetType: z.nativeEnum(ReportTargetType),
  targetId: z.string().uuid(),
  reason: z.nativeEnum(ReportReason),
  details: z.string().max(1000).optional(),
});

// Submit a report for objectionable content or behavior.
// Required by App Store Review Guideline 1.2.
router.post('/reports', blockGuests, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { targetType, targetId, reason, details } = parsed.data;

  // Don't allow self-reports — they're either accidents or abuse.
  if (targetType === 'USER' && targetId === req.user.userId) {
    res.status(400).json({ error: 'Cannot report yourself' });
    return;
  }

  // Verify target exists.
  if (targetType === 'TRYON_JOB') {
    const job = await prisma.tryOnJob.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: 'Reported content not found' });
      return;
    }
  } else if (targetType === 'COMMENT') {
    const comment = await prisma.comment.findUnique({
      where: { id: targetId },
      select: { id: true, userId: true },
    });
    if (!comment) {
      res.status(404).json({ error: 'Reported comment not found' });
      return;
    }
    // Disallow self-reports of one's own comment.
    if (comment.userId === req.user.userId) {
      res.status(400).json({ error: 'Cannot report your own comment' });
      return;
    }
  } else {
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!user) {
      res.status(404).json({ error: 'Reported user not found' });
      return;
    }
  }

  const report = await prisma.report.create({
    data: {
      reporterId: req.user.userId,
      targetType,
      targetId,
      reason,
      details: details ?? null,
    },
  });

  log.info('Content report filed', {
    reportId: report.id,
    reporterId: req.user.userId,
    targetType,
    targetId,
    reason,
  });

  res.status(201).json({ id: report.id, status: report.status });
});

// Block another user. Idempotent — re-blocking is a no-op.
router.post('/users/:userId/block', blockGuests, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const blockedId = req.params.userId;

  if (blockedId === req.user.userId) {
    res.status(400).json({ error: 'Cannot block yourself' });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId: req.user.userId, blockedId } },
    create: { blockerId: req.user.userId, blockedId },
    update: {},
  });

  // If we were following them or they were following us, drop the follow links.
  // Blocking should remove all relationship state.
  await prisma.follow.deleteMany({
    where: {
      OR: [
        { followerId: req.user.userId, followingId: blockedId },
        { followerId: blockedId, followingId: req.user.userId },
      ],
    },
  });

  log.info('User blocked', { blockerId: req.user.userId, blockedId });
  res.status(200).json({ blocked: true });
});

router.delete('/users/:userId/block', blockGuests, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const blockedId = req.params.userId;

  await prisma.userBlock.deleteMany({
    where: { blockerId: req.user.userId, blockedId },
  });

  res.status(200).json({ blocked: false });
});

// List users the authenticated user has blocked. Used in Settings → Blocked Users.
router.get('/users/me/blocks', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: req.user.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      blocked: {
        select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
      },
    },
  });

  const presigned = await Promise.all(
    blocks.map(async (b) => ({
      blockedAt: b.createdAt,
      user: await presignAvatarOnly(b.blocked),
    })),
  );

  res.json({ blocks: presigned });
});

export default router;
