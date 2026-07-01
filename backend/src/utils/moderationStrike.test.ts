/**
 * Unit tests for the moderation-strike alert decision. Pure module → no env/DB.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAlertOnStrike } from './moderationStrike';

test('alerts on positive multiples of the threshold', () => {
  assert.equal(shouldAlertOnStrike(3, 3), true);
  assert.equal(shouldAlertOnStrike(6, 3), true);
  assert.equal(shouldAlertOnStrike(9, 3), true);
});

test('does not alert between thresholds', () => {
  for (const n of [1, 2, 4, 5, 7, 8]) {
    assert.equal(shouldAlertOnStrike(n, 3), false, `n=${n} should not alert`);
  }
});

test('never alerts on zero, negative, or non-integer counts', () => {
  assert.equal(shouldAlertOnStrike(0, 3), false);
  assert.equal(shouldAlertOnStrike(-3, 3), false);
  assert.equal(shouldAlertOnStrike(3.0001, 3), false);
});

test('respects a custom threshold', () => {
  assert.equal(shouldAlertOnStrike(5, 5), true);
  assert.equal(shouldAlertOnStrike(10, 5), true);
  assert.equal(shouldAlertOnStrike(4, 5), false);
});

test('a zero/invalid threshold disables alerting (no divide-by-zero)', () => {
  assert.equal(shouldAlertOnStrike(3, 0), false);
  assert.equal(shouldAlertOnStrike(3, -1), false);
});
