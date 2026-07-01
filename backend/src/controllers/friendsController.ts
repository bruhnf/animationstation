import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getInvisibleUserIds } from '../utils/blocks';
import { presignAvatarOnly } from '../services/imageUrlService';

export async function follow(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId: followerId } = req.user;
  const { userId: followingId } = req.params;

  if (followerId === followingId) {
    res.status(400).json({ error: 'Cannot follow yourself' });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id: followingId } });
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
  });
  if (existing) {
    res.status(409).json({ error: 'Already following' });
    return;
  }

  await prisma.$transaction([
    prisma.follow.create({ data: { followerId, followingId } }),
    prisma.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } }),
    prisma.user.update({ where: { id: followingId }, data: { followersCount: { increment: 1 } } }),
    prisma.notification.create({
      data: {
        userId: followingId,
        actorId: followerId,
        type: 'FOLLOW',
      },
    }),
  ]);

  res.json({ following: true });
}

export async function unfollow(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId: followerId } = req.user;
  const { userId: followingId } = req.params;

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
  });
  if (!existing) {
    res.status(404).json({ error: 'Not following' });
    return;
  }

  await prisma.$transaction([
    prisma.follow.delete({ where: { followerId_followingId: { followerId, followingId } } }),
    prisma.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } }),
    prisma.user.update({ where: { id: followingId }, data: { followersCount: { decrement: 1 } } }),
  ]);

  res.json({ following: false });
}

export async function getFollowing(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const rows = await prisma.follow.findMany({
    where: { followerId: req.user.userId },
    include: {
      following: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          bio: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(await Promise.all(rows.map((r) => presignAvatarOnly(r.following))));
}

export async function getFollowers(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const rows = await prisma.follow.findMany({
    where: { followingId: req.user.userId },
    include: {
      follower: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          bio: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(await Promise.all(rows.map((r) => presignAvatarOnly(r.follower))));
}

export async function getFollowStatus(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId: targetId } = req.params;
  if (req.user.userId === targetId) {
    res.json({ following: false, self: true });
    return;
  }
  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: req.user.userId, followingId: targetId } },
  });
  res.json({ following: !!existing, self: false });
}

export async function searchUsers(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    res.status(400).json({ error: 'Query must be at least 2 characters' });
    return;
  }
  const invisible = await getInvisibleUserIds(req.user.userId);
  const users = await prisma.user.findMany({
    where: {
      AND: [
        {
          OR: [
            { username: { contains: q.trim(), mode: 'insensitive' } },
            { firstName: { contains: q.trim(), mode: 'insensitive' } },
            { lastName: { contains: q.trim(), mode: 'insensitive' } },
            { bio: { contains: q.trim(), mode: 'insensitive' } },
          ],
        },
        { id: { notIn: invisible } },
      ],
    },
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      bio: true,
    },
    take: 20,
  });
  res.json(await Promise.all(users.map((u) => presignAvatarOnly(u))));
}
