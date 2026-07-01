/**
 * Pure helpers for content-moderation strike alerting. Kept free of side-effect
 * imports (no env/prisma/email) so it can be unit-tested in isolation — same
 * pattern as utils/scrub.ts. The orchestration that actually reads/writes the DB
 * and sends mail lives in services/moderationService.ts.
 */

// Admins are emailed on every Nth content-moderation strike a single user
// accrues, so a repeat offender is surfaced without watching logs. Firing on
// multiples (3, 6, 9, …) is naturally debounced — it won't alert on every strike.
// Tunable via env so the threshold can be raised once organic volume is known.
export const MODERATION_STRIKE_ALERT_EVERY =
  Number(process.env.MODERATION_STRIKE_ALERT_EVERY ?? 3) || 3;

/**
 * Should the user's Nth strike trigger an admin alert? True on positive multiples
 * of `every` (so 3, 6, 9 with the default). Guards against non-integer/zero input.
 */
export function shouldAlertOnStrike(count: number, every = MODERATION_STRIKE_ALERT_EVERY): boolean {
  return Number.isInteger(count) && count > 0 && every > 0 && count % every === 0;
}
