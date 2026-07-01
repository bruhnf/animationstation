/**
 * Sentry instrumentation — MUST be imported first, before Express / http / any
 * other module, so the SDK's auto-instrumentation can patch them at require time.
 * `index.ts` does `import './instrument';` as its very first line.
 *
 * The whole integration is GATED on `SENTRY_DSN`. When the var is absent (local
 * dev, or any box where Sentry isn't wired up yet) `Sentry.init` is never called,
 * so every `Sentry.captureException(...)` / `setupExpressErrorHandler(...)` call
 * elsewhere is a cheap no-op. Turning Sentry on is purely a matter of setting
 * `SENTRY_DSN` in that environment's `.env` — no code change, no redeploy logic.
 *
 * Privacy: this app handles emails, photos, and auth tokens. `sendDefaultPii` is
 * left false and a `beforeSend` hook strips auth headers, cookies, the admin key,
 * the user's email/IP, and any obviously-sensitive request-body fields before an
 * event leaves the process. Keep that scrubber in sync with what we consider PII.
 */
import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { scrubSentryEvent } from './utils/scrub';

const dsn = process.env.SENTRY_DSN?.trim() || undefined;

// Sentry "environment" tag. NODE_ENV is `production` on BOTH the prod and dev
// Lightsail boxes, so it can't distinguish them — the real tell is the dev API
// domain (mirrors the dev/prod logic in config/env.ts). An explicit
// SENTRY_ENVIRONMENT always wins.
function deriveEnvironment(): string {
  if (process.env.SENTRY_ENVIRONMENT?.trim()) return process.env.SENTRY_ENVIRONMENT.trim();
  if (process.env.APP_URL?.includes('api-dev')) return 'development';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

// Release tag groups issues by deploy. Prefer an explicit SENTRY_RELEASE (e.g. a
// git SHA passed at deploy time); fall back to the backend package version.
function deriveRelease(): string | undefined {
  if (process.env.SENTRY_RELEASE?.trim()) return process.env.SENTRY_RELEASE.trim();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ? `tryon-backend@${pkg.version}` : undefined;
  } catch {
    return undefined;
  }
}

const sentryEnvironment = deriveEnvironment();
const sentryRelease = deriveRelease();
// Performance tracing is OFF by default (0) — error monitoring is the goal and
// transaction volume burns the free-tier quota fast. Opt in per box via
// SENTRY_TRACES_SAMPLE_RATE (e.g. 0.1 to sample 10% of requests).
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0') || 0;

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment,
    release: sentryRelease,
    tracesSampleRate,
    // Never auto-attach IP / cookies / user; the scrubber is a second line.
    sendDefaultPii: false,
    // Last gate before an event leaves the process — strips secrets/PII.
    beforeSend: (event) => scrubSentryEvent(event),
    // Tagged on every event so an operator can tell which service produced it.
    initialScope: { tags: { component: 'backend' } },
  });

  console.log(
    `[sentry] initialized (environment=${sentryEnvironment}` +
      `${sentryRelease ? `, release=${sentryRelease}` : ''}, traces=${tracesSampleRate})`,
  );
} else {
  console.log('[sentry] SENTRY_DSN not set — error reporting disabled (no-op).');
}

// Strip the public key from the DSN so we can show "where events go" on the admin
// dashboard without exposing the ingest key. DSN form: https://<key>@<host>/<projId>.
function safeDsnHost(rawDsn: string): string | null {
  try {
    const u = new URL(rawDsn);
    return `${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Read-only snapshot of how Sentry is configured in this process. Surfaced by the
 * admin diagnostics endpoint. Contains NO secrets (DSN public key is stripped).
 */
export const sentryRuntime = {
  enabled: Boolean(dsn),
  environment: sentryEnvironment,
  release: sentryRelease ?? null,
  tracesSampleRate,
  dsnHost: dsn ? safeDsnHost(dsn) : null,
};
