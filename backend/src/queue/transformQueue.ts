import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

export const connection = new IORedis(env.redis.url, { maxRetriesPerRequest: null });

export const transformQueue = new Queue('transform', { connection });

export interface CreationData {
  jobId: string;
  userId: string;
  // The reference image(s) the user is transforming (S3 keys). EMPTY for a
  // pure text-to-image generation (promptText is then required — enforced at
  // submit); one or two keys for a transform/compose.
  clothingUrls: string[];
  // Free-form prompt describing the requested generation/transform. Required
  // when clothingUrls is empty; optional otherwise (a blank prompt falls back
  // to a neutral enhance/combine instruction).
  promptText?: string | null;
  // User-chosen output aspect ratio ('2:3' | '3:2' | '1:1' | '9:16' | '16:9'),
  // validated at submit. Null → model default.
  aspectRatio?: string | null;
}

export async function enqueueTransform(data: CreationData, delayMs = 0): Promise<void> {
  await transformQueue.add('process', data, {
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
