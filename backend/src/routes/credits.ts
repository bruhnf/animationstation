import { Router, Request, Response } from 'express';
import { UserTier } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import prisma from '../lib/prisma';
import { TIER_CONFIG } from '../services/tierService';
import * as Sentry from '@sentry/node';
import { verifyAndDecodeTransactionAnyEnv } from '../services/appleNotificationService';
import { getProduct } from '../config/appleIap';
import { env } from '../config/env';
import { createChildLogger, hashForLog } from '../services/logger';
import { describeAppleVerifyError, decodeJwsShape } from '../utils/appleVerifyStatus';
import { resetUserThrottle } from '../services/throttleService';

const router = Router();
const log = createChildLogger('CreditsRoute');

// Prisma unique-constraint violation. Used to make verify-receipt idempotent
// under concurrency: two simultaneous calls with the same transactionId can
// both pass the findUnique pre-check, then one create wins and the other hits
// the unique index on transactionId — which we treat as already-processed
// rather than a 500.
function isUniqueConstraintError(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002'
  );
}

router.use(requireAuth);

// Get current user's credit balance, tier, and weekly usage (rolling 7-day window)
router.get('/balance', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { credits: true, tier: true, creationCount: true },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Count non-failed creation jobs in the rolling 7-day window
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const weekJobCount = await prisma.creation.count({
    where: {
      userId: req.user.userId,
      createdAt: { gte: weekStart },
      status: { not: 'FAILED' },
    },
  });

  const config = TIER_CONFIG[user.tier];

  res.json({
    credits: user.credits,
    tier: user.tier,
    creationCount: user.creationCount,
    weeklyUsed: weekJobCount,
    weeklyLimit: config.weeklyLimit,
    weeklyRemaining: Math.max(0, config.weeklyLimit - weekJobCount),
    creditPrice: config.creditPrice,
  });
});

// Get credit transaction history
router.get('/history', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

  const transactions = await prisma.creditTransaction.findMany({
    where: { userId: req.user.userId },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });

  res.json({ transactions, page, limit });
});

