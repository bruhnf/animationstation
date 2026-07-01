/**
 * Unit tests for refresh-token hashing. We store only this hash, so it must be
 * deterministic (usable as a unique lookup key) and collision-resistant.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashRefreshToken } from './tokenHash';

test('produces a 64-char lowercase-hex SHA-256', () => {
  const h = hashRefreshToken('some.jwt.token');
  assert.equal(h, crypto.createHash('sha256').update('some.jwt.token').digest('hex'));
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('is deterministic (same input → same hash, for lookups)', () => {
  assert.equal(hashRefreshToken('abc'), hashRefreshToken('abc'));
});

test('different tokens produce different hashes', () => {
  assert.notEqual(hashRefreshToken('token-a'), hashRefreshToken('token-b'));
});
