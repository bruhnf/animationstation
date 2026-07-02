import prisma from '../lib/prisma';
import { createChildLogger } from './logger';

const log = createChildLogger('AppSettingsService');

// Admin-tunable runtime settings live in the AppSettings table (key/value
// strings) so they can be changed from the dashboard without a redeploy. Keep
// the typed accessors here so callers never hand-roll key strings or parsing.

// Credits granted to a brand-new guest (anonymous) account on first open so they
// can try the feature before signing up. Admin-configurable via the dashboard.
// Falls back to DEFAULT_GUEST_CREDIT_GRANT when unset or unparseable. Kept small
// on purpose — see authController.createGuest for the abuse rationale.
export const GUEST_CREDIT_GRANT_KEY = 'guestCreditGrant';
export const DEFAULT_GUEST_CREDIT_GRANT = 2;

// Upper bound on what an admin can set, as a guard against a fat-fingered grant
// turning into a credit firehose. Generous, but finite.
export const MAX_GUEST_CREDIT_GRANT = 1000;

/**
 * Read the configured guest welcome-credit grant. Returns the stored value, or
 * DEFAULT_GUEST_CREDIT_GRANT when no row exists or the stored value can't be
 * parsed as a non-negative integer.
 */
export async function getGuestCreditGrant(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: GUEST_CREDIT_GRANT_KEY } });
  if (!row) return DEFAULT_GUEST_CREDIT_GRANT;
  const parsed = Number(row.value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    log.warn('Stored guestCreditGrant is invalid — using default', { value: row.value });
    return DEFAULT_GUEST_CREDIT_GRANT;
  }
  return parsed;
}

/**
 * Persist a new guest welcome-credit grant. Validates that the value is a
 * non-negative integer within [0, MAX_GUEST_CREDIT_GRANT]; throws otherwise so
 * the caller can return a 400.
 */
export async function setGuestCreditGrant(value: number): Promise<number> {
  if (!Number.isInteger(value) || value < 0 || value > MAX_GUEST_CREDIT_GRANT) {
    throw new Error(`guestCreditGrant must be an integer between 0 and ${MAX_GUEST_CREDIT_GRANT}`);
  }
  await prisma.appSetting.upsert({
    where: { key: GUEST_CREDIT_GRANT_KEY },
    create: { key: GUEST_CREDIT_GRANT_KEY, value: String(value) },
    update: { value: String(value) },
  });
  log.info('Guest credit grant updated', { value });
  return value;
}

// Credits granted ONCE to a real account when it verifies its email (the
// "welcome bonus"). Admin-configurable at runtime so the offer can be a
// limited-time promotion: raise it for a campaign, lower it, or set it to 0 to
// discontinue the welcome bonus entirely — all without a redeploy or an app
// rebuild (the actual grant is server-side; see authController.verifyEmail).
// The public /api/config endpoint echoes the live value so the app can render
// the offer copy ("Limited time offer — N Free Credits when you join") or hide
// it when 0.
export const SIGNUP_CREDIT_GRANT_KEY = 'signupCreditGrant';
export const DEFAULT_SIGNUP_CREDIT_GRANT = 10;
export const MAX_SIGNUP_CREDIT_GRANT = 1000;

/**
 * Read the configured signup/welcome-bonus credit grant. Returns the stored
 * value, or DEFAULT_SIGNUP_CREDIT_GRANT when no row exists or the stored value
 * can't be parsed as a non-negative integer. 0 = the welcome bonus is
 * discontinued (no grant, no CreditTransaction).
 */
export async function getSignupCreditGrant(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: SIGNUP_CREDIT_GRANT_KEY } });
  if (!row) return DEFAULT_SIGNUP_CREDIT_GRANT;
  const parsed = Number(row.value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    log.warn('Stored signupCreditGrant is invalid — using default', { value: row.value });
    return DEFAULT_SIGNUP_CREDIT_GRANT;
  }
  return parsed;
}

/**
 * Persist a new signup/welcome-bonus credit grant. Validates that the value is
 * a non-negative integer within [0, MAX_SIGNUP_CREDIT_GRANT]; throws otherwise
 * so the caller can return a 400. Set to 0 to discontinue the welcome bonus.
 */
export async function setSignupCreditGrant(value: number): Promise<number> {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SIGNUP_CREDIT_GRANT) {
    throw new Error(
      `signupCreditGrant must be an integer between 0 and ${MAX_SIGNUP_CREDIT_GRANT}`,
    );
  }
  await prisma.appSetting.upsert({
    where: { key: SIGNUP_CREDIT_GRANT_KEY },
    create: { key: SIGNUP_CREDIT_GRANT_KEY, value: String(value) },
    update: { value: String(value) },
  });
  log.info('Signup credit grant updated', { value });
  return value;
}

// Credits granted to BOTH the referrer and the referred user when a referred
// account verifies its email. Admin-configurable; 0 disables the referral
// program's reward (codes still resolve, just no payout). Default 5.
export const REFERRAL_CREDIT_GRANT_KEY = 'referralCreditGrant';
export const DEFAULT_REFERRAL_CREDIT_GRANT = 5;
export const MAX_REFERRAL_CREDIT_GRANT = 1000;

export async function getReferralCreditGrant(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: REFERRAL_CREDIT_GRANT_KEY } });
  if (!row) return DEFAULT_REFERRAL_CREDIT_GRANT;
  const parsed = Number(row.value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    log.warn('Stored referralCreditGrant is invalid — using default', { value: row.value });
    return DEFAULT_REFERRAL_CREDIT_GRANT;
  }
  return parsed;
}

