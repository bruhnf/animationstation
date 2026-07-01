import { Router, Request, Response } from 'express';
import { ApplePurchase, JobStatus, Prisma, ReportStatus, UserTier } from '@prisma/client';
import { requireAdmin } from '../middleware/auth';
import prisma from '../lib/prisma';
import { hashPassword } from '../utils/password';
import { isUniqueConstraintError } from '../utils/prismaErrors';
import { adminCreateUserSchema, firstZodError } from '../validation/adminSchemas';
import { getLatestReportSummary, runAllScans } from '../services/vulnerabilityService';
import { triggerImmediateScan } from '../queue/vulnerabilityWorker';
import {
  presignUserPhotos,
  presignTryOnJob,
  presignTryOnJobs,
  presignAvatarOnly,
} from '../services/imageUrlService';
import {
  refreshSubscriptionForUser,
  AppleServerApiNotConfiguredError,
  AppleServerApiNoSubscriptionError,
} from '../services/appleServerApiService';
import { deleteFromS3, listS3ObjectsUnderPrefix, listUserS3Keys } from '../services/s3Service';
import { deleteActorOrphanedNotifications } from '../services/accountDeletionService';
import { collectDiagnostics } from '../services/diagnosticsService';
import {
  getGuestCreditGrant,
  setGuestCreditGrant,
  DEFAULT_GUEST_CREDIT_GRANT,
  MAX_GUEST_CREDIT_GRANT,
  getSignupCreditGrant,
  setSignupCreditGrant,
  DEFAULT_SIGNUP_CREDIT_GRANT,
  MAX_SIGNUP_CREDIT_GRANT,
  getReferralCreditGrant,
  setReferralCreditGrant,
  DEFAULT_REFERRAL_CREDIT_GRANT,
  MAX_REFERRAL_CREDIT_GRANT,
  getReferralMaxPerWindow,
  setReferralMaxPerWindow,
  DEFAULT_REFERRAL_MAX_PER_WINDOW,
  MAX_REFERRAL_MAX_PER_WINDOW,
  REFERRAL_REWARD_WINDOW_DAYS,
  getVideoCreditCost,
  setVideoCreditCost,
  DEFAULT_VIDEO_CREDIT_COST,
  MIN_VIDEO_CREDIT_COST,
  MAX_VIDEO_CREDIT_COST,
} from '../services/appSettingsService';
import {
  getThrottleConfig,
  setThrottleConfig,
  DEFAULT_THROTTLE_CONFIG,
  MIN_THROTTLE_WINDOW_MS,
  MAX_THROTTLE_WINDOW_MS,
  MAX_BURST,
  MAX_LADDER_RUNGS,
  MAX_LADDER_MS,
} from '../services/throttleService';
import {
  getSentryStatus,
  fetchRecentIssues,
  sendTestEvent,
  SentryNotConfiguredError,
} from '../services/sentryService';
import {
  getActiveSplash,
  publishSplash,
  removeSplash,
  splashImageUrl,
} from '../services/splashService';
import { uploadSingle } from '../middleware/uploadMiddleware';

const router = Router();

router.use(requireAdmin);

type SubscriptionState =
  | 'ACTIVE' // entitlement valid, will renew
  | 'PENDING_CANCELLATION' // user turned auto-renew off; ends at expiresAt
  | 'BILLING_RETRY' // card declined; Apple is retrying — user may churn
  | 'GRACE_PERIOD' // card declined; entitlement preserved temporarily
  | 'EXPIRED' // expiresAt is in the past
  | 'REVOKED' // refunded/revoked by Apple
  | 'UNKNOWN'; // legacy row written before autoRenewStatus shipped

interface SubscriptionStatus {
  purchaseId: string;
  productId: string;
  tier: UserTier;
  expiresAt: Date | null;
  autoRenewStatus: boolean | null;
  // Apple's Status enum (1=ACTIVE, 2=EXPIRED, 3=BILLING_RETRY, 4=GRACE_PERIOD, 5=REVOKED).
  // Null when never refreshed via the App Store Server API.
  appleStatus: number | null;
  lastSyncedFromAppleAt: Date | null;
  state: SubscriptionState;
  pendingCancellation: boolean;
}

// Derive a single user's subscription status from their most recent
// subscription-tier ApplePurchase row. Credit-pack purchases are excluded
// (their tier is FREE; they don't grant subscription entitlement).
//
// When `appleStatus` is present (admin pulled live status from the App Store
// Server API), it takes precedence over derived signals — it's Apple's
// authoritative view, including states we can't infer from webhooks alone
// (BILLING_RETRY, GRACE_PERIOD).
function deriveSubscriptionStatus(purchase: ApplePurchase | null): SubscriptionStatus | null {
  if (!purchase) return null;
  const now = new Date();
  const expired = purchase.expiresAt !== null && purchase.expiresAt <= now;
  let state: SubscriptionState;
  if (purchase.revokedAt || purchase.appleStatus === 5) {
    state = 'REVOKED';
  } else if (purchase.appleStatus === 3) {
    state = 'BILLING_RETRY';
  } else if (purchase.appleStatus === 4) {
    state = 'GRACE_PERIOD';
  } else if (purchase.appleStatus === 2 || expired) {
    state = 'EXPIRED';
  } else if (purchase.autoRenewStatus === false) {
    state = 'PENDING_CANCELLATION';
  } else if (purchase.autoRenewStatus === true || purchase.appleStatus === 1) {
    state = 'ACTIVE';
  } else {
    state = 'UNKNOWN';
  }
  return {
    purchaseId: purchase.id,
    productId: purchase.productId,
    tier: purchase.tier,
    expiresAt: purchase.expiresAt,
    autoRenewStatus: purchase.autoRenewStatus,
    appleStatus: purchase.appleStatus,
    lastSyncedFromAppleAt: purchase.lastSyncedFromAppleAt,
    state,
    pendingCancellation: state === 'PENDING_CANCELLATION',
  };
}

