import { create } from 'zustand';

/**
 * Tracks comment-count deltas that have happened in the current session but
 * haven't been reflected in cached feed data yet (typically because the
 * comment was posted on `TryOnCommentsScreen` after `HomeScreen` already
 * fetched its feed).
 *
 * Pattern:
 *   - `bump(jobId, +1)` after a successful comment create
 *   - `bump(jobId, -1)` after a successful comment delete
 *   - `clear()` after a full feed refetch — at that point the server count
 *     already includes everything, so the deltas are stale and would
 *     double-count.
 *
 * Consumers add `(deltas[jobId] ?? 0)` to whatever `commentsCount` they
 * received from the server.
 */
interface CommentDeltaStore {
  deltas: Record<string, number>;
  bump: (jobId: string, delta: number) => void;
  clear: () => void;
}

export const useCommentDeltas = create<CommentDeltaStore>((set) => ({
  deltas: {},
  bump: (jobId, delta) =>
    set((state) => ({
      deltas: { ...state.deltas, [jobId]: (state.deltas[jobId] ?? 0) + delta },
    })),
  clear: () => set({ deltas: {} }),
}));
