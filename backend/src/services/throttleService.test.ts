/**
 * Unit tests for the soft creation throttle ladder + config validation. Pure
 * math / validation → no DB. Codifies the documented behavior in CLAUDE.md
 * (Soft per-user throttle). Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  delayForOrdinal,
  validateThrottleConfig,
  DEFAULT_THROTTLE_CONFIG,
  MAX_LADDER_MS,
  type ThrottleConfig,
} from './throttleService';

const SEC = 1000;

test('FREE: first 6 free, then 10/20/30/40s ladder', () => {
  assert.equal(delayForOrdinal(1, 'FREE').delayMs, 0);
  assert.equal(delayForOrdinal(6, 'FREE').delayMs, 0);
  assert.equal(delayForOrdinal(7, 'FREE').delayMs, 10 * SEC);
  assert.equal(delayForOrdinal(8, 'FREE').delayMs, 20 * SEC);
  assert.equal(delayForOrdinal(9, 'FREE').delayMs, 30 * SEC);
  assert.equal(delayForOrdinal(10, 'FREE').delayMs, 40 * SEC);
});

test('BASIC: first 8 free (two more than FREE)', () => {
  assert.equal(delayForOrdinal(8, 'BASIC').delayMs, 0);
  assert.equal(delayForOrdinal(9, 'BASIC').delayMs, 10 * SEC);
  assert.equal(delayForOrdinal(12, 'BASIC').delayMs, 40 * SEC);
});

test('PREMIUM: first 10 free', () => {
  assert.equal(delayForOrdinal(10, 'PREMIUM').delayMs, 0);
  assert.equal(delayForOrdinal(11, 'PREMIUM').delayMs, 10 * SEC);
  assert.equal(delayForOrdinal(14, 'PREMIUM').delayMs, 40 * SEC);
});

test('burst sizes per tier', () => {
  assert.equal(delayForOrdinal(1, 'FREE').burst, 6);
  assert.equal(delayForOrdinal(1, 'BASIC').burst, 8);
  assert.equal(delayForOrdinal(1, 'PREMIUM').burst, 10);
});

test('delay is monotonic non-decreasing and caps at the last ladder rung', () => {
  const ladder = DEFAULT_THROTTLE_CONFIG.ladderMs;
  const cap = ladder[ladder.length - 1];
  for (const tier of ['FREE', 'BASIC', 'PREMIUM'] as const) {
    let prev = -1;
    for (let o = 1; o <= 50; o++) {
      const d = delayForOrdinal(o, tier).delayMs;
      assert.ok(d >= prev, `${tier} ordinal ${o} went backwards`);
      assert.ok(d <= cap, `${tier} ordinal ${o} exceeded cap`);
      prev = d;
    }
    assert.equal(delayForOrdinal(999, tier).delayMs, cap);
  }
});

test('no ladder rung in the default config exceeds the 60s ceiling', () => {
  for (const ms of DEFAULT_THROTTLE_CONFIG.ladderMs) {
    assert.ok(ms <= MAX_LADDER_MS, `rung ${ms} exceeds ${MAX_LADDER_MS}`);
  }
});

test('delayForOrdinal honors a custom config', () => {
  const cfg: ThrottleConfig = {
    windowMs: 10 * 60 * 1000,
    burst: { FREE: 1, BASIC: 2, PREMIUM: 3 },
    ladderMs: [5_000, 15_000],
  };
  assert.equal(delayForOrdinal(1, 'FREE', cfg).delayMs, 0);
  assert.equal(delayForOrdinal(2, 'FREE', cfg).delayMs, 5_000);
  assert.equal(delayForOrdinal(3, 'FREE', cfg).delayMs, 15_000);
  assert.equal(delayForOrdinal(99, 'FREE', cfg).delayMs, 15_000); // caps
});

test('validateThrottleConfig accepts the default config round-trip', () => {
  const parsed = validateThrottleConfig(JSON.parse(JSON.stringify(DEFAULT_THROTTLE_CONFIG)));
  assert.deepEqual(parsed, DEFAULT_THROTTLE_CONFIG);
});

test('validateThrottleConfig rejects bad input', () => {
  assert.throws(() => validateThrottleConfig(null));
  assert.throws(() => validateThrottleConfig('nope'));
  // window out of range
  assert.throws(() => validateThrottleConfig({ ...DEFAULT_THROTTLE_CONFIG, windowMs: 500 }));
  // missing a tier
  assert.throws(() =>
    validateThrottleConfig({ ...DEFAULT_THROTTLE_CONFIG, burst: { FREE: 6, BASIC: 8 } }),
  );
  // negative burst
  assert.throws(() =>
    validateThrottleConfig({
      ...DEFAULT_THROTTLE_CONFIG,
      burst: { FREE: -1, BASIC: 8, PREMIUM: 10 },
    }),
  );
  // empty ladder
  assert.throws(() => validateThrottleConfig({ ...DEFAULT_THROTTLE_CONFIG, ladderMs: [] }));
  // rung above the 60s ceiling
  assert.throws(() =>
    validateThrottleConfig({ ...DEFAULT_THROTTLE_CONFIG, ladderMs: [10_000, 90_000] }),
  );
});
