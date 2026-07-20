import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAppleNotification } from './appleNotificationPolicy';

test('matching environment is processed', () => {
  const d = classifyAppleNotification(
    { notificationUUID: 'uuid-1', environment: 'Production' },
    'Production',
  );
  assert.equal(d.reject, false);
  assert.equal(d.environmentMismatch, false);
});

test('OPPOSITE environment is processed, not dropped (the fix)', () => {
  // A Sandbox notification (TestFlight / App Review) reaching a Production box
  // must still be enqueued — dropping it was the bug this guards against.
  const d = classifyAppleNotification(
    { notificationUUID: 'uuid-2', environment: 'Sandbox' },
    'Production',
  );
  assert.equal(d.reject, false, 'must not reject on environment alone');
  assert.equal(d.environmentMismatch, true, 'mismatch is flagged for logging');
});

test('Production notification on a Sandbox box is also processed', () => {
  const d = classifyAppleNotification(
    { notificationUUID: 'uuid-3', environment: 'Production' },
    'Sandbox',
  );
  assert.equal(d.reject, false);
  assert.equal(d.environmentMismatch, true);
});

test('missing notificationUUID is rejected as malformed', () => {
  const d = classifyAppleNotification({ environment: 'Production' }, 'Production');
  assert.equal(d.reject, true);
  assert.equal(d.rejectReason, 'missing notificationUUID');
});

test('missing notificationUUID rejects even when the environment matches', () => {
  const d = classifyAppleNotification({}, 'Sandbox');
  assert.equal(d.reject, true);
});

test('absent environment field is not treated as a mismatch', () => {
  // Some notification shapes (e.g. TEST) may omit data.environment; that is not
  // a mismatch and must not be flagged as one.
  const d = classifyAppleNotification({ notificationUUID: 'uuid-4' }, 'Production');
  assert.equal(d.reject, false);
  assert.equal(d.environmentMismatch, false);
});
