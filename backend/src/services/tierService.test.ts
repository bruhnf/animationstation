/**
 * Regression guard on the tier table. These numbers drive billing (credit
 * price) and the weekly free allowance — a silent edit changes what every
 * user is charged/allowed, so pin them explicitly.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIER_CONFIG } from './tierService';

test('FREE = 0 weekly, $0.60/credit', () => {
  assert.deepEqual(TIER_CONFIG.FREE, { weeklyLimit: 0, creditPrice: 0.6 });
});

test('BASIC = 12 weekly, $0.50/credit', () => {
  assert.deepEqual(TIER_CONFIG.BASIC, { weeklyLimit: 12, creditPrice: 0.5 });
});

test('PREMIUM = 24 weekly, $0.25/credit', () => {
  assert.deepEqual(TIER_CONFIG.PREMIUM, { weeklyLimit: 24, creditPrice: 0.25 });
});

test('higher tiers never cost more per credit, and PREMIUM allows the most', () => {
  assert.ok(TIER_CONFIG.PREMIUM.creditPrice <= TIER_CONFIG.BASIC.creditPrice);
  assert.ok(TIER_CONFIG.BASIC.creditPrice <= TIER_CONFIG.FREE.creditPrice);
  assert.ok(TIER_CONFIG.PREMIUM.weeklyLimit >= TIER_CONFIG.BASIC.weeklyLimit);
});
