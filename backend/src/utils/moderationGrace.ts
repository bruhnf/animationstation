// Pure decision logic for content-moderation handling in the creation worker.
// Lives here (dependency-free) so it can be unit-tested without importing the
// worker, which connects to Redis at module load.

// First N all-perspectives-blocked strikes are warnings: the credit is
// refunded and the stored message says so. Beyond that, the ToS §5.4
// no-refund policy applies.
export const MODERATION_GRACE_WARNINGS = 3;

// 'failed' = a transient (non-moderation) error on the FINAL retry attempt —
// earlier attempts rethrow so BullMQ retries the whole job instead.
export type PerspectiveOutcome = 'ok' | 'moderated' | 'failed';
export type ModerationVerdict = 'clean' | 'partial' | 'all_blocked' | 'all_failed';

/**
 * Classify a job's per-perspective outcomes.
 * - 'clean':       every perspective generated
 * - 'partial':     ≥1 generated, ≥1 blocked/failed → job still completes with
 *                  the survivors (refund + user note when a 'failed' is among them)
 * - 'all_blocked': EVERY perspective was content-moderated → CONTENT_MODERATED
 *                  failure (strike + grace-refund handling)
 * - 'all_failed':  nothing generated, but at least one loss was a transient
 *                  error → ordinary terminal failure (refund, NO strike — we
 *                  can't claim a banned-content attempt when an error, not the
 *                  filter, caused a miss)
 *
 * The worker only calls this with ≥1 outcome (the controller rejects creations
 * without a body photo). An empty list classifies as 'all_failed' — the
 * conservative reading of "nothing was generated" that never records a strike.
 */
export function classifyOutcomes(outcomes: ReadonlyArray<PerspectiveOutcome>): ModerationVerdict {
  if (outcomes.length === 0) return 'all_failed';
  const ok = outcomes.filter((o) => o === 'ok').length;
  if (ok === outcomes.length) return 'clean';
  if (ok > 0) return 'partial';
  return outcomes.every((o) => o === 'moderated') ? 'all_blocked' : 'all_failed';
}

// User-facing note stored on a COMPLETE job when one perspective hit a
// transient error on the final attempt: the survivors are delivered and the
// credit is refunded. Wording stays accurate when no credit was spent (weekly
// allowance) — "any credit spent" covers both cases.
export const PARTIAL_TRANSIENT_USER_NOTE =
  'One of your creation views hit a temporary problem and could not be generated, ' +
  'so we refunded any credit spent on this creation. The view that succeeded is ' +
  'included in your results.';

// User-facing note stored on a COMPLETE job when one perspective was blocked
// by content moderation but another generated. No refund — a result was
// delivered, and the surviving perspective passing is evidence the block was
// a filter false positive rather than a banned-content attempt.
export const PARTIAL_MODERATION_USER_NOTE =
  "One of your creation views was blocked by our AI provider's content policy. " +
  'The view that generated normally is included in your results.';

/**
 * Should this strike be treated as a refunded warning?
 * `count` is the user's lifetime strike count AFTER recording this strike
 * (so the first-ever block arrives as 1). `null` means strike bookkeeping
 * failed — count unknown — and falls back to the no-refund path, matching
 * the behavior before the grace window existed.
 */
export function isWithinModerationGrace(
  count: number | null,
  limit: number = MODERATION_GRACE_WARNINGS,
): boolean {
  return count !== null && count >= 1 && count <= limit;
}

// User-facing message stored on the FAILED job once warnings are exhausted.
export const MODERATION_USER_MESSAGE =
  "This request was blocked by our AI provider's content policy. AnimationStation " +
  'blocks sexually explicit or pornographic content. Per our Terms, the credit for ' +
  'this attempt was not refunded.';

// Variant for blocks within the warning grace window.
export function moderationWarningMessage(strike: number): string {
  return (
    "This request was blocked by our AI provider's content policy. AnimationStation " +
    'blocks sexually explicit or pornographic content. Any credit spent on this ' +
    'attempt has been refunded — this is warning ' +
    `${strike} of ${MODERATION_GRACE_WARNINGS}. After ${MODERATION_GRACE_WARNINGS} warnings, ` +
    'credits for blocked attempts are no longer refunded.'
  );
}
