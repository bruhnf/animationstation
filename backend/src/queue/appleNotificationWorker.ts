import { Worker } from 'bullmq';
import * as Sentry from '@sentry/node';
import { UserTier } from '@prisma/client';
import {
  NotificationTypeV2,
  Subtype,
  JWSTransactionDecodedPayload,
  JWSRenewalInfoDecodedPayload,
} from '@apple/app-store-server-library';
import { connection } from './transformQueue';
import { AppleNotificationJobData } from './appleNotificationQueue';
import {
  verifyAndDecodeNotification,
  verifyAndDecodeRenewalInfo,
  verifyAndDecodeTransaction,
} from '../services/appleNotificationService';
import { getProduct, AppleProduct } from '../config/appleIap';
import prisma from '../lib/prisma';
import { createChildLogger, hashForLog } from '../services/logger';
import { resetUserThrottle } from '../services/throttleService';

const log = createChildLogger('AppleNotificationWorker');

interface ResolvedTxn {
  userId: string | null;
  transaction: JWSTransactionDecodedPayload;
  renewal: JWSRenewalInfoDecodedPayload | null;
}

// Resolve our internal userId from the StoreKit transaction.
// Preferred: appAccountToken (set on the client at purchase time = our User.id).
// Fallback:  match originalTransactionId against an existing ApplePurchase row.
async function resolveUserId(transaction: JWSTransactionDecodedPayload): Promise<string | null> {
  if (transaction.appAccountToken) {
    const user = await prisma.user.findUnique({
      where: { id: transaction.appAccountToken },
      select: { id: true },
    });
    if (user) return user.id;
    // Hash the token for log correlation without leaking the raw User.id
    // (which is what the appAccountToken is on our side).
    log.warn('appAccountToken did not match any user', {
      appAccountTokenHash: hashForLog(transaction.appAccountToken),
      originalTransactionId: transaction.originalTransactionId,
    });
  }
  if (transaction.originalTransactionId) {
    const existing = await prisma.applePurchase.findFirst({
      where: { originalTransactionId: transaction.originalTransactionId },
      select: { userId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing.userId;
  }
  return null;
}

async function decodeNotificationPayload(signedPayload: string): Promise<ResolvedTxn | null> {
  const decoded = await verifyAndDecodeNotification(signedPayload);
  const data = decoded.data;
  if (!data?.signedTransactionInfo) {
    log.debug('Notification has no signedTransactionInfo', {
      notificationType: decoded.notificationType,
    });
    return null;
  }
  const transaction = await verifyAndDecodeTransaction(data.signedTransactionInfo);
  const renewal = data.signedRenewalInfo
    ? await verifyAndDecodeRenewalInfo(data.signedRenewalInfo)
    : null;
  const userId = await resolveUserId(transaction);
  return { userId, transaction, renewal };
}

// Apple's AutoRenewStatus enum: 0 = OFF (pending cancellation), 1 = ON.
// Returns null when the renewal info doesn't carry the field (credit packs, or
// notifications without signedRenewalInfo) so we don't overwrite a known value
// with a guess.
function deriveAutoRenewStatus(renewal: JWSRenewalInfoDecodedPayload | null): boolean | null {
  if (!renewal || renewal.autoRenewStatus === undefined || renewal.autoRenewStatus === null) {
    return null;
  }
  return renewal.autoRenewStatus === 1;
}

async function upsertApplePurchase(
  userId: string,
  transaction: JWSTransactionDecodedPayload,
  rawSignedPayload: string,
  // Tier this purchase grants. Credit packs use FREE since they don't change tier;
  // the row exists purely to record the transaction for refund handling and audit.
  tier: UserTier,
  revoked = false,
  autoRenewStatus: boolean | null = null,
): Promise<void> {
  if (!transaction.transactionId || !transaction.originalTransactionId || !transaction.productId) {
    log.warn('Skipping purchase upsert — missing required transaction fields', {
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
    });
    return;
  }
  const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate) : null;
  await prisma.applePurchase.upsert({
    where: { transactionId: transaction.transactionId },
    create: {
      userId,
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
      tier,
      expiresAt,
      rawReceipt: rawSignedPayload,
      revokedAt: revoked ? new Date() : null,
      autoRenewStatus,
    },
    update: {
      tier,
      productId: transaction.productId,
      expiresAt,
      rawReceipt: rawSignedPayload,
      revokedAt: revoked ? new Date() : null,
      // Only overwrite when we actually have a fresh value from Apple — null
      // here means "not reported on this notification", not "now unknown".
      ...(autoRenewStatus === null ? {} : { autoRenewStatus }),
    },
  });
}

// Idempotently grant credits for an Apple consumable purchase. If the
// transactionId is already on file (e.g. /api/credits/verify-receipt got there
// first from the client) this is a no-op. Otherwise we atomically create the
// ApplePurchase row, increment the user's credits, and write a CreditTransaction.
async function grantCreditsIfNew(
  userId: string,
  transaction: JWSTransactionDecodedPayload,
  rawSignedPayload: string,
  creditsToGrant: number,
): Promise<void> {
  if (!transaction.transactionId || !transaction.originalTransactionId || !transaction.productId) {
    log.warn('Skipping credit grant — missing required transaction fields', {
      transactionId: transaction.transactionId,
      productId: transaction.productId,
    });
    return;
  }
  const existing = await prisma.applePurchase.findUnique({
    where: { transactionId: transaction.transactionId },
    select: { id: true },
  });
  if (existing) {
    log.info('Credit pack already granted (transaction on file) — skipping', {
      userId,
      transactionId: transaction.transactionId,
    });
    return;
  }
  await prisma.$transaction([
    prisma.applePurchase.create({
      data: {
        userId,
        transactionId: transaction.transactionId,
        originalTransactionId: transaction.originalTransactionId,
        productId: transaction.productId,
        tier: 'FREE',
        expiresAt: null,
        rawReceipt: rawSignedPayload,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: creditsToGrant } },
    }),
    prisma.creditTransaction.create({
      data: {
        userId,
        type: 'PURCHASE',
        amount: creditsToGrant,
        description: `Apple IAP webhook: ${transaction.productId} (+${creditsToGrant} credits)`,
      },
    }),
  ]);
  log.info('Credits granted via webhook', {
    userId,
    transactionId: transaction.transactionId,
    productId: transaction.productId,
    creditsGranted: creditsToGrant,
  });
  // Just credited via the authoritative webhook path → clear any soft-throttle
  // pacing so the user can spend immediately. Fire-and-forget.
  void resetUserThrottle(userId);
}

// Idempotently claw back credits granted by a refunded consumable purchase.
//
// MUST run BEFORE the row is marked revoked (see the REFUND handler) — the
// atomic "claim" below uses `revokedAt: null` as its idempotency guard, so if
// the row were already revoked the claw-back would (correctly) skip.
//
// Idempotency + concurrency safety: the claw-back is gated on an atomic
// `updateMany(where revokedAt: null → set revokedAt)`. Only the first
// notification for a transaction matches a row (count === 1) and proceeds to
// deduct; a duplicate/concurrent REFUND (the worker runs concurrency 4) or a
// refund for a purchase we never recorded matches zero rows and skips. The
// deduction itself runs under a `SELECT … FOR UPDATE` lock on the user row
// (same lock the creation charge takes) so a concurrent spend can't drive the
// balance negative.
async function clawBackCreditsForRefund(
  userId: string,
  transaction: JWSTransactionDecodedPayload,
  creditsGranted: number,
): Promise<void> {
  if (!transaction.transactionId) return;

  // Atomically claim the refund. Matches zero rows if the purchase isn't on
  // file yet, or if a prior notification already revoked it → claw back once.
  const claimed = await prisma.applePurchase.updateMany({
    where: { transactionId: transaction.transactionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count === 0) {
    log.info('Refund claw-back skipped (already revoked or no purchase on file)', {
      transactionId: transaction.transactionId,
    });
    return;
  }

  const reclaimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ credits: number }>>`
      SELECT credits FROM users WHERE id = ${userId} FOR UPDATE
    `;
    if (rows.length === 0) return 0;
    const current = rows[0].credits;
    // Clamp to the current balance: a user who already spent the refunded
    // credits keeps the spent value (you can't un-spend), and the balance
    // never goes negative.
    const deduct = Math.min(current, creditsGranted);
    if (deduct > 0) {
      await tx.user.update({ where: { id: userId }, data: { credits: { decrement: deduct } } });
    }
    await tx.creditTransaction.create({
      data: {
        userId,
        type: 'REFUND',
        amount: -deduct,
        description: `Apple refund (${transaction.productId}) — clawed back ${deduct} of ${creditsGranted} granted credits`,
      },
    });
    return deduct;
  });

  log.info('Credits clawed back for Apple refund', {
    userId,
    transactionId: transaction.transactionId,
    granted: creditsGranted,
    reclaimed,
  });
  if (reclaimed < creditsGranted) {
    log.warn('Partial credit claw-back — user spent some refunded credits', {
      userId,
      transactionId: transaction.transactionId,
      granted: creditsGranted,
      reclaimed,
    });
  }
}

