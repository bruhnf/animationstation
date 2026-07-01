/**
 * PII / secret scrubbing for Sentry events.
 *
 * Extracted as a pure, side-effect-free module so it can be unit-tested without
 * loading the Sentry SDK, Prisma, or Redis. `instrument.ts` wires `scrubSentryEvent`
 * in as Sentry's `beforeSend` hook — the last gate before an event leaves the
 * process. This app handles emails, photos, auth tokens, and Apple receipts, so
 * getting this right is a privacy requirement, not a nicety.
 *
 * The `import type` below is erased at compile time — no Sentry runtime is pulled
 * in, which keeps the unit test fast and dependency-free.
 */
import type { ErrorEvent } from '@sentry/node';

// Any object key matching this is redacted. Mirrors and extends the logger's
// SENSITIVE_FIELDS list. Add new sensitive field-name fragments here.
// NOTE: `admin` is included specifically so the `x-admin-key` header — this app's
// most powerful credential — is redacted; `api[-_]?key` alone does NOT match it.
export const SENSITIVE_KEY =
  /pass|token|secret|admin|api[-_]?key|authorization|cookie|refresh|jws|receipt|otp|code/i;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/**
 * Deep-clone `input`, redacting any value whose key matches SENSITIVE_KEY.
 * Non-objects pass through untouched. Bounded depth so a cyclic/huge payload
 * can't blow the stack.
 */
export function scrubObject(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || input == null) return input;
  if (Array.isArray(input)) return input.map((v) => scrubObject(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubObject(v, depth + 1);
    }
    return out;
  }
  return input;
}

/**
 * Strip secrets/PII from a Sentry event in place: sensitive request headers, all
 * cookies, sensitive request-body fields, and directly-identifying user fields
 * (email / IP / username — `user.id` is kept for correlation).
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    if (event.request.headers) {
      const headers = event.request.headers as Record<string, unknown>;
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_KEY.test(key)) delete headers[key];
      }
    }
    delete event.request.cookies;
    if (event.request.data && typeof event.request.data === 'object') {
      event.request.data = scrubObject(event.request.data) as Record<string, unknown>;
    }
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  return event;
}
