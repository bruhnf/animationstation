import { Queue, Worker } from 'bullmq';
import { connection } from './tryonQueue';
import prisma from '../lib/prisma';
import { sendQueueHealthAlert } from '../services/emailService';
import { env } from '../config/env';
import { createChildLogger } from '../services/logger';
import { adminDashboardUrl } from '../utils/adminUrl';

const log = createChildLogger('QueueHealthMonitor');

// Proactively page on BullMQ trouble so a backed-up or failing queue is caught
// in minutes — not whenever someone happens to open the dashboard. Two signals:
//  - BACKLOG: waiting+active+delayed for a queue exceeds a threshold (jobs
//    arriving faster than they complete — Grok slow/down, a stalled worker, or a
//    real spike during the launch influx).
//  - FAILURES: the retained failed count exceeds a threshold (jobs erroring —
//    Grok errors, S3, etc.).
// Debounced via an AppSetting so a sustained problem doesn't spam the inbox.
const MONITORED_QUEUES = ['tryon', 'apple-notifications'];
const BACKLOG_THRESHOLD = Number(process.env.QUEUE_BACKLOG_THRESHOLD ?? 50);
const FAILED_THRESHOLD = Number(process.env.QUEUE_FAILED_THRESHOLD ?? 20);
const ALERT_COOLDOWN_MINUTES = Number(process.env.QUEUE_ALERT_COOLDOWN_MINUTES ?? 30);
const LAST_ALERT_KEY = 'queueHealthLastAlertAt';

export const queueHealthQueue = new Queue('queue-health-monitor', { connection });

// Read-only handles purely for counting (separate Queue instances on the same
// name share the connection and are fine for getJobCounts).
const monitored = MONITORED_QUEUES.map((name) => new Queue(name, { connection }));

async function runCheck(): Promise<void> {
  const snapshots = await Promise.all(
    monitored.map(async (q) => {
      const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
      const waiting = c.waiting ?? 0;
      const active = c.active ?? 0;
      const delayed = c.delayed ?? 0;
      const failed = c.failed ?? 0;
      return {
        name: q.name,
        waiting,
        active,
        delayed,
        failed,
        backlog: waiting + active + delayed,
      };
    }),
  );

  const reasons: string[] = [];
  for (const s of snapshots) {
    if (s.backlog >= BACKLOG_THRESHOLD)
      reasons.push(`${s.name}: backlog ${s.backlog} ≥ ${BACKLOG_THRESHOLD}`);
    if (s.failed >= FAILED_THRESHOLD)
      reasons.push(`${s.name}: failed ${s.failed} ≥ ${FAILED_THRESHOLD}`);
  }

  if (reasons.length === 0) {
    log.info('Queue health ok', { snapshots });
    return;
  }

  // Debounce: don't re-alert within the cooldown window.
  const last = await prisma.appSetting.findUnique({ where: { key: LAST_ALERT_KEY } });
  if (last) {
    const lastMs = Date.parse(last.value);
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < ALERT_COOLDOWN_MINUTES * 60 * 1000) {
      log.warn('Queue health thresholds crossed but within cooldown — skipping alert', { reasons });
      return;
    }
  }

  const adminUrl = adminDashboardUrl(env.appUrl);
  await Promise.allSettled(
    env.adminEmails.map((email) =>
      sendQueueHealthAlert(email, {
        reasons,
        queues: snapshots,
        backlogThreshold: BACKLOG_THRESHOLD,
        failedThreshold: FAILED_THRESHOLD,
        adminUrl,
      }),
    ),
  );

  await prisma.appSetting.upsert({
    where: { key: LAST_ALERT_KEY },
    create: { key: LAST_ALERT_KEY, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  log.warn('Queue health alert sent', { reasons, alertedEmails: env.adminEmails });
}

const worker = new Worker(
  'queue-health-monitor',
  async (job) => {
    log.info('Running queue health check', { jobId: job.id });
    await runCheck();
    return { ok: true };
  },
  { connection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
  log.error('Queue health monitor job failed', { jobId: job?.id, error: err.message });
});

/**
 * Schedule the recurring queue-health check. Every 5 minutes so a backlog or
 * failure spike during the launch influx is caught fast.
 */
export async function scheduleQueueHealthMonitor(): Promise<void> {
  try {
    const existing = await queueHealthQueue.getRepeatableJobs();
    for (const j of existing) {
      await queueHealthQueue.removeRepeatableByKey(j.key);
    }
    await queueHealthQueue.add('queue-health-check', {}, { repeat: { pattern: '*/5 * * * *' } });
    log.info('Queue health monitor scheduled', { schedule: 'Every 5 minutes' });
  } catch (error) {
    log.error('Failed to schedule queue health monitor', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default worker;
