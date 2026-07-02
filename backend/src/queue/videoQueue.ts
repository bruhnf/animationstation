import { Queue } from 'bullmq';
import { connection } from './transformQueue';

// AI Video (image-to-video) generation queue. Separate from the creation queue
// because video is a single async Grok call with polling (not the multi-
// perspective image pipeline), but it writes back to the SAME creations row
// (kind=VIDEO) so every downstream surface is shared.
export const videoQueue = new Queue('video', { connection });

export interface VideoJobData {
  jobId: string;
  userId: string;
  sourceImageKey: string; // S3 key of the image to animate (also the poster)
  // Optional second/transition image(s), passed to Grok as reference_images.
  referenceImageKeys?: string[];
  motionPrompt: string;
  creditCost: number; // credits charged at submit; refunded on terminal failure
}

export async function enqueueVideo(data: VideoJobData, delayMs = 0): Promise<void> {
  await videoQueue.add('process', data, {
    jobId: data.jobId,
    // Video gen is long + costly; a couple of attempts covers transient Grok/S3
    // blips without hammering a paid API on a hard failure.
    attempts: 2,
    backoff: { type: 'exponential', delay: 8000 },
    ...(delayMs > 0 ? { delay: delayMs } : {}),
    removeOnComplete: 100,
    // Age-based (see transformQueue): keep failed jobs ≤7 days / ≤50 most recent so
    // stale failures don't masquerade as recent in the admin Diagnostics panel.
    removeOnFail: { age: 7 * 24 * 3600, count: 50 },
  });
}
