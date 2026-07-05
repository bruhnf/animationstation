/**
 * Unit tests for the Apple verification diagnostics added after the Jim
 * Morris purchase incident (2026-06-11): VerificationException carries an
 * empty message and a numeric status, so logs said `error: ""` while a
 * paying user's credits silently failed to land. Pure module → no env/DB.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verificationStatusName,
  isEnvironmentMismatch,
  describeAppleVerifyError,
  decodeJwsShape,
  runWithEnvFallback,
} from './appleVerifyStatus';

// Mimics @apple/app-store-server-library's VerificationException: an Error
// subclass constructed with NO message, carrying a numeric `status`.
class FakeVerificationException extends Error {
  constructor(public status: number) {
    super();
  }
}

function fakeJws(payload: object, header: object = { alg: 'ES256', x5c: [] }): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc(header)}.${enc(payload)}.c2lnbmF0dXJl`;
}

test('verificationStatusName maps all library statuses', () => {
  assert.equal(verificationStatusName(0), 'OK');
  assert.equal(verificationStatusName(1), 'VERIFICATION_FAILURE');
  assert.equal(verificationStatusName(2), 'INVALID_APP_IDENTIFIER');
  assert.equal(verificationStatusName(3), 'INVALID_ENVIRONMENT');
  assert.equal(verificationStatusName(4), 'INVALID_CHAIN_LENGTH');
  assert.equal(verificationStatusName(5), 'INVALID_CERTIFICATE');
  assert.equal(verificationStatusName(6), 'FAILURE');
});

test('verificationStatusName is explicit about unknown values', () => {
  assert.equal(verificationStatusName(99), 'UNKNOWN(99)');
  assert.equal(verificationStatusName(undefined), 'UNKNOWN(undefined)');
  assert.equal(verificationStatusName('3'), 'UNKNOWN(3)');
});

test('isEnvironmentMismatch matches only status 3', () => {
  assert.equal(isEnvironmentMismatch(new FakeVerificationException(3)), true);
  assert.equal(isEnvironmentMismatch({ status: 3 }), true);
  assert.equal(isEnvironmentMismatch(new FakeVerificationException(2)), false);
  assert.equal(isEnvironmentMismatch(new Error('boom')), false);
  assert.equal(isEnvironmentMismatch(null), false);
  assert.equal(isEnvironmentMismatch({ status: '3' }), false);
});

test('describeAppleVerifyError surfaces the status name for empty-message exceptions', () => {
  const d = describeAppleVerifyError(new FakeVerificationException(2));
  assert.equal(d.name, 'FakeVerificationException');
  assert.equal(d.message, ''); // the original sin — message alone says nothing
  assert.equal(d.status, 2);
  assert.equal(d.statusName, 'INVALID_APP_IDENTIFIER');
});

test('describeAppleVerifyError handles plain errors and junk', () => {
  const d = describeAppleVerifyError(new Error('plain'));
  assert.equal(d.message, 'plain');
  assert.equal(d.status, null);
  assert.equal(d.statusName, null);
  assert.equal(describeAppleVerifyError(null).name, 'Error');
});

test('decodeJwsShape identifies a transaction-shaped payload', () => {
  const shape = decodeJwsShape(
    fakeJws({
      transactionId: '2000001186342932',
      originalTransactionId: '2000001186342932',
      bundleId: 'ai.animationstation.app',
      productId: 'ai.animationstation.app.credits.10.free',
      environment: 'Sandbox',
      type: 'Consumable',
    }),
  );
  assert.ok(shape);
  assert.equal(shape.bundleId, 'ai.animationstation.app');
  assert.equal(shape.environment, 'Sandbox');
  assert.equal(shape.type, 'Consumable');
  assert.deepEqual(shape.fields, [
    'bundleId',
    'environment',
    'originalTransactionId',
    'productId',
    'transactionId',
    'type',
  ]);
});

test('decodeJwsShape identifies a notification envelope (the no-bundleId case behind status 2)', () => {
  const shape = decodeJwsShape(
    fakeJws({
      notificationType: 'ONE_TIME_CHARGE',
      notificationUUID: 'x',
      data: {},
      version: '2.0',
    }),
  );
  assert.ok(shape);
  assert.equal(shape.bundleId, undefined);
  assert.equal(shape.notificationType, 'ONE_TIME_CHARGE');
});

test('decodeJwsShape rejects non-JWS input without throwing', () => {
  assert.equal(decodeJwsShape('not-a-jws'), null);
  assert.equal(decodeJwsShape('a.b'), null);
  assert.equal(decodeJwsShape(`x.${Buffer.from('not json').toString('base64url')}.y`), null);
  assert.equal(decodeJwsShape(undefined as unknown as string), null);
});

test('runWithEnvFallback returns the primary result without touching the fallback', async () => {
  let fallbackCalls = 0;
  const out = await runWithEnvFallback(
    'Production',
    async () => 'primary',
    async () => {
      fallbackCalls += 1;
      return 'fallback';
    },
  );
  assert.deepEqual(out, { result: 'primary', environment: 'Production' });
  assert.equal(fallbackCalls, 0);
});

test('runWithEnvFallback retries the opposite environment ONLY on INVALID_ENVIRONMENT', async () => {
  let retried = false;
  const out = await runWithEnvFallback(
    'Production',
    async () => {
      throw new FakeVerificationException(3); // INVALID_ENVIRONMENT
    },
    async () => 'fallback',
    { onRetry: () => (retried = true) },
  );
  // A Production-configured box accepting a Sandbox payload — labeled Sandbox.
  assert.deepEqual(out, { result: 'fallback', environment: 'Sandbox' });
  assert.equal(retried, true);
});

test('runWithEnvFallback labels the fallback env correctly from a Sandbox primary', async () => {
  const out = await runWithEnvFallback(
    'Sandbox',
    async () => {
      throw new FakeVerificationException(3);
    },
    async () => 'fallback',
  );
  assert.deepEqual(out, { result: 'fallback', environment: 'Production' });
});

test('runWithEnvFallback does NOT retry non-environment errors (e.g. bad signature)', async () => {
  let fallbackCalls = 0;
  await assert.rejects(
    runWithEnvFallback(
      'Production',
      async () => {
        throw new FakeVerificationException(1); // VERIFICATION_FAILURE
      },
      async () => {
        fallbackCalls += 1;
        return 'fallback';
      },
    ),
    (err: unknown) => err instanceof FakeVerificationException && err.status === 1,
  );
  assert.equal(fallbackCalls, 0);
});

test('runWithEnvFallback rethrows the fallback error and fires onFallbackFailure', async () => {
  let failureSeen: unknown = null;
  await assert.rejects(
    runWithEnvFallback(
      'Production',
      async () => {
        throw new FakeVerificationException(3);
      },
      async () => {
        throw new Error('fallback boom');
      },
      { onFallbackFailure: (e) => (failureSeen = e) },
    ),
    (err: unknown) => err instanceof Error && err.message === 'fallback boom',
  );
  assert.ok(failureSeen instanceof Error);
});
