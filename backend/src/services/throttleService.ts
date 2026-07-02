/**
 * Soft per-user throttle for creation submissions.
 *
 * Sits on top of the hard per-IP rate limit (5 POST/min) and the weekly /
 * credit gates. Where those refuse the request, this layer instead accepts
 * it and defers execution via BullMQ's `delay` option, so the client can
 * show a "starts in X:XX" countdown. The goal is to flatten the Grok API
 * cost curve for rapid-fire bursts without breaking the happy path for
 * normal usage — a shopper trying on a bunch of outfits should sail through
 * her whole burst, only hitting a short (≤60s) pace once she's well past it.
 *
 * The config (window, per-tier free burst, delay ladder) is stored as a
 * single JSON blob in the AppSettings table so it's admin-tunable at runtime
 * from the dashboard (⚙️ Settings) with no redeploy — see getThrottleConfig /
 * setThrottleConfig and routes/admin.ts `PATCH /settings/throttle`. A missing
 * or malformed row transparently falls back to DEFAULT_THROTTLE_CONFIG so a
 * bad value can never brick creation submission.
 */
import type { UserTier } from '@prisma/client';
import prisma from '../lib/prisma';
import { createChildLogger } from './logger';

const log = createChildLogger('ThrottleService');

export interface ThrottleConfig {
  /** Rolling window over which submissions are counted, in ms. */
  windowMs: number;
  /** Submissions allowed with zero delay within the window, per tier. */
  burst: Record<UserTier, number>;
  /**
   * Delay ladder (ms) applied once the burst is exhausted. Each subsequent
   * submission inside the window steps further down; the last entry is the cap.
   */
  ladderMs: number[];
}

/**
 * Default throttle config. Tuned for the "department-store shopper" case: a
 * generous free burst covers a full enthusiastic session, and the ladder caps
 * at 40s so no one ever waits more than a glance. Total volume is already
 * bounded by credits / the weekly allowance — this only smooths bursts and
 * backstops a runaway client.
 */
export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  burst: { FREE: 6, BASIC: 8, PREMIUM: 10 },
  ladderMs: [10_000, 20_000, 30_000, 40_000], // 10s → 20s → 30s → 40s (cap)
};

export const THROTTLE_CONFIG_KEY = 'throttleConfig';

// Validation bounds (also guard the admin setter against a fat-finger).
export const MIN_THROTTLE_WINDOW_MS = 60 * 1000; // 1 minute
export const MAX_THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
export const MAX_BURST = 100;
export const MAX_LADDER_RUNGS = 10;
// Hard ceiling on any single ladder rung. A user must never be queued for more
// than a minute, so even an admin can't set a rung above 60s.
export const MAX_LADDER_MS = 60 * 1000; // 60 seconds

export interface ThrottleDecision {
  /** Milliseconds to defer the BullMQ job. 0 = run immediately. */
  delayMs: number;
  /**
   * 1-based position of this submission within the rolling window
   * (including itself). Useful for logging / future tuning.
   */
  ordinal: number;
  /** Free burst size that applied for this tier. */
  burst: number;
}

const TIERS: readonly UserTier[] = ['FREE', 'BASIC', 'PREMIUM'] as const;

/**
 * Validate an arbitrary input into a well-formed ThrottleConfig, throwing a
 * descriptive Error on anything invalid. Used strictly by the admin setter
 * (so bad input → 400) and leniently by the reader (which catches + falls back
 * to DEFAULT_THROTTLE_CONFIG). Exported for unit testing.
 */
export function validateThrottleConfig(input: unknown): ThrottleConfig {
  if (typeof input !== 'object' || input === null) {
    throw new Error('throttle config must be an object');
  }
  const o = input as Record<string, unknown>;

  const windowMs = Number(o.windowMs);
  if (
    !Number.isInteger(windowMs) ||
    windowMs < MIN_THROTTLE_WINDOW_MS ||
    windowMs > MAX_THROTTLE_WINDOW_MS
  ) {
    throw new Error(
      `windowMs must be an integer between ${MIN_THROTTLE_WINDOW_MS} and ${MAX_THROTTLE_WINDOW_MS}`,
    );
  }

  if (typeof o.burst !== 'object' || o.burst === null) {
    throw new Error('burst must be an object with FREE / BASIC / PREMIUM');
  }
  const burstIn = o.burst as Record<string, unknown>;
  const burst = {} as Record<UserTier, number>;
  for (const tier of TIERS) {
    const b = Number(burstIn[tier]);
    if (!Number.isInteger(b) || b < 0 || b > MAX_BURST) {
      throw new Error(`burst.${tier} must be an integer between 0 and ${MAX_BURST}`);
    }
    burst[tier] = b;
  }

  if (!Array.isArray(o.ladderMs) || o.ladderMs.length < 1 || o.ladderMs.length > MAX_LADDER_RUNGS) {
    throw new Error(`ladderMs must be an array of 1 to ${MAX_LADDER_RUNGS} values`);
  }
  const ladderMs = o.ladderMs.map((x) => {
    const v = Number(x);
    if (!Number.isInteger(v) || v < 0 || v > MAX_LADDER_MS) {
      throw new Error(`each ladder rung must be an integer between 0 and ${MAX_LADDER_MS} ms`);
    }
    return v;
  });

  return { windowMs, burst, ladderMs };
}

