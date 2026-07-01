/**
 * Unit tests for email normalization (anti-farming dedup). Pure → no env/DB.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail } from './emailNormalize';

test('lowercases and trims', () => {
  assert.equal(normalizeEmail('  Bruhn@Example.COM '), 'bruhn@example.com');
});

test('strips +tag subaddressing for all providers', () => {
  assert.equal(normalizeEmail('a+1@example.com'), 'a@example.com');
  assert.equal(normalizeEmail('a+2@example.com'), 'a@example.com');
  assert.equal(normalizeEmail('user+anything.here@fastmail.com'), 'user@fastmail.com');
});

test('strips dots in the local part ONLY for gmail/googlemail', () => {
  assert.equal(normalizeEmail('a.b.c@gmail.com'), 'abc@gmail.com');
  assert.equal(normalizeEmail('a.b@googlemail.com'), 'ab@googlemail.com');
  // Non-gmail dots are significant and preserved.
  assert.equal(normalizeEmail('a.b@example.com'), 'a.b@example.com');
});

test('combines gmail dot + plus folding', () => {
  assert.equal(normalizeEmail('a.b+work@gmail.com'), 'ab@gmail.com');
  assert.equal(normalizeEmail('a.b+home@gmail.com'), 'ab@gmail.com');
});

test('all of these gmail variants collapse to one identity', () => {
  const canonical = 'johnsmith@gmail.com';
  for (const v of [
    'johnsmith@gmail.com',
    'john.smith@gmail.com',
    'j.o.h.n.smith@gmail.com',
    'johnsmith+netflix@gmail.com',
    'John.Smith+ABC@Gmail.com',
  ]) {
    assert.equal(normalizeEmail(v), canonical, v);
  }
});

test('returns null for non-strings and malformed addresses', () => {
  for (const v of [
    null,
    undefined,
    42,
    {},
    '',
    'no-at-sign',
    '@nodomain.com',
    'nolocal@',
    '+tag@x.com',
  ]) {
    assert.equal(normalizeEmail(v as unknown), null, String(v));
  }
});

test('handles an @ in display oddities by using the last @', () => {
  // Defensive: last "@" splits local/domain.
  assert.equal(normalizeEmail('weird@name@example.com'), null); // domain contains '@' → reject
});
