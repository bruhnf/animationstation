import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReferralCode, normalizeReferralCode, REFERRAL_CODE_LENGTH } from './referralCode';

test('generateReferralCode: correct length, only safe alphabet', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateReferralCode();
    assert.equal(code.length, REFERRAL_CODE_LENGTH);
    // No ambiguous chars (0/O/1/I/L), all uppercase alnum from the safe set.
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  }
});

test('generateReferralCode: deterministic with a seeded rand', () => {
  let i = 0;
  const seq = [0, 1, 2, 3, 4, 5, 6];
  const rand = () => seq[i++];
  // ALPHABET[0..6] = A B C D E F G
  assert.equal(generateReferralCode(rand), 'ABCDEFG');
});

test('normalizeReferralCode: trims, uppercases, strips spaces/dashes', () => {
  assert.equal(normalizeReferralCode('  abc-1234 '), 'ABC1234');
  assert.equal(normalizeReferralCode('xY9 zk2'), 'XY9ZK2');
});

test('normalizeReferralCode: rejects empty/non-string/too-long', () => {
  assert.equal(normalizeReferralCode(''), null);
  assert.equal(normalizeReferralCode('   '), null);
  assert.equal(normalizeReferralCode(123 as unknown), null);
  assert.equal(normalizeReferralCode(null), null);
  assert.equal(normalizeReferralCode('A'.repeat(21)), null);
});