async function setUserTier(userId: string, tier: UserTier): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tier } });
}

// Drop the user back to FREE only if they have no other active, unexpired,
// non-revoked entitlement on file. Prevents demoting a user who has overlapping
// subscriptions (e.g. a refunded purchase while a separate renewal is active).
async function downgradeIfNoActiveEntitlement(userId: string): Promise<void> {
  const now = new Date();
  const stillActive = await prisma.applePurchase.findFirst({
    where: {
      userId,
      tier: { in: ['BASIC', 'PREMIUM'] }, // exclude credit-pack rows (tier: FREE, expiresAt: null)
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
  });
  if (stillActive) {
    await setUserTier(userId, stillActive.tier);
  } else {
    await setUserTier(userId, 'FREE');
  }
}

async function handleNotification(
  notificationType: NotificationTypeV2 | string,
  subtype: Subtype | string | undefined,
  signedPayload: string,
): Promise<void> {
  const resolved = await decodeNotificationPayload(signedPayload);
  if (!resolved) return;
  const { userId, transaction, renewal } = resolved;
  if (!userId) {
    log.warn('Could not resolve user for Apple notification', {
      notificationType,
      subtype,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
    });
    return;
  }

  const product = getProduct(transaction.productId);
  if (!product) {
    log.warn('Unknown productId — no mapping configured', {
      productId: transaction.productId,
      notificationType,
    });
    return;
  }

  if (product.type === 'subscription') {
    await handleSubscriptionNotification(
      notificationType,
      subtype,
      signedPayload,
      userId,
      transaction,
      renewal,
      product,
    );
  } else {
    await handleCreditPackNotification(
      notificationType,
      subtype,
      signedPayload,
      userId,
      transaction,
      product,
    );
  }
}

async function handleSubscriptionNotification(
  notificationType: NotificationTypeV2 | string,
  subtype: Subtype | string | undefined,
  signedPayload: string,
  userId: string,
  transaction: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  product: Extract<AppleProduct, { type: 'subscription' }>,
): Promise<void> {
  const tier = product.tier;
  const autoRenew = deriveAutoRenewStatus(renewal);
  switch (notificationType) {
    // New subscription, resub, or auto-renewal succeeded.
    case NotificationTypeV2.SUBSCRIBED:
    case NotificationTypeV2.DID_RENEW:
    case NotificationTypeV2.OFFER_REDEEMED:
      await upsertApplePurchase(userId, transaction, signedPayload, tier, false, autoRenew);
      await setUserTier(userId, tier);
      break;

    case NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS:
      // User toggled auto-renew on/off. Informational; entitlement unchanged
      // until EXPIRED actually fires. This is the primary signal we use to
      // surface "pending cancellation" in the admin dashboard.
      await upsertApplePurchase(userId, transaction, signedPayload, tier, false, autoRenew);
      break;

    case NotificationTypeV2.DID_CHANGE_RENEWAL_PREF:
      // User scheduled a product change (upgrade/downgrade) for next period.
      // Current entitlement unchanged; persist the txn for audit.
      await upsertApplePurchase(userId, transaction, signedPayload, tier, false, autoRenew);
      break;

    case NotificationTypeV2.DID_FAIL_TO_RENEW:
      // Billing issue. If subtype is GRACE_PERIOD, entitlement is preserved.
      // Otherwise the sub will expire; await EXPIRED before downgrading.
      await upsertApplePurchase(userId, transaction, signedPayload, tier, false, autoRenew);
      break;

    case NotificationTypeV2.GRACE_PERIOD_EXPIRED:
    case NotificationTypeV2.EXPIRED:
      await upsertApplePurchase(
        userId,
        transaction,
        signedPayload,
        tier,
        /*revoked*/ true,
        autoRenew,
      );
      await downgradeIfNoActiveEntitlement(userId);
      break;

    case NotificationTypeV2.REFUND:
    case NotificationTypeV2.REVOKE:
      await upsertApplePurchase(
        userId,
        transaction,
        signedPayload,
        tier,
        /*revoked*/ true,
        autoRenew,
      );
      await downgradeIfNoActiveEntitlement(userId);
      break;

    case NotificationTypeV2.REFUND_DECLINED:
    case NotificationTypeV2.REFUND_REVERSED:
      await upsertApplePurchase(
        userId,
        transaction,
        signedPayload,
        tier,
        /*revoked*/ false,
        autoRenew,
      );
      await setUserTier(userId, tier);
      break;

    case NotificationTypeV2.RENEWAL_EXTENDED:
    case NotificationTypeV2.RENEWAL_EXTENSION:
      await upsertApplePurchase(userId, transaction, signedPayload, tier, false, autoRenew);
      await setUserTier(userId, tier);
      break;

    case NotificationTypeV2.PRICE_INCREASE:
      // Informational; user must opt in via App Store. No state change here.
      break;

    case NotificationTypeV2.CONSUMPTION_REQUEST:
      log.info('Apple CONSUMPTION_REQUEST (subscription) — manual response required', {
        userId,
        originalTransactionId: transaction.originalTransactionId,
      });
      break;

    default:
      // Surface unknown types loudly: Apple may add new notification types
      // (e.g. new refund variants) and silently swallowing them at info level
      // would let entitlement bugs slip through.
      log.warn('Unhandled subscription notification type', { notificationType, subtype, userId });
  }
}

async function handleCreditPackNotification(
  notificationType: NotificationTypeV2 | string,
  subtype: Subtype | string | undefined,
  signedPayload: string,
  userId: string,
  transaction: JWSTransactionDecodedPayload,
  product: Extract<AppleProduct, { type: 'credits' }>,
): Promise<void> {
  // Tier doesn't apply to consumables — the ApplePurchase row stores the user's
  // current tier just for schema reasons; it isn't used for entitlement.
  const tier = 'FREE' as UserTier;

  switch (notificationType) {
    case NotificationTypeV2.REFUND:
    case NotificationTypeV2.REVOKE:
      // Claw back FIRST: clawBackCreditsForRefund atomically claims the refund
      // via `revokedAt: null → now`, so it MUST see the row un-revoked. If the
      // upsert below set revokedAt first, the claw-back would always skip and
      // the user would keep refunded credits (the bug this ordering fixes).
      await clawBackCreditsForRefund(userId, transaction, product.credits);
      // Record/update the row for audit (productId/expiresAt/rawReceipt). The
      // claw-back already set revokedAt; re-asserting it here is harmless.
      await upsertApplePurchase(userId, transaction, signedPayload, tier, /*revoked*/ true);
      break;

    case NotificationTypeV2.REFUND_DECLINED:
    case NotificationTypeV2.REFUND_REVERSED:
      // No-op: credits were never deducted (we only deduct on REFUND).
      await upsertApplePurchase(userId, transaction, signedPayload, tier, /*revoked*/ false);
      break;

    case NotificationTypeV2.CONSUMPTION_REQUEST:
      log.info('Apple CONSUMPTION_REQUEST (credit pack) — manual response required', {
        userId,
        originalTransactionId: transaction.originalTransactionId,
        creditsGranted: product.credits,
      });
      break;

    case NotificationTypeV2.ONE_TIME_CHARGE:
      // Initial purchase of a consumable. Grant credits idempotently — if the
      // ApplePurchase row already exists we assume verify-receipt already
      // granted them and no-op.
      await grantCreditsIfNew(userId, transaction, signedPayload, product.credits);
      break;

    default:
      log.warn('Unhandled credit-pack notification type', { notificationType, subtype, userId });
  }
}

const worker = new Worker<AppleNotificationJobData>(
  'apple-notifications',
  async (job) => {
    const { signedPayload, notificationUUID } = job.data;
    const decoded = await verifyAndDecodeNotification(signedPayload);
    log.info('Processing Apple notification', {
      notificationUUID,
      notificationType: decoded.notificationType,
      subtype: decoded.subtype,
      environment: decoded.data?.environment,
    });
    if (!decoded.notificationType) {
      log.warn('Apple notification missing notificationType — skipping', { notificationUUID });
      return;
    }
    // TEST notifications have no signedTransactionInfo, so they'd be filtered out
    // by decodeNotificationPayload(). Handle them here before that path runs.
    if (decoded.notificationType === NotificationTypeV2.TEST) {
      log.info('Apple TEST notification received', { notificationUUID });
      return;
    }
    await handleNotification(decoded.notificationType, decoded.subtype, signedPayload);
  },
  { connection, concurrency: 4 },
);

worker.on('failed', (job, err) => {
  log.error('Apple notification job failed', {
    notificationUUID: job?.data?.notificationUUID,
    attempt: job?.attemptsMade,
    error: err.message,
    stack: err.stack,
  });

  // A terminally-failed Apple notification means a missed entitlement change
  // (renewal/refund/cancellation never applied) — real revenue impact. Alert on
  // the final attempt only, so transient retries don't spam Sentry. No-op when
  // Sentry is disabled.
  const attemptsMade = job?.attemptsMade ?? 0;
  const maxAttempts = (job?.opts?.attempts as number | undefined) ?? 1;
  if (attemptsMade >= maxAttempts) {
    Sentry.captureException(err, {
      tags: { service: 'queue', queue: 'apple-notifications' },
      extra: { notificationUUID: job?.data?.notificationUUID, attemptsMade, maxAttempts },
    });
  }
});

export default worker;