/**
 * Read the live throttle config from AppSettings, falling back to
 * DEFAULT_THROTTLE_CONFIG when no row exists or the stored value is invalid.
 * Never throws — a corrupt row must not break creation submission.
 */
export async function getThrottleConfig(): Promise<ThrottleConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: THROTTLE_CONFIG_KEY } });
  if (!row) return DEFAULT_THROTTLE_CONFIG;
  try {
    return validateThrottleConfig(JSON.parse(row.value));
  } catch (err) {
    log.warn('Stored throttleConfig is invalid — using default', {
      error: (err as Error).message,
    });
    return DEFAULT_THROTTLE_CONFIG;
  }
}

/**
 * Persist a new throttle config. Validates strictly (throws on bad input so the
 * route can return a 400) and stores it as a JSON blob.
 */
export async function setThrottleConfig(input: unknown): Promise<ThrottleConfig> {
  const cfg = validateThrottleConfig(input);
  await prisma.appSetting.upsert({
    where: { key: THROTTLE_CONFIG_KEY },
    create: { key: THROTTLE_CONFIG_KEY, value: JSON.stringify(cfg) },
    update: { value: JSON.stringify(cfg) },
  });
  log.info('Throttle config updated', { ...cfg });
  return cfg;
}

/**
 * Stamp `User.throttleResetAt = now` so the throttle's window count restarts
 * for this user. Called when a user buys credits / subscribes, so a freshly
 * paying user is never stuck mid-ladder in the pacing queue. Best-effort: a
 * failure here must never break the purchase flow, so callers fire-and-forget.
 */
export async function resetUserThrottle(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { throttleResetAt: new Date() },
    });
    log.info('User throttle reset (purchase)', { userId });
  } catch (err) {
    log.warn('Failed to reset user throttle', { userId, error: (err as Error).message });
  }
}

/**
 * Pure ladder math, extracted so it can be unit-tested without a DB. Given the
 * 1-based ordinal of a submission within the window and the user's tier, returns
 * the BullMQ delay and the tier's free-burst size. `ordinal <= burst` runs
 * immediately; beyond that it steps down the config's ladder, capping at the
 * last rung.
 */
export function delayForOrdinal(
  ordinal: number,
  tier: UserTier,
  config: ThrottleConfig = DEFAULT_THROTTLE_CONFIG,
): { delayMs: number; burst: number } {
  const burst = config.burst[tier];
  if (ordinal <= burst) return { delayMs: 0, burst };
  const ladder = config.ladderMs;
  const idx = Math.min(ordinal - burst - 1, ladder.length - 1);
  return { delayMs: ladder[idx], burst };
}

/**
 * Compute the throttle delay for the next submission a user is about to make.
 * Counts the user's non-FAILED submissions in the rolling window — matching the
 * same exclusion rule used by the weekly-limit query, since a failed-and-refunded
 * job didn't actually consume Grok cost. A `throttleResetAt` later than the
 * window start (set on purchase) shrinks the effective window so a paying user
 * starts with a clean burst.
 *
 * Must be called AFTER the credit/weekly gates pass and BEFORE the row is
 * created — the count it does is "submissions made before this one", so
 * `ordinal = count + 1`.
 */
export async function computeQueueDelayMs(
  userId: string,
  tier: UserTier,
): Promise<ThrottleDecision> {
  const [config, user] = await Promise.all([
    getThrottleConfig(),
    prisma.user.findUnique({ where: { id: userId }, select: { throttleResetAt: true } }),
  ]);

  const windowStart = new Date(Date.now() - config.windowMs);
  // Honor a post-purchase reset: ignore everything before it.
  const effectiveSince =
    user?.throttleResetAt && user.throttleResetAt > windowStart
      ? user.throttleResetAt
      : windowStart;

  const recent = await prisma.creation.count({
    where: { userId, createdAt: { gte: effectiveSince }, status: { not: 'FAILED' } },
  });
  const ordinal = recent + 1;
  const { delayMs, burst } = delayForOrdinal(ordinal, tier, config);
  return { delayMs, ordinal, burst };
}
