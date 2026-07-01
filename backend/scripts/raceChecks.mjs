/**
 * Empirical concurrency checks for the credit / weekly-limit logic.
 *
 * LOCAL ONLY — points at the local docker Postgres and creates/deletes
 * throwaway users. Never run against a live database.
 *
 *   cd backend
 *   $env:DATABASE_URL='postgresql://tryon:tryon_dev@localhost:5432/tryon_db'
 *   node scripts/raceChecks.mjs
 *
 * What it proves / disproves:
 *   A.  The conditional credit decrement used by tryonController.submitTryOn
 *       (updateMany WHERE credits >= 1) cannot double-spend under concurrency.
 *   B1. The PRE-FIX verifyEmail welcome-grant pattern (findFirst on the token,
 *       then an unconditional update) double-grants under concurrency. Kept as
 *       documentation of why authController.verifyEmail uses a conditional
 *       token-consume (fixed 2026-06-11).
 *   B2. The conditional-update pattern verifyEmail now uses grants exactly once.
 *   C1. The PRE-FIX weekly-limit gate (count, then create in a later
 *       transaction) overshoots the weekly cap under concurrency. Kept as
 *       documentation of why submitTryOn locks the user row (fixed 2026-06-11).
 *   C2. The pattern submitTryOn now uses — user-row lock (FOR UPDATE), recount
 *       inside the lock, then create + conditional credit charge — holds the
 *       cap exactly and never grants a free overshoot.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const dbUrl = process.env.DATABASE_URL ?? '';
if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
  console.error('Refusing to run: DATABASE_URL is not a localhost database.');
  process.exit(1);
}

let failures = 0;
function report(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures += 1;
}

async function makeUser(data = {}) {
  return prisma.user.create({
    data: {
      username: `race_${randomUUID().slice(0, 8)}`,
      email: `race-${randomUUID()}@example.test`,
      passwordHash: 'x',
      verified: true,
      ...data,
    },
  });
}

// ── A. Conditional credit decrement (submitTryOn's guard) ──────────────────
async function checkConditionalDecrement(credits, attempts) {
  const user = await makeUser({ credits });
  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      prisma.user.updateMany({
        where: { id: user.id, credits: { gte: 1 } },
        data: { credits: { decrement: 1 } },
      }),
    ),
  );
  const succeeded = results.filter((r) => r.count === 1).length;
  const final = await prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } });
  report(
    `A: ${attempts} concurrent decrements vs ${credits} credit(s)`,
    succeeded === credits && final.credits === 0,
    `${succeeded} succeeded (expected ${credits}), final balance ${final.credits} (expected 0, never negative)`,
  );
  await prisma.user.delete({ where: { id: user.id } });
}

// ── B. verifyEmail welcome-grant pattern ────────────────────────────────────
// Replicates authController.verifyEmail's current shape: findFirst by token,
// then a $transaction whose user.update is NOT conditional on the token still
// being present. Concurrent requests all pass the findFirst before any commit.
async function checkVerifyEmailCurrentPattern(attempts) {
  const token = randomUUID();
  const user = await makeUser({ verified: false, verifyToken: token, credits: 0 });

  await Promise.all(
    Array.from({ length: attempts }, async () => {
      const found = await prisma.user.findFirst({ where: { verifyToken: token } });
      if (!found) return;
      await prisma.$transaction([
        prisma.user.update({
          where: { id: found.id },
          data: { verified: true, verifyToken: null, credits: { increment: 10 } },
        }),
        prisma.creditTransaction.create({
          data: { userId: found.id, type: 'GRANT', amount: 10, description: 'race-check welcome bonus' },
        }),
      ]);
    }),
  );

  const final = await prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } });
  const grants = await prisma.creditTransaction.count({ where: { userId: user.id, type: 'GRANT' } });
  // This documents the BUG: pass = the race is demonstrated (more than one grant).
  report(
    `B1: PRE-FIX verifyEmail pattern, ${attempts} concurrent verifications`,
    grants > 1,
    `${grants} GRANT rows, final balance ${final.credits} — single-use token is NOT atomic (expected +10 once)`,
  );
  await prisma.creditTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

// The fix: make the token-consume + grant a single conditional update keyed on
// the token still being present, and only write the GRANT when it matched.
async function checkVerifyEmailFixedPattern(attempts) {
  const token = randomUUID();
  const user = await makeUser({ verified: false, verifyToken: token, credits: 0 });

  await Promise.all(
    Array.from({ length: attempts }, async () => {
      await prisma.$transaction(async (tx) => {
        const consumed = await tx.user.updateMany({
          where: { id: user.id, verifyToken: token },
          data: { verified: true, verifyToken: null, credits: { increment: 10 } },
        });
        if (consumed.count === 1) {
          await tx.creditTransaction.create({
            data: { userId: user.id, type: 'GRANT', amount: 10, description: 'race-check welcome bonus (fixed)' },
          });
        }
      });
    }),
  );

  const final = await prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } });
  const grants = await prisma.creditTransaction.count({ where: { userId: user.id, type: 'GRANT' } });
  report(
    `B2: conditional-update fix, ${attempts} concurrent verifications`,
    grants === 1 && final.credits === 10,
    `${grants} GRANT row(s), final balance ${final.credits} (expected exactly one +10)`,
  );
  await prisma.creditTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

// ── C. Weekly-limit gate (count, then create) ───────────────────────────────
// Replicates submitTryOn's gate for a BASIC user (12/week) sitting at 11 used:
// each concurrent submit counts the window, sees 11 < 12, and creates a job on
// the free allowance.
async function checkWeeklyLimitRace(limit, alreadyUsed, attempts) {
  const user = await makeUser({ tier: 'BASIC', credits: 0 });
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.tryOnJob.createMany({
    data: Array.from({ length: alreadyUsed }, () => ({
      id: randomUUID(),
      userId: user.id,
      clothingPhoto1Url: 'race-check',
      perspectivesUsed: [],
    })),
  });

  await Promise.all(
    Array.from({ length: attempts }, async () => {
      const weekCount = await prisma.tryOnJob.count({
        where: { userId: user.id, createdAt: { gte: weekStart }, status: { not: 'FAILED' } },
      });
      if (weekCount < limit) {
        await prisma.tryOnJob.create({
          data: { id: randomUUID(), userId: user.id, clothingPhoto1Url: 'race-check', perspectivesUsed: [] },
        });
      }
    }),
  );

  const total = await prisma.tryOnJob.count({ where: { userId: user.id } });
  // This documents the BUG: pass = the overshoot is demonstrated.
  report(
    `C1: PRE-FIX weekly gate at ${alreadyUsed}/${limit} with ${attempts} concurrent submits`,
    total > limit,
    `${total} jobs in window (cap is ${limit}) — count-then-create overshoots by ${total - limit}`,
  );
  await prisma.tryOnJob.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

// The pattern submitTryOn now uses: lock the user row, recount inside the
// lock, create the job, and charge a credit when the allowance is spent.
// Seeded at 11/12 with 2 credits and 5 concurrent submits, exactly one rides
// the last free slot, exactly two pay a credit, and the other two roll back.
async function checkWeeklyLimitFixedPattern(limit, alreadyUsed, credits, attempts) {
  const user = await makeUser({ tier: 'BASIC', credits });
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.tryOnJob.createMany({
    data: Array.from({ length: alreadyUsed }, () => ({
      id: randomUUID(),
      userId: user.id,
      clothingPhoto1Url: 'race-check',
      perspectivesUsed: [],
    })),
  });

  let rolledBack = 0;
  await Promise.all(
    Array.from({ length: attempts }, async () => {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
          const weekCountNow = await tx.tryOnJob.count({
            where: { userId: user.id, createdAt: { gte: weekStart }, status: { not: 'FAILED' } },
          });
          const payWithCredit = !(weekCountNow < limit);
          await tx.tryOnJob.create({
            data: { id: randomUUID(), userId: user.id, clothingPhoto1Url: 'race-check', perspectivesUsed: [] },
          });
          if (payWithCredit) {
            const deducted = await tx.user.updateMany({
              where: { id: user.id, credits: { gte: 1 } },
              data: { credits: { decrement: 1 } },
            });
            if (deducted.count === 0) throw new Error('insufficient credits');
          }
        });
      } catch {
        rolledBack += 1;
      }
    }),
  );

  const total = await prisma.tryOnJob.count({ where: { userId: user.id } });
  const final = await prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } });
  const expectedTotal = limit + credits; // free up to the cap, then one per credit
  report(
    `C2: FIXED weekly gate at ${alreadyUsed}/${limit} + ${credits} credits, ${attempts} concurrent submits`,
    total === expectedTotal && final.credits === 0 && rolledBack === attempts - (limit - alreadyUsed) - credits,
    `${total} jobs (expected ${expectedTotal}: cap ${limit} free + ${credits} paid), balance ${final.credits} (expected 0), ${rolledBack} rolled back`,
  );
  await prisma.tryOnJob.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

console.log('Race checks against', dbUrl.replace(/:[^:@/]+@/, ':***@'));
console.log('\n[A] submitTryOn conditional credit decrement (expected: race-safe)');
await checkConditionalDecrement(1, 10);
await checkConditionalDecrement(5, 25);
console.log('\n[B] verifyEmail welcome grant (B1 demonstrates the bug, B2 the fix)');
await checkVerifyEmailCurrentPattern(5);
await checkVerifyEmailFixedPattern(5);
console.log('\n[C] weekly-limit gate (C1 demonstrates the pre-fix overshoot, C2 the fix)');
await checkWeeklyLimitRace(12, 11, 5);
await checkWeeklyLimitFixedPattern(12, 11, 2, 5);

await prisma.$disconnect();
console.log(failures === 0 ? '\nAll race checks behaved as expected.' : `\n${failures} check(s) did not behave as expected.`);
process.exit(failures === 0 ? 0 : 1);
