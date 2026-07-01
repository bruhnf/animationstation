/**
 * Unit tests for the Prisma unique-constraint error guard. Pure module → no
 * env/DB. Run with: npm test
 *
 * This guard is what turns a check-then-create race (two concurrent signups /
 * renames passing the uniqueness pre-check, loser hits the DB unique index)
 * into the same 409 the pre-check returns instead of a 500 — so its detection
 * must be exact: P2002 and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUniqueConstraintError } from './prismaErrors';

test('detects a Prisma P2002 unique-constraint violation', () => {
  // Shape thrown by @prisma/client (PrismaClientKnownRequestError): an Error
  // subclass carrying a `code` property.
  const err = Object.assign(new Error('Unique constraint failed on the fields: (`username`)'), {
    code: 'P2002',
    meta: { target: ['username'] },
  });
  assert.equal(isUniqueConstraintError(err), true);
});

test('detects P2002 on a plain object (not an Error instance)', () => {
  assert.equal(isUniqueConstraintError({ code: 'P2002' }), true);
});

test('rejects other Prisma error codes', () => {
  for (const code of ['P2025', 'P2003', 'P1001', 'P2000']) {
    const err = Object.assign(new Error('some prisma error'), { code });
    assert.equal(isUniqueConstraintError(err), false, `code=${code} must not match`);
  }
});

test('rejects errors without a code property', () => {
  assert.equal(isUniqueConstraintError(new Error('plain error')), false);
});

test('rejects non-object and empty values', () => {
  assert.equal(isUniqueConstraintError(null), false);
  assert.equal(isUniqueConstraintError(undefined), false);
  assert.equal(isUniqueConstraintError('P2002'), false);
  assert.equal(isUniqueConstraintError(2002), false);
  assert.equal(isUniqueConstraintError({}), false);
});

test('rejects a non-string code that happens to be truthy', () => {
  assert.equal(isUniqueConstraintError({ code: 2002 }), false);
  assert.equal(isUniqueConstraintError({ code: { value: 'P2002' } }), false);
});
