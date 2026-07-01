/**
 * Sentry Crons wrapper for the BullMQ scheduled jobs.
 *
 * `withCronMonitor` wraps a job processor in `Sentry.withMonitor`, which sends an
 * in_progress check-in when the run starts and an ok/error check-in when it
 * finishes. The monitor itself is upserted from the config below on first
 * check-in (no manual setup in the Sentry UI), and Sentry alerts when a run
 * errors or never happens at all — the one failure mode logs can't surface,
 * because a job that didn't run writes no log line.
 *
 * Check-ins are skipped (the job still runs) when:
 *   - Sentry is disabled (no DSN) — withMonitor would no-op anyway, or
 *   - environment is not production/development — a laptop's local backend is
 *     down most of the day, so its monitors would page "missed" constantly.
 *
 * Quota note: Sentry bills Crons per monitor beyond the plan's included count.
 * Four monitors × two server environments is well within the trial; revisit the
 * list here if the plan after the trial includes fewer.
 */
import * as Sentry from '@sentry/node';
import { sentryRuntime } from '../instrument';

const MONITORED_ENVIRONMENTS = new Set(['production', 'development']);

export interface CronSpec {
  /** Sentry monitor slug, e.g. 'guest-cleanup'. Stable — renaming forks the monitor. */
  slug: string;
  /** Crontab the job is scheduled with (must match the BullMQ repeat pattern). */
  crontab: string;
  /** Minutes a run may take before Sentry flags it as timed out. */
  maxRuntimeMinutes?: number;
  /** Minutes past the scheduled time before Sentry flags the run as missed. */
  checkinMarginMinutes?: number;
}

export function withCronMonitor<T>(spec: CronSpec, fn: () => Promise<T>): Promise<T> {
  if (!sentryRuntime.enabled || !MONITORED_ENVIRONMENTS.has(sentryRuntime.environment)) {
    return fn();
  }
  return Sentry.withMonitor(spec.slug, fn, {
    schedule: { type: 'crontab', value: spec.crontab },
    checkinMargin: spec.checkinMarginMinutes ?? 10,
    maxRuntime: spec.maxRuntimeMinutes ?? 30,
    // BullMQ cron patterns evaluate in the container's clock, which is UTC on
    // both Lightsail boxes — keep Sentry's missed-run math on the same clock.
    timezone: 'Etc/UTC',
  });
}
