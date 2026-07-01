import prisma from '../lib/prisma';
import { createChildLogger } from './logger';
import {
  getReferralCreditGrant,
  getReferralMaxPerWindow,
  REFERRAL_REWARD_WINDOW_DAYS,
} from './appSettingsService';
import { generateReferralCode, normalizeReferralCode } from '../utils/referralCode';
import { isUniqueConstraintError } from '../utils/prismaErrors';

const log = createChildLogger('ReferralService');

/**
 * Return the user's stable referral code, generating + persisting one on first
 * use. Retries on the (rare) unique-code collision.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateReferralCode();
    try {
      await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      return code;
    } catch (err) {
      // Collision on the unique code — try again with a new one. Any other
      // error (e.g. a concurrent request already set a code) → re-read.
      if (isUniqueConstraintError(err)) {
        const reread = await prisma.user.findUnique({
          where: { id: userId },
          select: { referralCode: true },
        });
        if (reread?.referralCode) return reread.referralCode;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Could not generate a unique referral code');
}

/**
 * Capture a pending referral when a NEW user signs up with someone's code.
 * Best-effort and fully self-contained: a referral failure must never break
 * signup. Creates an unrewarded Referral row; the payout happens later at the
 * referred user's email verification (processReferralReward).
 */
export async function recordPendingReferral(
  referredUserId: string,
  rawCode: unknown,
): Promise<void> {
  try {
    const code = normalizeReferralCode(rawCode);
    if (!code) return;

    const referrer = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!referrer) return; // unknown code — ignore silently
    if (referrer.id === referredUserId) return; // can't refer yourself

    // referredUserId is unique → a second attempt is a no-op (the user was
    // already referred, possibly as a guest before claiming).
    await prisma.referral.create({
      data: { referrerId: referrer.id, referredUserId },
    });
    log.info('Pending referral recorded', { referrerId: referrer.id, referredUserId });
  } catch (err) {
    if (isUniqueConstraintError(err)) return; // already referred — fine
    log.warn('recordPendingReferral failed (ignored)', {
      referredUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Grant the referral reward to BOTH sides when a referred user verifies their
 * email. Idempotent (acts only while rewardedAt is null) and self-contained so
 * it can never break verification. No-op when the grant is 0 (offer disabled).
 */
export async function processReferralReward(referredUserId: string): Promise<void> {
  try {
    const referral = await prisma.referral.findUnique({
      where: { referredUserId },
      select: { id: true, referrerId: true, rewardedAt: true },
    });
    if (!referral || referral.rewardedAt) return; // none, or already paid

    const [grant, cap] = await Promise.all([getReferralCreditGrant(), getReferralMaxPerWindow()]);
    const windowStart = new Date(Date.now() - REFERRAL_REWARD_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    let referrerPaid = false;
    await prisma.$transaction(async (tx) => {
      // Claim the referral row first (conditional, rewardedAt only) so concurrent
      // verifications can't double-pay. creditsAwarded is set below to the
      // REFERRER's actual earning (0 if the offer is off or the cap withholds it).
      const claimed = await tx.referral.updateMany({
        where: { id: referral.id, rewardedAt: null },
        data: { rewardedAt: new Date() },
      });
      if (claimed.count === 0) return; // someone else claimed it
      if (grant <= 0) return; // offer disabled — recorded as rewarded with 0

      // Anti-farming cap: count the referrer's already-rewarded, actually-paid
      // referrals in the rolling window (excluding this row). Over the cap, the
      // REFERRER's payout is withheld — but the referred user still gets their
      // join bonus (they're not the abuser). cap = 0 means unlimited.
      let referrerEligible = true;
      if (cap > 0) {
        const recentPaid = await tx.referral.count({
          where: {
            referrerId: referral.referrerId,
            id: { not: referral.id },
            rewardedAt: { gte: windowStart },
            creditsAwarded: { gt: 0 },
          },
        });
        referrerEligible = recentPaid < cap;
      }

      // Referred user is always paid when the offer is on.
      await tx.user.update({
        where: { id: referredUserId },
        data: { credits: { increment: grant } },
      });
      await tx.creditTransaction.create({
        data: {
          userId: referredUserId,
          type: 'GRANT',
          amount: grant,
          description: 'Referral bonus (referred)',
        },
      });

      if (referrerEligible) {
        await tx.user.update({
          where: { id: referral.referrerId },
          data: { credits: { increment: grant } },
        });
        await tx.creditTransaction.create({
          data: {
            userId: referral.referrerId,
            type: 'GRANT',
            amount: grant,
            description: 'Referral bonus (referrer)',
          },
        });
        // creditsAwarded tracks the REFERRER's earning (drives getReferralSummary).
        await tx.referral.update({ where: { id: referral.id }, data: { creditsAwarded: grant } });
        referrerPaid = true;
      }
      // Capped: leave creditsAwarded at its default 0 — recorded as a completed
      // referral the referrer earned nothing on.
    });
    if (grant > 0) {
      log.info('Referral reward processed', {
        referredUserId,
        referrerId: referral.referrerId,
        grant,
        referrerPaid,
        cap,
      });
      if (!referrerPaid) {
        log.warn('Referral referrer payout withheld (per-referrer cap reached)', {
          referrerId: referral.referrerId,
          cap,
          windowDays: REFERRAL_REWARD_WINDOW_DAYS,
        });
      }
    }
  } catch (err) {
    log.warn('processReferralReward failed (ignored)', {
      referredUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ReferralSummary {
  code: string;
  referredCount: number; // total successful (rewarded) referrals
  pendingCount: number; // referred users who haven't verified yet
  creditsEarned: number; // total credits earned from referrals (referrer side)
  rewardPerReferral: number;
  offerActive: boolean;
}

export async function getReferralSummary(userId: string): Promise<ReferralSummary> {
  const code = await ensureReferralCode(userId);
  const [rewarded, pending, grant] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId, rewardedAt: { not: null } },
      select: { creditsAwarded: true },
    }),
    prisma.referral.count({ where: { referrerId: userId, rewardedAt: null } }),
    getReferralCreditGrant(),
  ]);
  return {
    code,
    referredCount: rewarded.length,
    pendingCount: pending,
    creditsEarned: rewarded.reduce((sum, r) => sum + r.creditsAwarded, 0),
    rewardPerReferral: grant,
    offerActive: grant > 0,
  };
}