// Look up the latest subscription ApplePurchase per user in a single query,
// so the user-list endpoint doesn't fan out into N follow-up queries.
async function loadSubscriptionStatusByUser(
  userIds: string[],
): Promise<Map<string, SubscriptionStatus>> {
  if (userIds.length === 0) return new Map();
  const purchases = await prisma.applePurchase.findMany({
    where: {
      userId: { in: userIds },
      tier: { in: ['BASIC', 'PREMIUM'] },
    },
    orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
  });
  const byUser = new Map<string, ApplePurchase>();
  for (const p of purchases) {
    if (!byUser.has(p.userId)) byUser.set(p.userId, p);
  }
  const result = new Map<string, SubscriptionStatus>();
  for (const [userId, p] of byUser) {
    const status = deriveSubscriptionStatus(p);
    if (status) result.set(userId, status);
  }
  return result;
}

router.get('/users', async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      verified: true,
      tier: true,
      credits: true,
      tryOnCount: true,
      moderationBlockCount: true,
      lastModerationBlockAt: true,
      aiProcessingConsentAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const subStatusByUser = await loadSubscriptionStatusByUser(users.map((u) => u.id));
  const usersWithStatus = users.map((u) => ({
    ...u,
    subscriptionStatus: subStatusByUser.get(u.id) ?? null,
  }));
  res.json(usersWithStatus);
});

// Create test user
router.post('/users', async (req: Request, res: Response) => {
  // Validate + normalize (trim) before anything touches the DB. Critically, the
  // email must be a real, TLD-bearing address: without this, a malformed email
  // (e.g. a missing ".com") saved silently and then login/forgot-password — which
  // require a valid email — could never match the account.
  const parsed = adminCreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstZodError(parsed.error) });
    return;
  }
  const { firstName, lastName, username, email, password } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { username: { equals: username, mode: 'insensitive' } },
      ],
    },
  });
  if (existing) {
    res.status(409).json({
      error:
        existing.email?.toLowerCase() === email.toLowerCase()
          ? 'Email already in use'
          : 'Username taken',
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  try {
    const user = await prisma.user.create({
      data: { firstName, lastName, username, email, passwordHash, verified: true },
      select: { id: true, username: true, email: true, verified: true, credits: true },
    });
    res.status(201).json(user);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      res.status(409).json({ error: 'Email or username already in use' });
      return;
    }
    throw err;
  }
});

// Get single user with locations
router.get('/user/:userId', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: {
      id: true,
      username: true,
      email: true,
      verified: true,
      tier: true,
      credits: true,
      tryOnCount: true,
      moderationBlockCount: true,
      lastModerationBlockAt: true,
      aiProcessingConsentAt: true,
      firstName: true,
      lastName: true,
      bio: true,
      avatarUrl: true,
      fullBodyUrl: true,
      mediumBodyUrl: true,
      followingCount: true,
      followersCount: true,
      likesCount: true,
      address: true,
      city: true,
      state: true,
      createdAt: true,
      updatedAt: true,
      locations: {
        orderBy: { timestamp: 'desc' },
        take: 10,
      },
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const latestSubscription = await prisma.applePurchase.findFirst({
    where: {
      userId: user.id,
      tier: { in: ['BASIC', 'PREMIUM'] },
    },
    orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
  });
  const subscriptionStatus = deriveSubscriptionStatus(latestSubscription);
  const applePurchaseCount = await prisma.applePurchase.count({
    where: { userId: user.id },
  });

  const presigned = await presignUserPhotos(user);
  res.json({ ...presigned, subscriptionStatus, applePurchaseCount });
});

// All try-on sessions for one user, newest first — powers the dashboard's
// per-user Try-On Sessions gallery (body photo + clothing + results per job).
router.get('/user/:userId/jobs', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)), 50);
  const skip = Math.max(0, parseInt((req.query.skip as string) ?? '0', 10));

  const [jobs, total] = await Promise.all([
    prisma.tryOnJob.findMany({
      where: { userId: req.params.userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.tryOnJob.count({ where: { userId: req.params.userId } }),
  ]);

  res.json({ jobs: await presignTryOnJobs(jobs), total });
});

router.get('/jobs', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(1, parseInt((req.query.limit as string) ?? '25', 10)), 100);
  const skip = Math.max(0, parseInt((req.query.skip as string) ?? '0', 10));
  const search = ((req.query.search as string) ?? '').trim();
  const statusParam = req.query.status as string | undefined;

  const where: Prisma.TryOnJobWhereInput = {};
  if (statusParam && ['PENDING', 'PROCESSING', 'COMPLETE', 'FAILED'].includes(statusParam)) {
    where.status = statusParam as JobStatus;
  }
  if (search) {
    where.OR = [
      { user: { username: { contains: search, mode: 'insensitive' } } },
      { id: { startsWith: search } },
    ];
  }

  const [jobs, total] = await Promise.all([
    prisma.tryOnJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { user: { select: { username: true } } },
    }),
    prisma.tryOnJob.count({ where }),
  ]);

  res.json({ jobs: await presignTryOnJobs(jobs), total });
});

