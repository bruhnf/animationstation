import { Queue, Worker } from 'bullmq';
import { connection } from './tryonQueue';
import prisma from '../lib/prisma';
import { sendGuestAbuseAlert, sendReferralAbuseAlert } from '../services/emailService';
import { env } from '../config/env';
import { createChildLogger } from '../services/logger';
import { adminDashboardUrl } from '../utils/adminUrl';
import { withCronMonitor } from '../utils/cronMonitor';

const log = createChildLogger('GuestAbuseMonitor');

// Hourly check for guest-credit farming. Anonymous guest accounts each get a
// small free-credit grant; the only abuse vector is creating many guests (e.g.
// scripted, or repeated device wipes). We can't watch logs daily, so this job
// emails the admin allowlist when sign-up volume crosses a threshold — globally
// or from a single IP. Prevention (rate limit + Keychain persistence on iOS)
// stays in place; this is the "tell me if it's happening anyway" layer.
//
// Tunables via env (sensible defaults for a young app — raise GLOBAL once you
// know your organic guest volume so a real launch spike doesn't page you).
const WINDOW_HOURS = Number(process.env.GUEST_ABUSE_WINDOW_HOURS ?? 24);
const GLOBAL_THRESHOLD = Number(process.env.GUEST_ABUSE_GLOBAL_THRESHOLD ?? 100);
const PER_IP_THRESHOLD = Number(process.env.GUEST_ABUSE_PER_IP_THRESHOLD ?? 20);
const ALERT_COOLDOWN_HOURS = Number(process.env.GUEST_ABUSE_COOLDOWN_HOURS ?? 12);
// AppSettings key holding the ISO timestamp of the last alert (debounce).
const LAST_ALERT_KEY = 'guestAbuseLastAlertAt';

// Referral-farming velocity check (runs in the same hourly job). The per-referrer
// cap (appSettingsService) withholds an individual referrer's payout past its
// limit, but a ring of accounts can still spread referrals around — this is the
// "tell me if referral volume is spiking" layer.
const REF_WINDOW_DAYS = Number(process.env.REFERRAL_ABUSE_WINDOW_DAYS ?? 30);
const REF_GLOBAL_THRESHOLD = Number(process.env.REFERRAL_ABUSE_GLOBAL_THRESHOLD ?? 200);
const REF_PER_REFERRER_THRESHOLD = Number(process.env.REFERRAL_ABUSE_PER_REFERRER_THRESHOLD ?? 30);
const REF_LAST_ALERT_KEY = 'referralAbuseLastAlertAt';

export const guestAbuseQueue = new Queue('guest-abuse-monitor', { connection });

