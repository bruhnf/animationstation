import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, blockGuests } from '../middleware/auth';
import prisma from '../lib/prisma';
import { presignAvatarOnly } from '../services/imageUrlService';
import { getInvisibleUserIds } from '../utils/blocks';
import { createChildLogger } from '../services/logger';

const router = Router();
const log = createChildLogger('Comments');

router.use(requireAuth);

const createSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(500, 'Comment is too long'),
  // When set, this is a reply to a top-level comment with the given id. The
  // server validates the parent exists, belongs to the same creation, and is
  // itself a top-level comment (single-level threading; no reply-to-replies).
  parentId: z.string().uuid().optional(),
});

interface AuthorSelect {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

const COMMENT_AUTHOR_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
} as const;

// Resolve which comments the requester has liked, returned as a Set of
// comment IDs for O(1) lookup when decorating the GET response.
async function getLikedSet(userId: string, commentIds: string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const liked = await prisma.commentLike.findMany({
    where: { userId, commentId: { in: commentIds } },
    select: { commentId: true },
  });
  return new Set(liked.map((l) => l.commentId));
}

// List comments for a creation. Returns only top-level comments (parentId IS
// NULL) at the top level; each top-level entry includes its replies inline,
// ordered oldest-first. Each entry (parent or reply) carries a likesCount
// and a `liked` boolean for the requesting user.
router.get('/creations/:jobId/comments', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { jobId } = req.params;
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
  const limit = Math.min(50, parseInt((req.query.limit as string) ?? '30', 10));

  const job = await prisma.creation.findUnique({
    where: { id: jobId },
    select: { id: true, isPrivate: true, userId: true },
  });
  if (!job) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }
  if (job.isPrivate && job.userId !== req.user.userId) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }

  // Hide comments authored by users who are mutually invisible to the viewer
  // (people they've blocked, or who've blocked them) — both top-level comments
  // and replies — so blocks apply inside comment threads, not just the feed.
  const invisibleUserIds = await getInvisibleUserIds(req.user.userId);

  // Block applies to the POST too, not just individual comments: if the viewer
  // is on either side of a block with the post's owner, they can't read the
  // thread even with a direct jobId (matches the like/reply/feed rules).
  if (job.userId !== req.user.userId && invisibleUserIds.includes(job.userId)) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }
  const topLevelWhere = {
    jobId,
    parentId: null,
    userId: { notIn: invisibleUserIds },
  };

  const [topLevel, total] = await Promise.all([
    prisma.comment.findMany({
      where: topLevelWhere,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: COMMENT_AUTHOR_SELECT },
        _count: { select: { likes: true } },
        replies: {
          where: { userId: { notIn: invisibleUserIds } },
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: COMMENT_AUTHOR_SELECT },
            _count: { select: { likes: true } },
          },
        },
      },
    }),
    prisma.comment.count({ where: topLevelWhere }),
  ]);

  // Collect every comment id (parent + replies) so we can fetch the user's
  // like state in a single query.
  const allIds: string[] = [];
  for (const c of topLevel) {
    allIds.push(c.id);
    for (const r of c.replies) allIds.push(r.id);
  }
  const likedSet = await getLikedSet(req.user.userId, allIds);

  // Decorate: presign avatars + add likesCount/liked. Drop the _count and
  // raw user shape in favor of the decorated versions.
  const decorate = async <T extends { id: string; user: AuthorSelect; _count: { likes: number } }>(
    c: T,
  ) => {
    const { _count, user, ...rest } = c;
    return {
      ...rest,
      user: await presignAvatarOnly(user),
      likesCount: _count.likes,
      liked: likedSet.has(c.id),
    };
  };

  const decorated = await Promise.all(
    topLevel.map(async (c) => {
      const parent = await decorate(c);
      const replies = await Promise.all(c.replies.map((r) => decorate(r)));
      return { ...parent, replies };
    }),
  );

  res.json({ comments: decorated, page, total, hasMore: page * limit < total });
});

