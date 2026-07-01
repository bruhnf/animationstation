import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signupSchema, loginSchema } from './authSchemas';

const GOOD_PW = 'Sup3r!pass';

describe('signupSchema — email+password-only signup (1.0.17)', () => {
  it('accepts the minimal payload: email + password, no username', () => {
    const r = signupSchema.safeParse({ email: 'a@b.com', password: GOOD_PW });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.username, undefined);
      assert.equal(r.data.firstName, undefined);
    }
  });

  it('still accepts a payload WITH a username (backward compatible: old clients, website)', () => {
    const r = signupSchema.safeParse({
      username: 'jane_doe1',
      email: 'a@b.com',
      password: GOOD_PW,
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.username, 'jane_doe1');
  });

  it('rejects usernames that are too short, too long, or carry illegal characters', () => {
    for (const username of ['ab', 'x'.repeat(31), 'has-dash', 'has space', 'has.dot', 'émoji']) {
      const r = signupSchema.safeParse({ username, email: 'a@b.com', password: GOOD_PW });
      assert.equal(r.success, false, `expected rejection for username ${JSON.stringify(username)}`);
    }
  });

  it('accepts boundary usernames: 3 chars, 30 chars, letters/digits/underscore', () => {
    for (const username of ['abc', 'A1_', 'x'.repeat(30)]) {
      const r = signupSchema.safeParse({ username, email: 'a@b.com', password: GOOD_PW });
      assert.equal(r.success, true, `expected acceptance for username ${JSON.stringify(username)}`);
    }
  });

  it('enforces every password complexity rule independently', () => {
    const cases: Array<[string, string]> = [
      ['Sh0r!t', 'under 8 chars'],
      ['lower1!pass', 'no uppercase'],
      ['NoDigits!!', 'no number'],
      ['NoSpecial1', 'no special character'],
    ];
    for (const [password, why] of cases) {
      const r = signupSchema.safeParse({ email: 'a@b.com', password });
      assert.equal(r.success, false, `expected rejection: ${why}`);
    }
  });

  it('rejects malformed emails and missing required fields', () => {
    assert.equal(
      signupSchema.safeParse({ email: 'not-an-email', password: GOOD_PW }).success,
      false,
    );
    assert.equal(signupSchema.safeParse({ email: 'a@b.com' }).success, false);
    assert.equal(signupSchema.safeParse({ password: GOOD_PW }).success, false);
    assert.equal(signupSchema.safeParse({}).success, false);
  });

  it('caps optional name fields at 50 chars', () => {
    const ok = signupSchema.safeParse({
      email: 'a@b.com',
      password: GOOD_PW,
      firstName: 'x'.repeat(50),
    });
    assert.equal(ok.success, true);
    const bad = signupSchema.safeParse({
      email: 'a@b.com',
      password: GOOD_PW,
      lastName: 'x'.repeat(51),
    });
    assert.equal(bad.success, false);
  });

  it('strips unknown fields rather than failing (defensive against newer clients)', () => {
    const r = signupSchema.safeParse({ email: 'a@b.com', password: GOOD_PW, deviceId: 'abc' });
    assert.equal(r.success, true);
    if (r.success) assert.equal('deviceId' in r.data, false);
  });
});

describe('loginSchema', () => {
  it('accepts email + any non-empty password (no complexity rules on login)', () => {
    assert.equal(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success, true);
  });
  it('rejects an empty password and a bad email', () => {
    assert.equal(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success, false);
    assert.equal(loginSchema.safeParse({ email: 'nope', password: 'x' }).success, false);
  });
});
