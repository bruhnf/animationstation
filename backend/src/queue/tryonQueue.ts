import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

export const connection = new IORedis(env.redis.url, { maxRetriesPerRequest: null });

export const tryonQueue = new Queue('tryon', { connection });

export interface TryOnJobData {
  jobId: string;
  userId: string;
  // The reference image(s) the user is transforming (S3 keys). At least one.
  clothingUrls: string[];
  // Free-form prompt describing the requested transform. Carried from the job
  // row into the worker and forwarded to generateTryOnImage. Optional — a blank
  // prompt falls back to a neutral enhance/combine instruction.
  promptText?: string | null;
}

export async function enqueueTryOn(data: TryOnJobData, delayMs = 0): Promise<void> {
  await tryonQueue.add('process', data, {
    jobId: data.jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    // BullMQ defers the job by this many ms before the first attempt. The
    // delay only applies to the initial run; retries still use the backoff
    // policy above.
    ...(delayMs > 0 ? { delay: delayMs } : {}),
    removeOnComplete: 100,
    // Age-based so a failed job can't linger for weeks and surface as a "recent"
    // failure in the admin Diagnostics panel (a count-only cap kept month-old
    // rows alive when failure volume was low). Keep ≤7 days, ≤50 most recent.
    removeOnFail: { age: 7 * 24 * 3600, count: 50 },
  });
}
