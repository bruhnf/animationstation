import { Queue } from 'bullmq';
import { connection } from './tryonQueue';

export interface AppleNotificationJobData {
  // Raw signedPayload from Apple. The worker re-verifies before processing.
  signedPayload: string;
  // notificationUUID extracted at the webhook layer for idempotency / dedupe.
  notificationUUID: string;
  // Receipt timestamp from the decoded payload, for ordering.
  signedDate: number;
}

export const appleNotificationQueue = new Queue<AppleNotificationJobData>('apple-notifications', {
  connection,
});

export async function enqueueAppleNotification(data: AppleNotificationJobData): Promise<void> {
  await appleNotificationQueue.add('process', data, {
    // Use notificationUUID as the BullMQ jobId so duplicate deliveries from Apple
    // (which retries on non-2xx) collapse into a single processed job.
    jobId: data.notificationUUID,
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 500,
    removeOnFail: 200,
  });
}
