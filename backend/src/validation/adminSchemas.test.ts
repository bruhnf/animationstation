import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminCreateUserSchema, firstZodError } from './adminSchemas';

const base = { username: 'mazie', email: 'mazie@dailywokester.com', password: 'Password1!' };

test('adminCreateUserSchema: accepts a valid user', () => {
  const r = adminCreateUserSchema.safeParse(base);
  assert.equal(r.success, true);
});

test('adminCreateUserSchema: REJECTS an email with no TLD (the mazie@dailywokester bug)', () => {
  const r = adminCreateUserSchema.safeParse({ ...base, email: 'mazie@dailywokester' });
  assert.equal(r.success, false);
  if (!r.success) {
    // Must surface a useful message, not silently accept.
    assert.match(firstZodError(r.error), /email/i);
  }
});

test('adminCreateUserSchema: rejects other malformed emails', () => {
  for (const email of ['notanemail', 'a@b', 'foo@bar.', '@nope.com', 'spaces in@email.com']) {
    assert.equal(
      adminCreateUserSchema.safeParse({ ...base, email }).success,
      false,
      `should reject "${email}"`,
    );
  }
});

test('adminCreateUserSchema: trims and accepts surrounding whitespace', () => {
  const r = adminCreateUserSchema.safeParse({
    ...base,
    email: '  mazie@dailywokester.com  ',
    username: ' mazie ',
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.email, 'mazie@dailywokester.com');
    assert.equal(r.data.username, 'mazie');
  }
});

test('adminCreateUserSchema: requires username, email, password', () => {
  assert.equal(
    adminCreateUserSchema.safeParse({ email: base.email, password: 'x' }).success,
    false,
  );
  assert.equal(
    adminCreateUserSchema.safeParse({ username: 'mazie', password: 'x' }).success,
    false,
  );
  assert.equal(
    adminCreateUserSchema.safeParse({ username: 'mazie', email: base.email }).success,
    false,
  );
});

test('adminCreateUserSchema: allows simple admin test passwords (no complexity rule)', () => {
  assert.equal(adminCreateUserSchema.safeParse({ ...base, password: 'abc' }).success, true);
});
