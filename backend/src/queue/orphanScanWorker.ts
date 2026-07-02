import { Queue, Worker } from 'bullmq';
import { connection } from './transformQueue';
import { scanS3Orphans } from '../routes/admin';
import { sendS3OrphanAlert } from '../services/emailService';
import { env } from '../config/env';
import { createChildLogger } from '../services/logger';
import { adminDashboardUrl } from '../utils/adminUrl';
import { withCronMonitor } from '../utils/cronMonitor';

const log = createChildLogger('OrphanScanWorker');

export const orphanScanQueue = new Queue('orphan-scan', { connection });

const worker = new Worker(
  'orphan-scan',
  (job) =>
    withCronMonitor(
      // Full key-level S3↔DB reconciliation — allow a long run on big buckets.
      { slug: 's3-orphan-scan', crontab: '0 3 * * 0', maxRuntimeMinutes: 60 },
      async () => {
        log.info('Starting S3 orphan scan', { jobId: job.id });
        const result = await scanS3Orphans();

        log.info('S3 orphan scan complete', {
          totalS3Objects: result.totalS3Objects,
          orphanedObjects: result.orphanedObjects,
          affectedUsers: result.orphansByUser.length,
        });

        if (result.orphanedObjects === 0) return { orphanedObjects: 0 };

        // Email every admin about the orphans found.
        const adminUrl = adminDashboardUrl(env.appUrl);
        const affectedUserIds = result.orphansByUser.map((e) => e.userId);
        await Promise.allSettled(
          env.adminEmails.map((email) =>
            sendS3OrphanAlert(email, result.orphanedObjects, affectedUserIds, adminUrl),
          ),
        );

        log.warn('S3 orphans found — admin alert sent', {
          orphanedObjects: result.orphanedObjects,
          affectedUsers: affectedUserIds.length,
          alertedEmails: env.adminEmails,
        });

        return { orphanedObjects: result.orphanedObjects };
      },
    ),
  { connection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
  log.error('Orphan scan job failed', { jobId: job?.id, error: err.message });
});

export async function scheduleOrphanScans(): Promise<void> {
  const existing = await orphanScanQueue.getRepeatableJobs();
  for (const job of existing) {
    await orphanScanQueue.removeRepeatableByKey(job.key);
  }
  // Weekly on Sunday at 3:00 AM — after the nightly Postgres dump (2:00 AM)
  // and the vulnerability scan (2:00 AM daily) have had time to finish.
  await orphanScanQueue.add(
    'weekly-orphan-scan',
    {},
    {
      repeat: { pattern: '0 3 * * 0' },
    },
  );
  log.info('S3 orphan scan scheduled', { schedule: 'Weekly Sunday at 3:00 AM' });
}

export default worker;
