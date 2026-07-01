import { Queue, Worker } from 'bullmq';
import { connection } from './tryonQueue';
import prisma from '../lib/prisma';
import { deleteUserAndAssets } from '../services/accountDeletionService';
import { createChildLogger } from '../services/logger';
import { withCronMonitor } from '../utils/cronMonitor';

const log = createChildLogger('GuestCleanupWorker');

// Guest accounts (isGuest=true) that never convert are pruned after this many
// days. Generous enough that a returning user keeps their session, short enough
// that abandoned anonymous rows + their S3 photos don't accumulate forever.
const GUEST_RETENTION_DAYS = 30;

export const guestCleanupQueue = new Queue('guest-cleanup', { connection });

async function runGuestCleanup(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const staleGuests = await prisma.user.findMany({
    where: { isGuest: true, createdAt: { lt: cutoff } },
    select: { id: true },
  });

  let deleted = 0;
  for (const guest of staleGuests) {
    try {
      const result = await deleteUserAndAssets(guest.id);
      if (result) {
        deleted += 1;
        log.info('Stale guest deleted', {
          userId: guest.id,
          s3KeysQueued: result.s3KeysQueued,
          jobsScanned: result.jobsScanned,
        });
      }
    } catch (err) {
      log.error('Failed to delete stale guest', {
        userId: guest.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { deleted };
}

const worker = new Worker(
  'guest-cleanup',
  (job) =>
    withCronMonitor({ slug: 'guest-cleanup', crontab: '0 3 * * *' }, async () => {
      log.info('Starting stale-guest cleanup', {
        jobId: job.id,
        retentionDays: GUEST_RETENTION_DAYS,
      });
      const startTime = Date.now();
      const { deleted } = await runGuestCleanup();
      log.info('Stale-guest cleanup completed', {
        jobId: job.id,
        deleted,
        durationMs: Date.now() - startTime,
      });
      return { success: true, deleted };
    }),
  {
    connection,
    concurrency: 1,
  },
);

worker.on('failed', (job, err) => {
  log.error('Stale-guest cleanup job failed', { jobId: job?.id, error: err.message });
});

/**
 * Schedule the recurring stale-guest cleanup. Default: daily at 3:00 AM (offset
 * from the 2:00 AM vulnerability scan so the two don't contend).
 */
export async function scheduleGuestCleanup(): Promise<void> {
  try {
    const repeatableJobs = await guestCleanupQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await guestCleanupQueue.removeRepeatableByKey(job.key);
    }

    await guestCleanupQueue.add('daily-guest-cleanup', {}, { repeat: { pattern: '0 3 * * *' } });

    log.info('Stale-guest cleanup scheduled', { schedule: 'Daily at 3:00 AM' });
  } catch (error) {
    log.error('Failed to schedule stale-guest cleanup', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default worker;