router.delete('/user/:userId', async (req: Request, res: Response) => {
  const userId = req.params.userId;

  // Gather S3 keys BEFORE deletion — Prisma cascade drops TryOnJob/ClosetItem
  // rows, which is where the clothing/result/closet keys live.
  const [user, jobs, closetItems] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, fullBodyUrl: true, mediumBodyUrl: true },
    }),
    prisma.tryOnJob.findMany({
      where: { userId },
      select: {
        clothingPhoto1Url: true,
        clothingPhoto2Url: true,
        resultFullBodyUrl: true,
        resultMediumUrl: true,
      },
    }),
    prisma.closetItem.findMany({ where: { userId }, select: { imageUrl: true } }),
  ]);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const s3Keys = await listUserS3Keys(
    user.avatarUrl,
    user.fullBodyUrl,
    user.mediumBodyUrl,
    jobs,
    closetItems.map((c) => c.imageUrl),
  );

  // Drop the "Someone liked/followed you" notifications this user generated for
  // others before the row is gone (else SetNull leaves orphaned tombstones).
  await deleteActorOrphanedNotifications(userId);

  await prisma.user.delete({ where: { id: userId } });

  // Fire-and-forget S3 cleanup — same pattern as profileController.deleteAccount.
  for (const key of s3Keys) {
    deleteFromS3(key).catch(() => {});
  }

  res.json({ message: 'User deleted', s3KeysQueued: s3Keys.size });
});

router.patch('/user/:userId/verify', async (req: Request, res: Response) => {
  const { verified } = req.body as { verified?: boolean };
  if (typeof verified !== 'boolean') {
    res.status(400).json({ error: 'verified must be a boolean' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { verified },
    select: { id: true, username: true, email: true, verified: true },
  });
  res.json(user);
});

router.patch('/user/:userId/subscription', async (req: Request, res: Response) => {
  const { tier } = req.body as { tier?: 'FREE' | 'BASIC' | 'PREMIUM' };
  if (!tier || !['FREE', 'BASIC', 'PREMIUM'].includes(tier)) {
    res.status(400).json({ error: 'tier must be FREE, BASIC, or PREMIUM' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { tier },
    select: { id: true, username: true, email: true, tier: true, credits: true },
  });
  res.json(user);
});

// Pull authoritative subscription state from the App Store Server API and
// reconcile our ApplePurchase row. Useful when webhook drift is suspected, or
// to populate Unknown/legacy rows. Returns the refreshed subscriptionStatus
// so the dashboard can re-render the row in place.
router.post('/user/:userId/refresh-subscription', async (req: Request, res: Response) => {
  try {
    const result = await refreshSubscriptionForUser(req.params.userId);
    const purchase = await prisma.applePurchase.findFirst({
      where: { userId: req.params.userId, tier: { in: ['BASIC', 'PREMIUM'] } },
      orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
    });
    const applePurchaseCount = await prisma.applePurchase.count({
      where: { userId: req.params.userId },
    });
    res.json({
      matched: result.matched,
      subscriptionStatus: deriveSubscriptionStatus(purchase),
      applePurchaseCount,
    });
  } catch (err) {
    if (err instanceof AppleServerApiNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof AppleServerApiNoSubscriptionError) {
      res.status(404).json({ error: err.message });
      return;
    }
    // File-not-found and other Apple API errors — surface as 503 so the
    // dashboard shows the message rather than crashing to unhandledRejection.
    res.status(503).json({ error: (err as Error).message });
  }
});

router.delete('/user/:userId/apple-purchase/:purchaseId', async (req: Request, res: Response) => {
  const { userId, purchaseId } = req.params;
  const purchase = await prisma.applePurchase.findFirst({
    where: { id: purchaseId, userId },
  });
  if (!purchase) {
    res.status(404).json({ error: 'Purchase record not found for this user' });
    return;
  }
  await prisma.applePurchase.delete({ where: { id: purchaseId } });
  // If no subscription-tier purchases remain, reset tier to FREE
  const remaining = await prisma.applePurchase.count({
    where: { userId, tier: { in: ['BASIC', 'PREMIUM'] } },
  });
  let newTier: string | null = null;
  if (remaining === 0) {
    await prisma.user.update({ where: { id: userId }, data: { tier: 'FREE' } });
    newTier = 'FREE';
  }
  res.json({ deleted: true, newTier });
});

// Wipe every ApplePurchase row for a user and reset tier to FREE. Intended for
// clearing out stale sandbox/TestFlight test transactions that accumulate one
// row per renewal. Granted credits are unaffected (they live on the User row
// and in CreditTransaction, not ApplePurchase).
router.delete('/user/:userId/apple-purchases', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const result = await prisma.applePurchase.deleteMany({ where: { userId } });
  await prisma.user.updateMany({ where: { id: userId }, data: { tier: 'FREE' } });
  res.json({ deleted: result.count });
});

router.patch('/user/:userId/credits', async (req: Request, res: Response) => {
  const { amount, reason } = req.body as { amount?: number; reason?: string };
  if (typeof amount !== 'number' || amount === 0) {
    res.status(400).json({ error: 'amount must be a non-zero number' });
    return;
  }

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: req.params.userId },
      data: { credits: { increment: amount } },
      select: { id: true, username: true, email: true, credits: true },
    }),
    prisma.creditTransaction.create({
      data: {
        userId: req.params.userId,
        type: amount > 0 ? 'GRANT' : 'USAGE',
        amount,
        description: reason || (amount > 0 ? 'Admin credit grant' : 'Admin credit deduction'),
      },
    }),
  ]);

  res.json(user);
});