export async function setReferralCreditGrant(value: number): Promise<number> {
  if (!Number.isInteger(value) || value < 0 || value > MAX_REFERRAL_CREDIT_GRANT) {
    throw new Error(
      `referralCreditGrant must be an integer between 0 and ${MAX_REFERRAL_CREDIT_GRANT}`,
    );
  }
  await prisma.appSetting.upsert({
    where: { key: REFERRAL_CREDIT_GRANT_KEY },
    create: { key: REFERRAL_CREDIT_GRANT_KEY, value: String(value) },
    update: { value: String(value) },
  });
  log.info('Referral credit grant updated', { value });
  return value;
}

// Anti-farming cap: the maximum number of REWARDED referrals a single referrer
// can earn within REFERRAL_REWARD_WINDOW_DAYS. Beyond it, the referral is still
// recorded (and the referred user still gets their join bonus) but the
// REFERRER's payout is withheld. 0 = unlimited (cap disabled). Admin-tunable.
export const REFERRAL_MAX_PER_WINDOW_KEY = 'referralMaxPerWindow';
export const DEFAULT_REFERRAL_MAX_PER_WINDOW = 20;
export const MAX_REFERRAL_MAX_PER_WINDOW = 100000;
// Rolling window the cap is measured over. Fixed (not admin-tunable) to keep the
// surface small; change here if needed.
export const REFERRAL_REWARD_WINDOW_DAYS = 30;

export async function getReferralMaxPerWindow(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: REFERRAL_MAX_PER_WINDOW_KEY } });
  if (!row) return DEFAULT_REFERRAL_MAX_PER_WINDOW;
  const parsed = Number(row.value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    log.warn('Stored referralMaxPerWindow is invalid — using default', { value: row.value });
    return DEFAULT_REFERRAL_MAX_PER_WINDOW;
  }
  return parsed;
}

export async function setReferralMaxPerWindow(value: number): Promise<number> {
  if (!Number.isInteger(value) || value < 0 || value > MAX_REFERRAL_MAX_PER_WINDOW) {
    throw new Error(
      `referralMaxPerWindow must be an integer between 0 and ${MAX_REFERRAL_MAX_PER_WINDOW}`,
    );
  }
  await prisma.appSetting.upsert({
    where: { key: REFERRAL_MAX_PER_WINDOW_KEY },
    create: { key: REFERRAL_MAX_PER_WINDOW_KEY, value: String(value) },
    update: { value: String(value) },
  });
  log.info('Referral max-per-window updated', { value });
  return value;
}

// Credits charged to generate one AI video (image-to-video). Video generation
// costs more than a still image, so it defaults higher than a creation's 1
// credit. Admin-configurable at runtime; must be >= 1 (a 0-cost video would be
// a free firehose on a paid AI call).
export const VIDEO_CREDIT_COST_KEY = 'videoCreditCost';
export const DEFAULT_VIDEO_CREDIT_COST = 2;
export const MIN_VIDEO_CREDIT_COST = 1;
export const MAX_VIDEO_CREDIT_COST = 1000;

export async function getVideoCreditCost(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: VIDEO_CREDIT_COST_KEY } });
  if (!row) return DEFAULT_VIDEO_CREDIT_COST;
  const parsed = Number(row.value);
  if (!Number.isInteger(parsed) || parsed < MIN_VIDEO_CREDIT_COST) {
    log.warn('Stored videoCreditCost is invalid — using default', { value: row.value });
    return DEFAULT_VIDEO_CREDIT_COST;
  }
  return parsed;
}

export async function setVideoCreditCost(value: number): Promise<number> {
  if (!Number.isInteger(value) || value < MIN_VIDEO_CREDIT_COST || value > MAX_VIDEO_CREDIT_COST) {
    throw new Error(
      `videoCreditCost must be an integer between ${MIN_VIDEO_CREDIT_COST} and ${MAX_VIDEO_CREDIT_COST}`,
    );
  }
  await prisma.appSetting.upsert({
    where: { key: VIDEO_CREDIT_COST_KEY },
    create: { key: VIDEO_CREDIT_COST_KEY, value: String(value) },
    update: { value: String(value) },
  });
  log.info('Video credit cost updated', { value });
  return value;
}

// Gates the client-side welcome splash screen shown to users at login (they can
// opt out on the device). Admin-configurable at runtime; the public /api/config
// endpoint echoes the live value so the app can show or suppress the splash
// without a rebuild. Defaults to false (splash off) until an admin enables it.
export const WELCOME_SPLASH_ENABLED_KEY = 'welcomeSplashEnabled';
export const DEFAULT_WELCOME_SPLASH_ENABLED = false;

/**
 * Read whether the welcome splash screen is enabled. Returns the stored value,
 * or DEFAULT_WELCOME_SPLASH_ENABLED when no row exists. Stored as '1' (true) /
 * '0' (false) in the AppSettings table.
 */
export async function getWelcomeSplashEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: WELCOME_SPLASH_ENABLED_KEY } });
  if (!row) return DEFAULT_WELCOME_SPLASH_ENABLED;
  return row.value === '1';
}

/**
 * Persist whether the welcome splash screen is enabled. Stores '1' (true) /
 * '0' (false) in the AppSettings table and returns the boolean.
 */
export async function setWelcomeSplashEnabled(value: boolean): Promise<boolean> {
  await prisma.appSetting.upsert({
    where: { key: WELCOME_SPLASH_ENABLED_KEY },
    create: { key: WELCOME_SPLASH_ENABLED_KEY, value: value ? '1' : '0' },
    update: { value: value ? '1' : '0' },
  });
  log.info('Welcome splash enabled updated', { value });
  return value;
}
