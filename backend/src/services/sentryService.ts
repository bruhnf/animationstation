/**
 * Sentry dashboard integration helpers.
 *
 * `instrument.ts` owns SDK *initialization* (and must load first). This module is
 * the read/query side used by the admin dashboard:
 *   - `getSentryStatus()`  — is Sentry on, what environment/release, is the issues
 *                            API wired up. No secrets.
 *   - `fetchRecentIssues()`— pulls the latest unresolved issues from Sentry's REST
 *                            API (optional; needs an auth token + org/project slug).
 *   - `sendTestEvent()`    — fires a synthetic error so an operator can confirm the
 *                            pipe end-to-end from the dashboard.
 *
 * Everything degrades gracefully: with no DSN, status reports disabled and the
 * other calls throw a typed "not configured" error the route maps to HTTP 503.
 */
import * as Sentry from '@sentry/node';
import { sentryRuntime } from '../instrument';
import { createChildLogger } from './logger';

const log = createChildLogger('SentryService');

export class SentryNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SentryNotConfiguredError';
  }
}

export interface SentryStatus {
  enabled: boolean;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
  dsnHost: string | null;
  // Whether the REST-API credentials needed for the "recent issues" panel exist.
  issuesApiConfigured: boolean;
  // Deep link to the project in the Sentry UI, when org/project are known.
  projectUrl: string | null;
}

interface SentryApiConfig {
  authToken: string;
  org: string;
  project: string;
  apiBase: string;
}

function readApiConfig(): SentryApiConfig | null {
  const authToken = process.env.SENTRY_AUTH_TOKEN?.trim();
  const org = process.env.SENTRY_ORG_SLUG?.trim();
  const project = process.env.SENTRY_PROJECT_SLUG?.trim();
  if (!authToken || !org || !project) return null;
  // Self-hosted Sentry can override the base; default to SaaS.
  const apiBase = (process.env.SENTRY_API_BASE?.trim() || 'https://sentry.io').replace(/\/+$/, '');
  return { authToken, org, project, apiBase };
}

export function getSentryStatus(): SentryStatus {
  const api = readApiConfig();
  return {
    enabled: sentryRuntime.enabled,
    environment: sentryRuntime.environment,
    release: sentryRuntime.release,
    tracesSampleRate: sentryRuntime.tracesSampleRate,
    dsnHost: sentryRuntime.dsnHost,
    issuesApiConfigured: Boolean(api),
    // Deep link pre-filtered to this box's environment so "Open in Sentry" lands
    // on the same slice of data the panel below shows.
    projectUrl: api
      ? `${api.apiBase}/organizations/${api.org}/projects/${api.project}/?environment=${encodeURIComponent(sentryRuntime.environment)}`
      : null,
  };
}

export interface SentryIssue {
  id: string;
  shortId: string | null;
  title: string;
  culprit: string | null;
  level: string | null;
  status: string | null;
  count: string | number | null;
  userCount: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  permalink: string | null;
}

/**
 * Fetch the most recent unresolved issues for this project, scoped to THIS box's
 * Sentry environment (prod box sees production issues, dev box sees development)
 * so the two admin dashboards don't show each other's errors. Read-only.
 * Throws SentryNotConfiguredError when the REST-API env vars are missing.
 */
export async function fetchRecentIssues(limit = 10): Promise<SentryIssue[]> {
  const api = readApiConfig();
  if (!api) {
    throw new SentryNotConfiguredError(
      'Sentry issues API not configured. Set SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, and SENTRY_PROJECT_SLUG.',
    );
  }

  const url =
    `${api.apiBase}/api/0/projects/${encodeURIComponent(api.org)}/${encodeURIComponent(api.project)}/issues/` +
    `?query=${encodeURIComponent('is:unresolved')}&statsPeriod=14d&limit=${Math.min(Math.max(1, limit), 25)}` +
    `&environment=${encodeURIComponent(sentryRuntime.environment)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${api.authToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sentry API ${res.status}: ${body.slice(0, 200)}`);
    }
    const issues = (await res.json()) as Array<Record<string, unknown>>;
    return issues.map((i) => ({
      id: String(i.id ?? ''),
      shortId: (i.shortId as string) ?? null,
      title: (i.title as string) ?? '(untitled)',
      culprit: (i.culprit as string) ?? null,
      level: (i.level as string) ?? null,
      status: (i.status as string) ?? null,
      count: (i.count as string | number) ?? null,
      userCount: (i.userCount as number) ?? null,
      firstSeen: (i.firstSeen as string) ?? null,
      lastSeen: (i.lastSeen as string) ?? null,
      permalink: (i.permalink as string) ?? null,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fire a synthetic error into Sentry so an operator can confirm delivery from the
 * dashboard. Flushes (up to 3s) so the HTTP response reflects whether it was sent.
 * Throws SentryNotConfiguredError when Sentry isn't initialized (no DSN).
 */
export async function sendTestEvent(
  note?: string,
): Promise<{ eventId: string | undefined; flushed: boolean }> {
  if (!sentryRuntime.enabled) {
    throw new SentryNotConfiguredError(
      'Sentry is disabled (SENTRY_DSN not set) — nothing to test.',
    );
  }
  const eventId = Sentry.captureException(
    new Error(`[admin test] Sentry verification event${note ? `: ${note}` : ''}`),
    { tags: { test_event: 'true' }, level: 'info' },
  );
  const flushed = await Sentry.flush(3000).catch(() => false);
  log.info('Admin Sentry test event dispatched', { eventId, flushed });
  return { eventId, flushed };
}