// Clear a user's stored login/session location history. Useful after a review
// or test session leaves spurious suspicious-location flags on an account —
// previously this needed an SSH + psql DELETE.
router.delete('/user/:userId/clear-locations', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { id: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const result = await prisma.userLocation.deleteMany({ where: { userId: req.params.userId } });
  res.json({ deleted: result.count });
});

router.get('/stats', async (_req: Request, res: Response) => {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    userCount,
    jobCount,
    completedJobs,
    basicCount,
    premiumCount,
    totalCredits,
    activeGuests,
    guestsToday,
    guestSignups7dRows,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.tryOnJob.count(),
    prisma.tryOnJob.count({ where: { status: 'COMPLETE' } }),
    prisma.user.count({ where: { tier: 'BASIC' } }),
    prisma.user.count({ where: { tier: 'PREMIUM' } }),
    prisma.user.aggregate({ _sum: { credits: true } }),
    // Unconverted guest accounts currently in the system.
    prisma.user.count({ where: { isGuest: true } }),
    // Guest sign-ups since 00:00 UTC today (guest creations are logged as
    // UserLocation rows with trigger='guest_create' in authController.createGuest).
    prisma.userLocation.count({
      where: { trigger: 'guest_create', timestamp: { gte: startOfToday } },
    }),
    // Guest sign-ups in the last 7 days — drives both the conversion-rate
    // denominator and the per-day mini-trend below.
    prisma.userLocation.findMany({
      where: { trigger: 'guest_create', timestamp: { gte: since7d } },
      select: { userId: true, timestamp: true },
    }),
  ]);

  // Per-day guest sign-up buckets for the last 7 calendar days (UTC), oldest
  // first — for the dashboard mini-trend.
  const dayMs = 24 * 60 * 60 * 1000;
  const guestSignups7dByDay = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(startOfToday.getTime() - (6 - i) * dayMs);
    return { date: start.toISOString().slice(0, 10), count: 0 };
  });
  const bucketIndexByDate = new Map(guestSignups7dByDay.map((b, idx) => [b.date, idx]));
  for (const row of guestSignups7dRows) {
    const key = new Date(row.timestamp).toISOString().slice(0, 10);
    const idx = bucketIndexByDate.get(key);
    if (idx !== undefined) guestSignups7dByDay[idx].count += 1;
  }

  // Conversion rate over the last 7 days: of the guests that signed up in the
  // window, how many are now real (converted) accounts. Cleanup runs at 30 days,
  // so within 7 days every signup's user row still exists — the distinct signup
  // count is the denominator.
  const signupUserIds = [...new Set(guestSignups7dRows.map((r) => r.userId))];
  const guestConversions7d = signupUserIds.length
    ? await prisma.user.count({ where: { id: { in: signupUserIds }, isGuest: false } })
    : 0;
  const guestConversionRate = signupUserIds.length
    ? Math.round((guestConversions7d / signupUserIds.length) * 100)
    : 0;

  res.json({
    userCount,
    jobCount,
    completedJobs,
    subscriberCount: basicCount + premiumCount,
    basicCount,
    premiumCount,
    totalCreditsOutstanding: totalCredits._sum.credits || 0,
    activeGuests,
    guestsToday,
    guestSignups7d: signupUserIds.length,
    guestConversions7d,
    guestConversionRate, // percent over the last 7 days
    guestSignups7dByDay, // [{ date: 'YYYY-MM-DD', count }] oldest→newest
  });
});

// ---------------------------------------------------------------------------
// App Settings — admin-tunable runtime values stored in the AppSettings table.
// ---------------------------------------------------------------------------

