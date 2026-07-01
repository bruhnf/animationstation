import prisma from '../lib/prisma';

// Returns the set of user IDs that are mutually invisible to `userId`:
// users they've blocked + users who've blocked them. Used to filter feed
// and profile queries so blocked users don't see each other anywhere.
export async function getInvisibleUserIds(userId: string): Promise<string[]> {
  const [blocking, blockedBy] = await Promise.all([
    prisma.userBlock.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    }),
    prisma.userBlock.findMany({
      where: { blockedId: userId },
      select: { blockerId: true },
    }),
  ]);
  return [...new Set([...blocking.map((b) => b.blockedId), ...blockedBy.map((b) => b.blockerId)])];
}