async function runCheck(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  // Guest creations are recorded as UserLocation rows with trigger
  // 'guest_create' (see authController.createGuest). Group by IP over the
  // window. Rows for converted guests persist (still a real sign-up); rows for
  // cleaned-up guests cascade away (irrelevant for a <=24h window).
  const grouped = await prisma.userLocation.groupBy({
    by: ['ip'],
    where: { trigger: 'guest_create', timestamp: { gte: since } },
    _count: true,
  });

  const topIps = grouped
    .map((g) => ({ ip: g.ip, count: g._count }))
    .sort((a, b) => b.count - a.count);
  const totalGuests = topIps.reduce((sum, r) => sum + r.count, 0);
  const worstIp = topIps[0]?.count ?? 0;

  const tripped = totalGuests >= GLOBAL_THRESHOLD || worstIp >= PER_IP_THRESHOLD;
  if (!tripped) {
    log.info('Guest abuse check ok', { totalGuests, worstIp, windowHours: WINDOW_HOURS });
    return;
  }

  // Debounce: don't re-alert within the cooldown window.
  const last = await prisma.appSetting.findUnique({ where: { key: LAST_ALERT_KEY } });
  if (last) {
    const lastMs = Date.parse(last.value);
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < ALERT_COOLDOWN_HOURS * 60 * 60 * 1000) {
      log.warn('Guest abuse thresholds crossed but within cooldown — skipping alert', {
        totalGuests,
        worstIp,
      });
      return;
    }
  }

  const adminUrl = adminDashboardUrl(env.appUrl);
  await Promise.allSettled(
    env.adminEmails.map((email) =>
      sendGuestAbuseAlert(email, {
        windowHours: WINDOW_HOURS,
        totalGuests,
        topIps: topIps.slice(0, 10),
        globalThreshold: GLOBAL_THRESHOLD,
        perIpThreshold: PER_IP_THRESHOLD,
        adminUrl,
      }),
    ),
  );

  await prisma.appSetting.upsert({
    where: { key: LAST_ALERT_KEY },
    create: { key: LAST_ALERT_KEY, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  log.warn('Guest abuse alert sent', { totalGuests, worstIp, alertedEmails: env.adminEmails });
}

async function runReferralCheck(): Promise<void> {
  const since = new Date(Date.now() - REF_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Count rewarded referrals per referrer over the window (rewardedAt set =
  // a completed referral, whether or not the referrer's payout was capped).
  const grouped = await prisma.referral.groupBy({
    by: ['referrerId'],
    where: { rewardedAt: { gte: since } },
    _count: true,
  });

  const top = grouped
    .map((g) => ({ referrerId: g.referrerId, count: g._count }))
    .sort((a, b) => b.count - a.count);
  const totalRewarded = top.reduce((sum, r) => sum + r.count, 0);
  const worst = top[0]?.count ?? 0;

  const tripped = totalRewarded >= REF_GLOBAL_THRESHOLD || worst >= REF_PER_REFERRER_THRESHOLD;
  if (!tripped) {
    log.info('Referral abuse check ok', { totalRewarded, worst, windowDays: REF_WINDOW_DAYS });
    return;
  }

  const last = await prisma.appSetting.findUnique({ where: { key: REF_LAST_ALERT_KEY } });
  if (last) {
    const lastMs = Date.parse(last.value);
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < ALERT_COOLDOWN_HOURS * 60 * 60 * 1000) {
      log.warn('Referral abuse thresholds crossed but within cooldown — skipping alert', {
        totalRewarded,
        worst,
      });
      return;
    }
  }

  const adminUrl = adminDashboardUrl(env.appUrl);
  await Promise.allSettled(
    env.adminEmails.map((email) =>
      sendReferralAbuseAlert(email, {
        windowDays: REF_WINDOW_DAYS,
        totalRewarded,
        topReferrers: top.slice(0, 10),
        globalThreshold: REF_GLOBAL_THRESHOLD,
        perReferrerThreshold: REF_PER_REFERRER_THRESHOLD,
        adminUrl,
      }),
    ),
  );

  await prisma.appSetting.upsert({
    where: { key: REF_LAST_ALERT_KEY },
    create: { key: REF_LAST_ALERT_KEY, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  log.warn('Referral abuse alert sent', { totalRewarded, worst, alertedEmails: env.adminEmails });
}

const worker = new Worker(
  'guest-abuse-monitor',
  (job) =>
    withCronMonitor(
      { slug: 'guest-abuse-monitor', crontab: '0 * * * *', maxRuntimeMinutes: 10 },
      async () => {
        log.info('Running guest abuse check', { jobId: job.id });
        // Error-isolate the two checks so a failure in one still runs the other.
        const results = await Promise.allSettled([runCheck(), runReferralCheck()]);
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            log.error('Abuse sub-check failed', {
              check: i === 0 ? 'guest' : 'referral',
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
          }
        });
        return { ok: true };
      },
    ),
  { connection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
  log.error('Guest abuse monitor job failed', { jobId: job?.id, error: err.message });
});

/**
 * Schedule the recurring guest-abuse check. Runs hourly so a farming spike is
 * caught within ~1 hour rather than the next day.
 */
export async function scheduleGuestAbuseMonitor(): Promise<void> {
  try {
    const existing = await guestAbuseQueue.getRepeatableJobs();
    for (const j of existing) {
      await guestAbuseQueue.removeRepeatableByKey(j.key);
    }
    await guestAbuseQueue.add('hourly-guest-abuse-check', {}, { repeat: { pattern: '0 * * * *' } });
    log.info('Guest abuse monitor scheduled', { schedule: 'Hourly' });
  } catch (error) {
    log.error('Failed to schedule guest abuse monitor', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default worker;