// Verify a StoreKit purchase and apply the entitlement.
//
// Apple App Store Review Guideline 3.1.1 requires that subscription tier and
// consumable credits ONLY be granted in response to a verified StoreKit
// transaction. The mobile client posts the JWS-signed transaction it received
// from StoreKit; we verify against Apple's CA chain and apply tier/credits
// based on our PRODUCTS mapping.
//
// Idempotent: if the same transactionId is verified twice, the second call
// returns the current state without re-applying the entitlement (StoreKit
// retries on network failure are common).
router.post('/verify-receipt', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { jwsRepresentation } = req.body as { jwsRepresentation?: string };
  if (!jwsRepresentation || typeof jwsRepresentation !== 'string') {
    res.status(400).json({ error: 'jwsRepresentation required' });
    return;
  }

  let transaction;
  let receiptEnvironment: 'Production' | 'Sandbox';
  try {
    ({ transaction, environment: receiptEnvironment } =
      await verifyAndDecodeTransactionAnyEnv(jwsRepresentation));
  } catch (err) {
    // A failed purchase verification is revenue-critical: log the REAL reason
    // (VerificationException carries an empty message; the status enum is the
    // signal) plus a PII-free shape of what the client posted, and page via
    // Sentry. Jim Morris incident (2026-06-11): this path failed silently with
    // error:"" and the user lost their credits until manual reconciliation.
    log.error('Receipt verification failed', {
      userId: req.user.userId,
      ...describeAppleVerifyError(err),
      postedJwsShape: decodeJwsShape(jwsRepresentation),
    });
    Sentry.captureException(err instanceof Error ? err : new Error('Receipt verification failed'), {
      tags: { area: 'iap-verify-receipt' },
      extra: { userId: req.user.userId, ...describeAppleVerifyError(err) },
    });
    res.status(400).json({ error: 'Receipt verification failed' });
    return;
  }

  if (!transaction.transactionId || !transaction.originalTransactionId || !transaction.productId) {
    res.status(400).json({ error: 'Verified transaction missing required fields' });
    return;
  }

  // The client must have set appAccountToken = our user.id at purchase time.
  // If that's missing or doesn't match the authenticated user, refuse: prevents
  // a malicious user from posting someone else's receipt to claim entitlement.
  if (!transaction.appAccountToken || transaction.appAccountToken !== req.user.userId) {
    // Hash the appAccountToken for log correlation without leaking valid User
    // IDs to anyone with read access to logs.
    log.warn('Receipt appAccountToken does not match authenticated user', {
      userIdHash: hashForLog(req.user.userId),
      appAccountTokenHash: hashForLog(transaction.appAccountToken),
      appAccountTokenPresent: !!transaction.appAccountToken,
      transactionId: transaction.transactionId,
    });
    res.status(403).json({ error: 'Receipt does not belong to this account' });
    return;
  }

  const product = getProduct(transaction.productId);
  if (!product) {
    log.warn('Receipt product not in catalog', {
      productId: transaction.productId,
      transactionId: transaction.transactionId,
    });
    res.status(400).json({ error: 'Unknown product' });
    return;
  }

  // Defensive audit: a credit pack's tier variant should match the user's
  // current tier (the client offers only the matching variant). A mismatch
  // can happen on a tier-change race (user upgraded mid-purchase) or a
  // tampered client buying a cheaper variant. Log it but still grant credits
  // — Apple already charged the user — so honest users aren't penalized.
  if (product.type === 'credits') {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { tier: true },
    });
    if (user && user.tier !== product.tierVariant) {
      log.warn('Credit pack tier variant does not match user tier', {
        userId: req.user.userId,
        userTier: user.tier,
        productTierVariant: product.tierVariant,
        productId: transaction.productId,
        transactionId: transaction.transactionId,
      });
    }
  }

  // Idempotency: if we've already processed this transactionId, return current state.
  const existing = await prisma.applePurchase.findUnique({
    where: { transactionId: transaction.transactionId },
  });
  if (existing) {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { credits: true, tier: true },
    });
    res.json({
      alreadyProcessed: true,
      tier: user?.tier,
      credits: user?.credits,
      productId: transaction.productId,
    });
    return;
  }

  const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate) : null;

  if (product.type === 'subscription') {
    try {
      await prisma.$transaction([
        prisma.applePurchase.create({
          data: {
            userId: req.user.userId,
            transactionId: transaction.transactionId,
            originalTransactionId: transaction.originalTransactionId,
            productId: transaction.productId,
            tier: product.tier,
            expiresAt,
            rawReceipt: jwsRepresentation,
            // Fresh subscribes always start with auto-renew on; the webhook will
            // overwrite this if the user later toggles it off (DID_CHANGE_RENEWAL_STATUS).
            autoRenewStatus: true,
          },
        }),
        prisma.user.update({
          where: { id: req.user.userId },
          data: { tier: product.tier },
        }),
      ]);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        // A concurrent verify-receipt for the same transaction won the race.
        const u = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { credits: true, tier: true },
        });
        res.json({
          alreadyProcessed: true,
          tier: u?.tier,
          credits: u?.credits,
          productId: transaction.productId,
        });
        return;
      }
      throw err;
    }
    // Paying user → clear any soft-throttle pacing so a fresh subscriber starts
    // with a clean burst. Fire-and-forget; never blocks the purchase response.
    void resetUserThrottle(req.user.userId);
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { credits: true, tier: true },
    });
    res.json({
      success: true,
      tier: user?.tier,
      credits: user?.credits,
      productId: transaction.productId,
      expiresAt,
    });
    return;
  }

  // Consumable credit pack
  try {
    await prisma.$transaction([
      prisma.applePurchase.create({
        data: {
          userId: req.user.userId,
          transactionId: transaction.transactionId,
          originalTransactionId: transaction.originalTransactionId,
          productId: transaction.productId,
          tier: 'FREE',
          expiresAt: null,
          rawReceipt: jwsRepresentation,
        },
      }),
      prisma.user.update({
        where: { id: req.user.userId },
        data: { credits: { increment: product.credits } },
      }),
      prisma.creditTransaction.create({
        data: {
          userId: req.user.userId,
          type: 'PURCHASE',
          amount: product.credits,
          // The "(sandbox)" tag marks TestFlight / App Review test purchases —
          // real App Store buyers produce Production receipts.
          description: `Apple IAP: ${transaction.productId} (+${product.credits} credits)${
            receiptEnvironment === 'Sandbox' ? ' (sandbox)' : ''
          }`,
        },
      }),
    ]);
    log.info('Credit pack granted via verify-receipt', {
      userId: req.user.userId,
      productId: transaction.productId,
      credits: product.credits,
      transactionId: transaction.transactionId,
      receiptEnvironment,
    });
    // Just bought credits → clear any soft-throttle pacing so the user can spend
    // them immediately instead of waiting out a queue. Fire-and-forget.
    void resetUserThrottle(req.user.userId);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // A concurrent verify-receipt for the same transaction already granted
      // these credits — return current state instead of double-granting/500ing.
      const u = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { credits: true, tier: true },
      });
      res.json({
        alreadyProcessed: true,
        tier: u?.tier,
        credits: u?.credits,
        productId: transaction.productId,
      });
      return;
    }
    throw err;
  }
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { credits: true, tier: true },
  });
  res.json({
    success: true,
    tier: user?.tier,
    credits: user?.credits,
    productId: transaction.productId,
    creditsGranted: product.credits,
  });
});