// Read current admin-configurable settings (plus defaults/bounds so the UI can
// show placeholders and validate before submitting).
router.get('/settings', async (_req: Request, res: Response) => {
  const [
    guestCreditGrant,
    signupCreditGrant,
    referralCreditGrant,
    referralMaxPerWindow,
    videoCreditCost,
    throttleConfig,
  ] = await Promise.all([
    getGuestCreditGrant(),
    getSignupCreditGrant(),
    getReferralCreditGrant(),
    getReferralMaxPerWindow(),
    getVideoCreditCost(),
    getThrottleConfig(),
  ]);
  res.json({
    guestCreditGrant,
    defaultGuestCreditGrant: DEFAULT_GUEST_CREDIT_GRANT,
    maxGuestCreditGrant: MAX_GUEST_CREDIT_GRANT,
    signupCreditGrant,
    defaultSignupCreditGrant: DEFAULT_SIGNUP_CREDIT_GRANT,
    maxSignupCreditGrant: MAX_SIGNUP_CREDIT_GRANT,
    referralCreditGrant,
    defaultReferralCreditGrant: DEFAULT_REFERRAL_CREDIT_GRANT,
    maxReferralCreditGrant: MAX_REFERRAL_CREDIT_GRANT,
    referralMaxPerWindow,
    defaultReferralMaxPerWindow: DEFAULT_REFERRAL_MAX_PER_WINDOW,
    maxReferralMaxPerWindow: MAX_REFERRAL_MAX_PER_WINDOW,
    referralRewardWindowDays: REFERRAL_REWARD_WINDOW_DAYS,
    videoCreditCost,
    defaultVideoCreditCost: DEFAULT_VIDEO_CREDIT_COST,
    minVideoCreditCost: MIN_VIDEO_CREDIT_COST,
    maxVideoCreditCost: MAX_VIDEO_CREDIT_COST,
    throttleConfig,
    defaultThrottleConfig: DEFAULT_THROTTLE_CONFIG,
    throttleBounds: {
      minWindowMs: MIN_THROTTLE_WINDOW_MS,
      maxWindowMs: MAX_THROTTLE_WINDOW_MS,
      maxBurst: MAX_BURST,
      maxLadderRungs: MAX_LADDER_RUNGS,
      maxLadderMs: MAX_LADDER_MS,
    },
  });
});

