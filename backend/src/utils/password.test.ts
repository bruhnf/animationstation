/**
 * Unit tests for password hashing + the login timing-equalizer hash.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from './password';

test('hash + verify roundtrip; wrong password rejected', async () => {
  const hash = await hashPassword('Sup3rSecret!');
  assert.equal(await verifyPassword('Sup3rSecret!', hash), true);
  assert.equal(await verifyPassword('not-it', hash), false);
});

test('hashes use bcrypt cost 12', async () => {
  const hash = await hashPassword('whatever1!');
  assert.match(hash, /^\$2[aby]\$12\$/);
});

test('DUMMY_PASSWORD_HASH is a well-formed cost-12 hash so bcrypt.compare does NOT early-return (keeps the login timing side-channel closed)', async () => {
  assert.match(DUMMY_PASSWORD_HASH, /^\$2[aby]\$12\$/);
  // If the dummy hash were malformed, bcrypt.compare returns false immediately
  // (cheap) — reopening the user-enumeration timing channel. It must run the
  // full cost and return false for any input.
  assert.equal(await bcrypt.compare('any-attempt', DUMMY_PASSWORD_HASH), false);
});