// Legacy unsafe endpoints. Granting tier or credits without an Apple receipt
// violates App Store Review Guideline 3.1.1. Disabled in production; kept
// available in dev to support local testing without StoreKit.
router.post('/purchase', async (req: Request, res: Response) => {
  if (!env.isDev) {
    res.status(410).json({
      error:
        'This endpoint is disabled. Use StoreKit + /api/credits/verify-receipt for credit purchases.',
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { credits } = req.body as { credits?: number };
  if (!credits || credits < 1 || credits > 1000 || !Number.isInteger(credits)) {
    res.status(400).json({ error: 'credits must be an integer between 1 and 1000' });
    return;
  }

  const current = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { tier: true },
  });
  if (!current) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const pricePerCredit = TIER_CONFIG[current.tier].creditPrice;
  const totalPrice = +(credits * pricePerCredit).toFixed(2);

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: req.user.userId },
      data: { credits: { increment: credits } },
      select: { credits: true, tier: true },
    }),
    prisma.creditTransaction.create({
      data: {
        userId: req.user.userId,
        type: 'GRANT',
        amount: credits,
        description: `[DEV] Granted ${credits} credits (no payment validated)`,
      },
    }),
  ]);

  res.json({
    credits: user.credits,
    purchased: credits,
    pricePerCredit,
    totalPrice,
    tier: user.tier,
  });
});

router.post('/subscribe', async (req: Request, res: Response) => {
  if (!env.isDev) {
    res.status(410).json({
      error:
        'This endpoint is disabled. Use StoreKit + /api/credits/verify-receipt for subscriptions.',
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { tier } = req.body as { tier?: UserTier };
  if (!tier || !['FREE', 'BASIC', 'PREMIUM'].includes(tier)) {
    res.status(400).json({ error: 'tier must be FREE, BASIC, or PREMIUM' });
    return;
  }

  const user = await prisma.user.update({
    where: { id: req.user.userId },
    data: { tier },
    select: { credits: true, tier: true },
  });

  res.json({
    success: true,
    tier: user.tier,
    credits: user.credits,
    message: `[DEV] Tier set to ${user.tier}`,
  });
});

// Legacy: dev-only manual tier downgrade. App Store Review Guideline 3.1.1
// requires that subscription cancellation flow through Apple, not our server.
// Production users cancel via iOS Settings > Apple ID > Subscriptions, and the
// resulting EXPIRED notification fires our webhook to drop them back to FREE.
router.post('/unsubscribe', async (req: Request, res: Response) => {
  if (!env.isDev) {
    res.status(410).json({
      error:
        'This endpoint is disabled. Cancel your subscription in iOS Settings > Apple ID > Subscriptions.',
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.update({
    where: { id: req.user.userId },
    data: { tier: 'FREE' },
    select: { credits: true, tier: true },
  });

  res.json({
    success: true,
    tier: user.tier,
    credits: user.credits,
    message: '[DEV] Tier set to FREE',
  });
});

export default router;