// Create a comment or reply on a creation. When `parentId` is set, the new row
// is a reply attached to that parent (single-level threading). Self-comments
// are allowed and don't trigger a notification.
router.post('/creations/:jobId/comments', blockGuests, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { jobId } = req.params;
  const { body, parentId } = parsed.data;

  const job = await prisma.creation.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, isPrivate: true },
  });
  if (!job) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }
  if (job.isPrivate && job.userId !== req.user.userId) {
    res.status(403).json({ error: 'This creation is private' });
    return;
  }

  // Respect blocks: you can't comment on a post whose owner is mutually
  // invisible to you (you blocked them, or they blocked you). 404 mirrors the
  // "can't see it" behavior used elsewhere for blocked relationships.
  const invisibleUserIds = await getInvisibleUserIds(req.user.userId);
  if (invisibleUserIds.includes(job.userId)) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }

  // Validate the parent if this is a reply, and capture parent author so
  // we can notify them below.
  let parentAuthorId: string | null = null;
  if (parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { id: true, jobId: true, parentId: true, userId: true },
    });
    if (!parent) {
      res.status(404).json({ error: 'Parent comment not found' });
      return;
    }
    if (parent.jobId !== jobId) {
      res.status(400).json({ error: 'Parent comment belongs to a different creation' });
      return;
    }
    if (parent.parentId) {
      res.status(400).json({ error: 'Replies to replies are not supported' });
      return;
    }
    // Can't reply to a comment from a user who is mutually invisible to you.
    if (invisibleUserIds.includes(parent.userId)) {
      res.status(404).json({ error: 'Parent comment not found' });
      return;
    }
    parentAuthorId = parent.userId;
  }

  const isSelfComment = job.userId === req.user.userId;

  const ops: import('@prisma/client').Prisma.PrismaPromise<unknown>[] = [
    prisma.comment.create({
      data: {
        jobId,
        userId: req.user.userId,
        body,
        parentId: parentId ?? null,
      },
      include: {
        user: { select: COMMENT_AUTHOR_SELECT },
      },
    }),
    prisma.creation.update({
      where: { id: jobId },
      data: { commentsCount: { increment: 1 } },
    }),
  ];
  if (!parentId && !isSelfComment) {
    // Top-level comment on someone else's creation → notify the post owner.
    ops.push(
      prisma.notification.create({
        data: {
          userId: job.userId,
          actorId: req.user.userId,
          type: 'COMMENT',
          jobId,
        },
      }),
    );
  } else if (parentId && parentAuthorId && parentAuthorId !== req.user.userId) {
    // Reply to someone else's comment → notify the parent comment author
    // with the parent commentId so the inbox can deep-link straight to
    // their comment in the thread.
    ops.push(
      prisma.notification.create({
        data: {
          userId: parentAuthorId,
          actorId: req.user.userId,
          type: 'COMMENT_REPLY',
          jobId,
          commentId: parentId,
        },
      }),
    );
  }
  const [comment] = await prisma.$transaction(ops);

  log.info('Comment created', {
    commentId: (comment as { id: string }).id,
    jobId,
    authorId: req.user.userId,
    isReply: !!parentId,
    isSelfComment,
  });

  const created = comment as {
    id: string;
    jobId: string;
    userId: string;
    body: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
    user: AuthorSelect;
  };
  res.status(201).json({
    ...created,
    user: await presignAvatarOnly(created.user),
    likesCount: 0,
    liked: false,
    replies: [] as unknown[],
  });
});

// Delete a comment. Allowed if the caller is the comment author OR the owner
// of the Creation the comment is on. Cascades delete to replies (FK ON DELETE
// CASCADE), so the count is decremented by 1 + the number of replies.
router.delete('/comments/:commentId', blockGuests, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { commentId } = req.params;
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      userId: true,
      jobId: true,
      parentId: true,
      _count: { select: { replies: true } },
      job: { select: { userId: true } },
    },
  });
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }

  const isAuthor = comment.userId === req.user.userId;
  const isPostOwner = comment.job.userId === req.user.userId;
  if (!isAuthor && !isPostOwner) {
    res.status(403).json({ error: 'Not allowed to delete this comment' });
    return;
  }

  // 1 for this comment + N replies that get cascade-deleted.
  const totalRemoved = 1 + comment._count.replies;

  await prisma.$transaction([
    prisma.comment.delete({ where: { id: commentId } }),
    prisma.creation.update({
      where: { id: comment.jobId },
      data: { commentsCount: { decrement: totalRemoved } },
    }),
  ]);

  log.info('Comment deleted', {
    commentId,
    deletedBy: req.user.userId,
    asAuthor: isAuthor,
    asPostOwner: isPostOwner,
    repliesRemoved: comment._count.replies,
    totalRemoved,
  });

  res.json({ deleted: true, removed: totalRemoved });
});

// Like a comment. Idempotent — re-liking is a no-op (the unique constraint
// would otherwise raise; we catch it as success).
router.post('/comments/:commentId/likes', blockGuests, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { commentId } = req.params;
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      jobId: true,
      userId: true,
      job: { select: { isPrivate: true, userId: true } },
    },
  });
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  // Mirror the GET visibility rule: liking a comment on a private creation is
  // only allowed if you own the creation.
  if (comment.job.isPrivate && comment.job.userId !== req.user.userId) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  // Respect blocks: can't like a comment authored by a mutually-invisible user.
  const invisibleUserIds = await getInvisibleUserIds(req.user.userId);
  if (invisibleUserIds.includes(comment.userId)) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }

  let alreadyLiked = false;
  try {
    await prisma.commentLike.create({
      data: { userId: req.user.userId, commentId },
    });
  } catch (err) {
    // Unique-constraint violation = already liked. Treat as idempotent success
    // and don't fire a duplicate notification.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      alreadyLiked = true;
    } else {
      throw err;
    }
  }

  // Notify the comment author on a fresh like (skip self-likes and
  // re-likes-after-unlike-then-like-again). Aggregation could be added later;
  // for now we match the existing creation LIKE notification pattern.
  if (!alreadyLiked && comment.userId !== req.user.userId) {
    await prisma.notification.create({
      data: {
        userId: comment.userId,
        actorId: req.user.userId,
        type: 'COMMENT_LIKE',
        jobId: comment.jobId,
        commentId,
      },
    });
  }

  const likesCount = await prisma.commentLike.count({ where: { commentId } });
  res.json({ liked: true, likesCount });
});

router.delete('/comments/:commentId/likes', blockGuests, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { commentId } = req.params;
  await prisma.commentLike.deleteMany({
    where: { userId: req.user.userId, commentId },
  });
  const likesCount = await prisma.commentLike.count({ where: { commentId } });
  res.json({ liked: false, likesCount });
});

export default router;
