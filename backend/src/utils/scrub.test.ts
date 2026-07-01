/**
 * Unit tests for the Sentry PII/secret scrubber. Pure module → no SDK, DB, or
 * Redis is loaded. Run with: npm test  (node --test + ts-node/register).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubObject, scrubSentryEvent, SENSITIVE_KEY } from './scrub';

test('scrubObject redacts top-level sensitive keys', () => {
  const out = scrubObject({ password: 'hunter2', username: 'bob', credits: 5 }) as Record<
    string,
    unknown
  >;
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.username, 'bob');
  assert.equal(out.credits, 5);
});

test('scrubObject redacts nested sensitive keys in objects and arrays', () => {
  const out = scrubObject({
    user: { id: 'u1', refreshToken: 'rt', profile: { apiKey: 'k' } },
    items: [{ secret: 's', name: 'ok' }],
  }) as any;
  assert.equal(out.user.id, 'u1');
  assert.equal(out.user.refreshToken, '[REDACTED]');
  assert.equal(out.user.profile.apiKey, '[REDACTED]');
  assert.equal(out.items[0].secret, '[REDACTED]');
  assert.equal(out.items[0].name, 'ok');
});

test('scrubObject matches the documented sensitive fragments', () => {
  for (const k of [
    'password',
    'passwordHash',
    'jwtToken',
    'api_key',
    'apiKey',
    'authorization',
    'cookie',
    'refreshToken',
    'rawReceipt',
    'signedJws',
    'otpCode',
    'verifyCode',
  ]) {
    assert.ok(SENSITIVE_KEY.test(k), `expected ${k} to be treated as sensitive`);
  }
  for (const k of ['username', 'email', 'credits', 'tier', 'jobId']) {
    assert.equal(SENSITIVE_KEY.test(k), false, `expected ${k} to be allowed`);
  }
});

test('scrubObject passes primitives and null through unchanged', () => {
  assert.equal(scrubObject(null), null);
  assert.equal(scrubObject(42), 42);
  assert.equal(scrubObject('hello'), 'hello');
  assert.equal(scrubObject(undefined), undefined);
});

test('scrubObject is depth-bounded (does not throw on deep input)', () => {
  let deep: any = { value: 1 };
  for (let i = 0; i < 50; i++) deep = { nested: deep, password: 'x' };
  assert.doesNotThrow(() => scrubObject(deep));
  const out = scrubObject(deep) as any;
  assert.equal(out.password, '[REDACTED]'); // top-level still redacted
});

test('scrubSentryEvent strips sensitive headers, keeps benign ones', () => {
  const event: any = {
    request: {
      headers: {
        authorization: 'Bearer abc',
        cookie: 'session=1',
        'x-admin-key': 'supersecret',
        'user-agent': 'jest',
        'content-type': 'application/json',
      },
    },
  };
  scrubSentryEvent(event);
  assert.equal(event.request.headers.authorization, undefined);
  assert.equal(event.request.headers.cookie, undefined);
  assert.equal(event.request.headers['x-admin-key'], undefined);
  assert.equal(event.request.headers['user-agent'], 'jest');
  assert.equal(event.request.headers['content-type'], 'application/json');
});

test('scrubSentryEvent drops cookies and scrubs request body', () => {
  const event: any = {
    request: {
      cookies: { session: 'abc' },
      data: { email: 'a@b.com', password: 'p', note: 'keep' },
    },
  };
  scrubSentryEvent(event);
  assert.equal(event.request.cookies, undefined);
  assert.equal(event.request.data.password, '[REDACTED]');
  assert.equal(event.request.data.email, 'a@b.com'); // email isn't a secret key; kept in body
  assert.equal(event.request.data.note, 'keep');
});

test('scrubSentryEvent keeps user.id but drops identifying fields', () => {
  const event: any = {
    user: { id: 'user-123', email: 'a@b.com', ip_address: '1.2.3.4', username: 'bob' },
  };
  scrubSentryEvent(event);
  assert.equal(event.user.id, 'user-123');
  assert.equal(event.user.email, undefined);
  assert.equal(event.user.ip_address, undefined);
  assert.equal(event.user.username, undefined);
});

test('scrubSentryEvent tolerates events with no request/user', () => {
  const event: any = { message: 'boom' };
  assert.doesNotThrow(() => scrubSentryEvent(event));
  assert.equal(event.message, 'boom');
});
