/**
 * Unit tests for the Stripe web-purchase catalog. Pure config/math — no
 * network or DB. Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStripeProduct, creditPackPriceCents, STRIPE_PRODUCTS } from './stripeProducts';

test('getStripeProduct resolves every known catalog key', () => {
  for (const key of Object.keys(STRIPE_PRODUCTS)) {
    assert.ok(getStripeProduct(key), `expected a product for ${key}`);
  }
});

test('getStripeProduct returns null for unknown/missing keys', () => {
  assert.equal(getStripeProduct('not-a-real-key'), null);
  assert.equal(getStripeProduct(undefined), null);
  assert.equal(getStripeProduct(null), null);
});

test('subscription products carry their tier and a positive price', () => {
  const basic = getStripeProduct('subscription.basic');
  const premium = getStripeProduct('subscription.premium');
  assert.ok(basic && basic.kind === 'subscription' && basic.tier === 'BASIC');
  assert.ok(premium && premium.kind === 'subscription' && premium.tier === 'PREMIUM');
  if (basic?.kind === 'subscription' && premium?.kind === 'subscription') {
    assert.ok(basic.unitAmountCents > 0);
    assert.ok(
      premium.unitAmountCents > basic.unitAmountCents,
      'premium should cost more than basic',
    );
  }
});

test('credit pack price scales with pack size and is cheaper at higher tiers', () => {
  const free10 = creditPackPriceCents(10, 'FREE');
  const basic10 = creditPackPriceCents(10, 'BASIC');
  const premium10 = creditPackPriceCents(10, 'PREMIUM');
  assert.ok(free10 > basic10, 'FREE tier should pay more per credit than BASIC');
  assert.ok(basic10 > premium10, 'BASIC tier should pay more per credit than PREMIUM');

  const free25 = creditPackPriceCents(25, 'FREE');
  assert.ok(free25 > free10, 'a bigger pack should cost more in total');
});

test('credit pack price is always a whole number of cents', () => {
  for (const credits of [10, 25, 50, 100]) {
    for (const tier of ['FREE', 'BASIC', 'PREMIUM'] as const) {
      const cents = creditPackPriceCents(credits, tier);
      assert.equal(Number.isInteger(cents), true, `${credits}/${tier} should round to whole cents`);
      assert.ok(cents > 0);
    }
  }
});
