// Pure decision logic for how the Apple webhook should treat a verified App
// Store Server Notification, extracted from routes/appleWebhook.ts so it can be
// unit-tested without importing the queue/Redis/crypto layers.
//
// Environment is deliberately NOT a rejection reason. Apple signs TestFlight and
// App-Review notifications with the SANDBOX environment even when the app build
// talks to the production backend, while real customers produce PRODUCTION
// notifications. The verifier (verifyAndDecodeNotification) already accepts BOTH
// environments via its env-fallback, user resolution is by appAccountToken, and
// every downstream grant/claw-back is idempotent by transactionId — so a
// notification from the environment the box is NOT configured for is PROCESSED,
// not dropped. Dropping it (the previous behavior) meant a prod box silently
// discarded every Sandbox refund claw-back and missed-consumable grant, leaving
// the on-device verify-receipt as the only reconciliation path. We still surface
// the mismatch in logs for visibility.
//
// The only hard reject is a missing notificationUUID: without it we can't
// dedupe/track the notification, so it's malformed.

export interface AppleNotificationDecision {
  // true → respond 400 and do NOT enqueue (malformed).
  reject: boolean;
  rejectReason?: string;
  // true → the notification is from the environment this box is not configured
  // for. Informational only: log it, but still process.
  environmentMismatch: boolean;
}

export function classifyAppleNotification(
  input: { notificationUUID?: string | null; environment?: string | null },
  configuredEnvironment: string,
): AppleNotificationDecision {
  const environmentMismatch = !!input.environment && input.environment !== configuredEnvironment;

  if (!input.notificationUUID) {
    return { reject: true, rejectReason: 'missing notificationUUID', environmentMismatch };
  }

  return { reject: false, environmentMismatch };
}