// Update the guest welcome-credit grant. Body: { value: number }.
router.patch('/settings/guest-credits', async (req: Request, res: Response) => {
  const { value } = req.body as { value?: unknown };
  const num = typeof value === 'number' ? value : Number(value);
  try {
    const saved = await setGuestCreditGrant(num);
    res.json({ guestCreditGrant: saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Update the signup/welcome-bonus credit grant ("free credits when you join").
// Body: { value: number }. Set to 0 to discontinue the welcome bonus.
router.patch('/settings/signup-credits', async (req: Request, res: Response) => {
  const { value } = req.body as { value?: unknown };
  const num = typeof value === 'number' ? value : Number(value);
  try {
    const saved = await setSignupCreditGrant(num);
    res.json({ signupCreditGrant: saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Update the referral reward (credits to BOTH sides per successful referral).
// Body: { value: number }. Set to 0 to disable the referral reward.
router.patch('/settings/referral-credits', async (req: Request, res: Response) => {
  const { value } = req.body as { value?: unknown };
  const num = typeof value === 'number' ? value : Number(value);
  try {
    const saved = await setReferralCreditGrant(num);
    res.json({ referralCreditGrant: saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Update the anti-farming per-referrer cap (max REWARDED referrals one referrer
// can earn per rolling window). Body: { value: number }. 0 = unlimited.
router.patch('/settings/referral-max', async (req: Request, res: Response) => {
  const { value } = req.body as { value?: unknown };
  const num = typeof value === 'number' ? value : Number(value);
  try {
    const saved = await setReferralMaxPerWindow(num);
    res.json({ referralMaxPerWindow: saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Update the per-video credit cost. Body: { value: number } (>= 1).
router.patch('/settings/video-cost', async (req: Request, res: Response) => {
  const { value } = req.body as { value?: unknown };
  const num = typeof value === 'number' ? value : Number(value);
  try {
    const saved = await setVideoCreditCost(num);
    res.json({ videoCreditCost: saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Update the soft try-on throttle config. Body: the full config object
// { windowMs, burst: { FREE, BASIC, PREMIUM }, ladderMs: number[] }. Validated
// + clamped by setThrottleConfig (throws → 400). Takes effect on the next
// try-on submit; no redeploy. See services/throttleService.ts.
router.patch('/settings/throttle', async (req: Request, res: Response) => {
  try {
    const saved = await setThrottleConfig(req.body);
    res.json({ throttleConfig: saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Splash / announcement screen — publish, inspect, and remove the optional
// launch announcement shown by the mobile app. Backed by a SINGLETON object in
// S3 (the `splash/` prefix), so it's consistent across all app instances behind
// the load balancer and takes effect immediately. See services/splashService.ts.
// ---------------------------------------------------------------------------

router.get('/splash', async (_req: Request, res: Response) => {
  const splash = await getActiveSplash();
  if (!splash) {
    res.json({ active: false });
    return;
  }
  res.json({
    active: true,
    id: splash.id,
    imageUrl: splashImageUrl(splash),
    publishedAt: splash.publishedAt,
    sizeBytes: splash.sizeBytes,
    contentType: splash.contentType,
  });
});

// Publish (or replace) the splash image. Multipart field name: "photo".
router.post('/splash', uploadSingle, async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Send the splash image in the "photo" field' });
    return;
  }
  try {
    const splash = await publishSplash(req.file.buffer, req.file.mimetype);
    res.status(201).json({
      active: true,
      id: splash.id,
      imageUrl: splashImageUrl(splash),
      publishedAt: splash.publishedAt,
      sizeBytes: splash.sizeBytes,
      contentType: splash.contentType,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/splash', async (_req: Request, res: Response) => {
  const removed = await removeSplash();
  res.json({ removed });
});

// Security stats
router.get('/security/stats', async (_req: Request, res: Response) => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [last24Hours, last7Days, total, uniqueUsers] = await Promise.all([
    prisma.userLocation.count({
      where: { suspiciousLocation: true, timestamp: { gte: oneDayAgo } },
    }),
    prisma.userLocation.count({
      where: { suspiciousLocation: true, timestamp: { gte: sevenDaysAgo } },
    }),
    prisma.userLocation.count({
      where: { suspiciousLocation: true },
    }),
    prisma.userLocation
      .groupBy({
        by: ['userId'],
        where: { suspiciousLocation: true },
      })
      .then((groups) => groups.length),
  ]);

  res.json({ last24Hours, last7Days, total, uniqueUsers });
});

// Suspicious logins list
router.get('/security/suspicious', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const locations = await prisma.userLocation.findMany({
    where: { suspiciousLocation: true },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      user: {
        select: { username: true, email: true },
      },
    },
  });

  res.json(locations);
});

// Collect the S3 keys that belong to a job and to nothing else: its clothing
// photo(s) and result image(s). Deliberately NOT bodyPhotoUrl — that is the
// user's profile body photo (the same S3 object User.fullBodyUrl/mediumBodyUrl
// points at), shared across the user's jobs; deleting it would break their
// profile and every other job that used it.
function jobOwnedS3Keys(
  jobs: Array<{
    clothingPhoto1Url: string | null;
    clothingPhoto2Url: string | null;
    resultFullBodyUrl: string | null;
    resultMediumUrl: string | null;
  }>,
): Set<string> {
  const keys = new Set<string>();
  for (const j of jobs) {
    for (const ref of [
      j.clothingPhoto1Url,
      j.clothingPhoto2Url,
      j.resultFullBodyUrl,
      j.resultMediumUrl,
    ]) {
      const key = refToKey(ref);
      if (key) keys.add(key);
    }
  }
  return keys;
}

// Delete a single job (and its clothing/result images in S3 — previously the
// S3 objects were left behind, which is where most storage orphans came from).
router.delete('/job/:jobId', async (req: Request, res: Response) => {
  const job = await prisma.tryOnJob.findUnique({
    where: { id: req.params.jobId },
    select: {
      clothingPhoto1Url: true,
      clothingPhoto2Url: true,
      resultFullBodyUrl: true,
      resultMediumUrl: true,
    },
  });
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  await prisma.tryOnJob.delete({ where: { id: req.params.jobId } });
  // Fire-and-forget S3 cleanup, same DB-first pattern as user deletion. Misses
  // are caught by the weekly orphan scan.
  for (const key of jobOwnedS3Keys([job])) {
    deleteFromS3(key).catch(() => {});
  }
  res.json({ message: 'Job deleted' });
});

// Bulk delete jobs (and their clothing/result images in S3)
router.post('/jobs/delete', async (req: Request, res: Response) => {
  const { jobIds } = req.body as { jobIds?: string[] };

  if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
    res.status(400).json({ error: 'jobIds array is required' });
    return;
  }

  const jobs = await prisma.tryOnJob.findMany({
    where: { id: { in: jobIds } },
    select: {
      clothingPhoto1Url: true,
      clothingPhoto2Url: true,
      resultFullBodyUrl: true,
      resultMediumUrl: true,
    },
  });

  const result = await prisma.tryOnJob.deleteMany({
    where: { id: { in: jobIds } },
  });

  for (const key of jobOwnedS3Keys(jobs)) {
    deleteFromS3(key).catch(() => {});
  }

  res.json({ deleted: result.count });
});

// ===== VULNERABILITY MANAGEMENT ENDPOINTS =====

// Get vulnerability summary
router.get('/vulnerabilities/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await getLatestReportSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get detailed vulnerability reports (paginated)
router.get('/vulnerabilities/reports', async (req: Request, res: Response) => {
  try {
    const scanType = req.query.scanType as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = parseInt(req.query.skip as string) || 0;

    const where = scanType ? { scanType: scanType as any } : {};

    const [reports, total] = await Promise.all([
      prisma.vulnerabilityReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.vulnerabilityReport.count({ where }),
    ]);

    res.json({ reports, total, limit, skip });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single vulnerability report details
router.get('/vulnerabilities/report/:id', async (req: Request, res: Response) => {
  try {
    const report = await prisma.vulnerabilityReport.findUnique({
      where: { id: req.params.id },
    });

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger manual vulnerability scan
router.post('/vulnerabilities/scan', async (_req: Request, res: Response) => {
  try {
    await triggerImmediateScan();
    res.json({
      message: 'Vulnerability scan triggered',
      status: 'Scan started. Check back in a few minutes for results.',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Run immediate scan (synchronous - for testing)
router.post('/vulnerabilities/scan/immediate', async (_req: Request, res: Response) => {
  try {
    await runAllScans();
    const summary = await getLatestReportSummary();
    res.json({
      message: 'Scan completed',
      summary,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete old vulnerability reports
router.delete('/vulnerabilities/cleanup', async (req: Request, res: Response) => {
  try {
    const daysToKeep = parseInt(req.query.days as string) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await prisma.vulnerabilityReport.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    res.json({
      message: `Deleted reports older than ${daysToKeep} days`,
      deleted: result.count,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Content moderation — review and resolve user-submitted reports.
// Required by App Store Review Guideline 1.2 (timely admin response).
// ============================================================================

router.get('/moderation/reports', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined as ReportStatus | undefined;
  const limit = Math.min(100, parseInt((req.query.limit as string) ?? '50', 10));
  const skip = Math.max(0, parseInt((req.query.skip as string) ?? '0', 10));

  const reports = await prisma.report.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: limit,
    skip,
    include: {
      reporter: { select: { id: true, username: true, email: true } },
    },
  });

  // Hydrate the target so the admin sees who/what was reported.
  const hydrated = await Promise.all(
    reports.map(async (r) => {
      if (r.targetType === 'TRYON_JOB') {
        const job = await prisma.tryOnJob.findUnique({
          where: { id: r.targetId },
          select: {
            id: true,
            userId: true,
            isPrivate: true,
            status: true,
            resultFullBodyUrl: true,
            resultMediumUrl: true,
            user: { select: { id: true, username: true } },
          },
        });
        return { ...r, target: job ? await presignTryOnJob(job) : job };
      }
      if (r.targetType === 'COMMENT') {
        const comment = await prisma.comment.findUnique({
          where: { id: r.targetId },
          select: {
            id: true,
            jobId: true,
            userId: true,
            body: true,
            createdAt: true,
            user: { select: { id: true, username: true, email: true, avatarUrl: true } },
          },
        });
        return {
          ...r,
          target: comment ? { ...comment, user: await presignAvatarOnly(comment.user) } : comment,
        };
      }
      const user = await prisma.user.findUnique({
        where: { id: r.targetId },
        select: { id: true, username: true, email: true, bio: true, avatarUrl: true },
      });
      return { ...r, target: user ? await presignAvatarOnly(user) : user };
    }),
  );

  res.json({ reports: hydrated, limit, skip });
});

router.patch('/moderation/reports/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, resolverNote, removeContent } = req.body as {
    status?: ReportStatus;
    resolverNote?: string;
    removeContent?: boolean;
  };

  if (status && !['OPEN', 'REVIEWING', 'RESOLVED_REMOVED', 'RESOLVED_NO_ACTION'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  // If admin chose to remove the offending content, do that atomically
  // alongside resolving the report.
  if (removeContent && report.targetType === 'TRYON_JOB') {
    await prisma.tryOnJob
      .update({
        where: { id: report.targetId },
        data: { isPrivate: true },
      })
      .catch(() => null);
  } else if (removeContent && report.targetType === 'COMMENT') {
    // Hard-delete the offending comment and decrement the parent's count.
    const comment = await prisma.comment.findUnique({
      where: { id: report.targetId },
      select: { id: true, jobId: true },
    });
    if (comment) {
      await prisma
        .$transaction([
          prisma.comment.delete({ where: { id: comment.id } }),
          prisma.tryOnJob.update({
            where: { id: comment.jobId },
            data: { commentsCount: { decrement: 1 } },
          }),
        ])
        .catch(() => null);
    }
  }

  const updated = await prisma.report.update({
    where: { id },
    data: {
      status: status ?? (removeContent ? 'RESOLVED_REMOVED' : 'REVIEWING'),
      resolverNote: resolverNote ?? null,
      resolvedAt: status?.startsWith('RESOLVED') || removeContent ? new Date() : null,
    },
  });

  res.json(updated);
});

// ---------------------------------------------------------------------------
// S3 Orphan Scan
// ---------------------------------------------------------------------------
// Full key-level reconciliation: every object under the TryOn prefixes is
// checked against the set of S3 keys the database actually references (user
// body photos + every TryOnJob's clothing/result keys). Anything unreferenced
// is orphaned — that catches BOTH deleted users (the original scan) and
// deleted/replaced rows whose user still exists (e.g. jobs removed before job
// deletion cleaned up S3). Objects uploaded in the last hour are skipped so a
// scan can't flag an upload whose DB row hasn't been committed yet. The scan
// is read-only; call the cleanup endpoint to actually delete the orphans.
//
// Other prefixes in the bucket (e.g. legacy `avatars/`, `videos/` from the
// earlier EvoFaceFlow app) are deliberately NOT scanned — they're not TryOn's
// data to judge.

const S3_PREFIXES = ['body-photos/', 'clothing-photos/', 'tryon-results/', 'closet/'] as const;
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000; // ignore objects younger than 1 hour

// Same normalization as imageUrlService: rows may hold a bare key or (legacy)
// a full https URL.
function refToKey(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('http')) return value.replace(/^\/+/, '');
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

export interface OrphanScanResult {
  scannedAt: string;
  totalS3Objects: number;
  orphanedObjects: number;
  orphanedBytes: number;
  // Grouped by the userId segment of the key (<prefix>/<userId>/<file>).
  // `userExists` distinguishes leftovers of a deleted user from leftovers of
  // deleted jobs/replaced photos belonging to a live account.
  orphansByUser: Array<{
    userId: string;
    username: string | null;
    userExists: boolean;
    keys: string[];
    bytes: number;
  }>;
}

// Shared scan logic — used by both the on-demand endpoint and the scheduled job.
export async function scanS3Orphans(): Promise<OrphanScanResult> {
  // 1. Collect all S3 objects across the TryOn prefixes.
  const allObjects: Awaited<ReturnType<typeof listS3ObjectsUnderPrefix>> = [];
  await Promise.all(
    S3_PREFIXES.map(async (prefix) => {
      allObjects.push(...(await listS3ObjectsUnderPrefix(prefix)));
    }),
  );

  // 2. Build the full set of S3 keys the database references.
  const [users, jobs, closetItems] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, username: true, avatarUrl: true, fullBodyUrl: true, mediumBodyUrl: true },
    }),
    prisma.tryOnJob.findMany({
      select: {
        clothingPhoto1Url: true,
        clothingPhoto2Url: true,
        bodyPhotoUrl: true,
        resultFullBodyUrl: true,
        resultMediumUrl: true,
      },
    }),
    prisma.closetItem.findMany({ select: { imageUrl: true } }),
  ]);
  const referencedKeys = new Set<string>();
  const usernameById = new Map<string, string>();
  for (const u of users) {
    usernameById.set(u.id, u.username);
    for (const ref of [u.avatarUrl, u.fullBodyUrl, u.mediumBodyUrl]) {
      const key = refToKey(ref);
      if (key) referencedKeys.add(key);
    }
  }
  for (const j of jobs) {
    for (const ref of [
      j.clothingPhoto1Url,
      j.clothingPhoto2Url,
      j.bodyPhotoUrl,
      j.resultFullBodyUrl,
      j.resultMediumUrl,
    ]) {
      const key = refToKey(ref);
      if (key) referencedKeys.add(key);
    }
  }
  for (const c of closetItems) {
    const key = refToKey(c.imageUrl);
    if (key) referencedKeys.add(key);
  }

  // 3. Anything listed but unreferenced (and not brand-new) is orphaned.
  const now = Date.now();
  const orphanMap = new Map<string, { keys: string[]; bytes: number }>();
  let orphanedObjects = 0;
  let orphanedBytes = 0;
  for (const obj of allObjects) {
    if (referencedKeys.has(obj.key)) continue;
    if (obj.lastModified && now - obj.lastModified.getTime() < ORPHAN_MIN_AGE_MS) continue;
    const parts = obj.key.split('/');
    const uid = parts.length >= 2 ? parts[1] : '(no-user-segment)';
    const bucket = orphanMap.get(uid) ?? { keys: [], bytes: 0 };
    bucket.keys.push(obj.key);
    bucket.bytes += obj.sizeBytes;
    orphanMap.set(uid, bucket);
    orphanedObjects += 1;
    orphanedBytes += obj.sizeBytes;
  }

  const orphansByUser = [...orphanMap.entries()].map(([userId, e]) => ({
    userId,
    username: usernameById.get(userId) ?? null,
    userExists: usernameById.has(userId),
    keys: e.keys,
    bytes: e.bytes,
  }));

  return {
    scannedAt: new Date().toISOString(),
    totalS3Objects: allObjects.length,
    orphanedObjects,
    orphanedBytes,
    orphansByUser,
  };
}

router.get('/s3/orphan-scan', async (_req: Request, res: Response) => {
  try {
    const result = await scanS3Orphans();
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete('/s3/orphan-cleanup', async (_req: Request, res: Response) => {
  try {
    const scan = await scanS3Orphans();
    const allOrphanKeys = scan.orphansByUser.flatMap((e) => e.keys);
    const results = await Promise.allSettled(allOrphanKeys.map((key) => deleteFromS3(key)));
    const deleted = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    res.json({
      scannedAt: scan.scannedAt,
      totalOrphans: allOrphanKeys.length,
      deleted,
      failed,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Diagnostics & Observability
// ---------------------------------------------------------------------------
// One-call operational snapshot powering the dashboard's "Diagnostics" tab:
// process health, dependency latency, BullMQ queue depth + recent worker
// failures, which integrations are wired up on THIS box, 24h try-on throughput,
// 7d credit economy, and Sentry status.
router.get('/diagnostics', async (_req: Request, res: Response) => {
  try {
    res.json(await collectDiagnostics());
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Sentry config status only (no secrets). Renders the config card even when the
// issues REST API isn't wired up.
router.get('/sentry/status', (_req: Request, res: Response) => {
  res.json(getSentryStatus());
});

// Most recent unresolved Sentry issues, scoped to this box's environment (the
// prod dashboard shows production issues only, dev shows development only).
// Optional — needs SENTRY_AUTH_TOKEN + SENTRY_ORG_SLUG + SENTRY_PROJECT_SLUG.
// 503 when not configured so the dashboard can show setup guidance; 502 when
// Sentry's API itself errors.
router.get('/sentry/issues', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) ?? '10', 10);
    res.json({
      environment: getSentryStatus().environment,
      issues: await fetchRecentIssues(limit),
    });
  } catch (err: unknown) {
    if (err instanceof SentryNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: (err as Error).message });
  }
});

// Fire a synthetic event so an operator can confirm Sentry delivery end-to-end.
router.post('/sentry/test', async (req: Request, res: Response) => {
  try {
    const note = (req.body?.note as string | undefined)?.slice(0, 120);
    res.json({ ok: true, ...(await sendTestEvent(note)) });
  } catch (err: unknown) {
    if (err instanceof SentryNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
