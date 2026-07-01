// Helpers for diagnosing @apple/app-store-server-library verification
// failures. Pure module (no library import) so unit tests run without it.
//
// Background (Jim Morris incident, 2026-06-11): the library's
// VerificationException carries an EMPTY message — the real reason lives in a
// numeric `status` property. Logging `err.message` produced `error: ""` and a
// purchase failure that was undiagnosable from logs. These helpers translate
// the status and expose a safe, PII-free summary of what a client actually
// posted, so the next failure names itself.

// Numeric values match VerificationStatus in @apple/app-store-server-library
// 1.6.0 (dist/jws_verification.js). If the library is upgraded, re-check the
// enum — the order changed in past releases.
export const VERIFICATION_STATUS_NAMES: Record<number, string> = {
  0: 'OK',
  1: 'VERIFICATION_FAILURE',
  2: 'INVALID_APP_IDENTIFIER',
  3: 'INVALID_ENVIRONMENT',
  4: 'INVALID_CHAIN_LENGTH',
  5: 'INVALID_CERTIFICATE',
  6: 'FAILURE',
};

export function verificationStatusName(status: unknown): string {
  if (typeof status === 'number' && status in VERIFICATION_STATUS_NAMES) {
    return VERIFICATION_STATUS_NAMES[status];
  }
  return `UNKNOWN(${String(status)})`;
}

/** True when err looks like a VerificationException for INVALID_ENVIRONMENT —
 * the signal that a receipt is valid but from the OTHER Apple environment
 * (e.g. a TestFlight/sandbox receipt posted to a Production-configured box).
 * Callers use this to retry verification against the opposite environment. */
export function isEnvironmentMismatch(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'status' in err &&
    (err as { status?: unknown }).status === 3
  );
}

/** Loggable summary of any Apple verification error. Never throws. */
export function describeAppleVerifyError(err: unknown): {
  name: string;
  message: string;
  status: number | null;
  statusName: string | null;
} {
  const e = err as { constructor?: { name?: string }; message?: unknown; status?: unknown } | null;
  const status = e && typeof e.status === 'number' ? e.status : null;
  return {
    name: (e && e.constructor && e.constructor.name) || 'Error',
    message: e && typeof e.message === 'string' ? e.message : String(err ?? ''),
    status,
    statusName: status === null ? null : verificationStatusName(status),
  };
}

/**
 * UNVERIFIED decode of a JWS payload for diagnostics only — never trust the
 * result for any decision. Returns the payload's field names plus the few
 * non-PII fields that identify WHAT kind of Apple blob a client posted
 * (transaction vs notification envelope vs renewal info, and from which
 * environment). Returns null when the input isn't JWS-shaped.
 */
export function decodeJwsShape(jws: string): {
  fields: string[];
  bundleId?: string;
  environment?: string;
  productId?: string;
  transactionId?: string;
  type?: string;
  notificationType?: string;
} | null {
  if (typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (!payload || typeof payload !== 'object') return null;
    const pick = (k: string): string | undefined =>
      typeof payload[k] === 'string' ? (payload[k] as string) : undefined;
    return {
      fields: Object.keys(payload).sort(),
      bundleId: pick('bundleId'),
      environment: pick('environment'),
      productId: pick('productId'),
      transactionId: pick('transactionId'),
      type: pick('type'),
      notificationType: pick('notificationType'),
    };
  } catch {
    return null;
  }
}
