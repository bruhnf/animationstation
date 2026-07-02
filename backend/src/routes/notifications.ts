import { Router, Request, Response } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import prisma from '../lib/prisma';
import { presignAvatarOnly, presignCreation } from '../services/imageUrlService';

const router = Router();

router.use(requireAuth);
// Guests have no notifications; the client also replaces the Inbox tab with a
// signup prompt and skips the unread-count poll for them.
router.use(blockGuests);

// List notifications for the authenticated user (newest first)
router.get('/', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
  const limit = Math.min(50, parseInt((req.query.limit as string) ?? '30', 10));

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        actor: {
          select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
        },
        job: {
          select: { id: true, resultImageUrl: true, resultImage2Url: true },
        },
      },
    }),
    prisma.notification.count({
      where: { userId: req.user.userId, read: false },
    }),
  ]);

  const presigned = await Promise.all(
    notifications.map(async (n) => ({
      ...n,
      actor: n.actor ? await presignAvatarOnly(n.actor) : n.actor,
      job: n.job ? await presignCreation(n.job) : n.job,
    })),
  );

  res.json({ notifications: presigned, unreadCount, page });
});

// Unread count only (lightweight badge poll)
router.get('/unread-count', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const unreadCount = await prisma.notification.count({
    where: { userId: req.user.userId, read: false },
  });
  res.json({ unreadCount });
});

// Mark a single notification as read
router.patch('/:id/read', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { id } = req.params;
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.user.userId) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }
  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true },
  });
  res.json(updated);
});

// Mark all notifications as read
router.post('/read-all', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  await prisma.notification.updateMany({
    where: { userId: req.user.userId, read: false },
    data: { read: true },
  });
  res.json({ success: true });
});

export default router;
