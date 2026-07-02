import { Worker, UnrecoverableError } from 'bullmq';
import * as Sentry from '@sentry/node';
import { v4 as uuidv4 } from 'uuid';
import { connection } from './transformQueue';
import { VideoJobData } from './videoQueue';
import { generateVideo, downloadVideo, ContentModeratedError } from '../services/grokService';
import { uploadToS3 } from '../services/s3Service';
import { recordModerationStrike } from '../services/moderationService';
import {
  isWithinModerationGrace,
  moderationWarningMessage,
  MODERATION_USER_MESSAGE,
} from '../utils/moderationGrace';
import { sendGenerationFailureAlert } from '../services/emailService';
import { adminDashboardUrl } from '../utils/adminUrl';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { createChildLogger, logJob, logUpload } from '../services/logger';

const log = createChildLogger('VideoWorker');

// Same sentinel pattern as transformWorker: a moderation block is re-raised as an
// UnrecoverableError carrying this message so the `failed` handler applies the
// strike/grace policy and BullMQ won't retry a policy rejection.
const MODERATION_ERROR = 'CONTENT_MODERATED';

function alertAdminsOfVideoFailure(data: {
  jobId: string;
  userId?: string | null;
  kind: 'moderated' | 'error';
  detail: string;
  attempts?: number;
  refunded?: boolean;
}): void {
  if (env.adminEmails.length === 0) return;
  const adminUrl = adminDashboardUrl(env.appUrl);
  void Promise.allSettled(
    // Reuse the creation failure email shape — same fields, just a video job.
    env.adminEmails.map((email) => sendGenerationFailureAlert(email, { ...data, adminUrl })),
  );
}

const worker = new Worker<VideoJobData>(
  'video',
  async (job) => {
    const {
      jobId,
      userId,
      sourceImageKey,
      referenceImageKeys,
      motionPrompt,
      durationSec,
      aspectRatio,
    } = job.data;
    const startTime = Date.now();

    logJob('started', { jobId, jobType: 'video', userId, attempt: job.attemptsMade + 1 });

    await prisma.creation.update({ where: { id: jobId }, data: { status: 'PROCESSING' } });

    // Skip-on-retry: if a prior attempt already produced the video, don't re-pay.
    const existing = await prisma.creation.findUnique({
      where: { id: jobId },
      select: { videoUrl: true },
    });
    if (existing?.videoUrl) {
      log.info('Video already generated on a prior attempt — completing', { jobId });
    } else {
      let resultUrl: string;
      try {
        resultUrl = await generateVideo(sourceImageKey, motionPrompt, {
          referenceImageRefs: referenceImageKeys,
          durationSec: durationSec ?? undefined,
          aspectRatio: aspectRatio ?? undefined,
        });
      } catch (genErr) {
        if (genErr instanceof ContentModeratedError) {
          log.warn('Video blocked by content moderation', {
            jobId,
            userId,
            reason: genErr.message,
          });
          throw new UnrecoverableError(MODERATION_ERROR);
        }
        throw genErr; // transient → BullMQ retries; final failure refunds below
      }

      const buffer = await downloadVideo(resultUrl);
      const key = await uploadToS3('videos', userId, `${uuidv4()}.mp4`, buffer, 'video/mp4');
      logUpload('completed', {
        userId,
        fileType: 'video-result',
        s3Key: key,
        fileSize: buffer.length,
        success: true,
      });

      await prisma.creation.update({ where: { id: jobId }, data: { videoUrl: key } });
    }

    await prisma.$transaction([
      prisma.creation.update({
        where: { id: jobId },
        data: { status: 'COMPLETE', perspectivesUsed: ['video'] },
      }),
      prisma.user.update({ where: { id: userId }, data: { creationCount: { increment: 1 } } }),
    ]);

    logJob('completed', { jobId, jobType: 'video', userId, durationMs: Date.now() - startTime });
  },
  {
    connection,
    concurrency: 2,
    // The processor polls Grok for up to ~6 min per attempt. BullMQ auto-renews
    // the lock while the (single) worker process is alive, but set a generous
    // lockDuration as defense-in-depth so a stalled lock can't let a SECOND
    // worker node (future horizontal scaling) pick up the same job and double-
    // run a paid Grok video generation. Covers the full poll window + margin.
    lockDuration: 7 * 60 * 1000,
  },
);

worker.on('failed', async (job, err) => {
  const isModerated = err?.message === MODERATION_ERROR;
  const attemptsMade = job?.attemptsMade ?? 0;
  const maxAttempts = (job?.opts?.attempts as number | undefined) ?? 1;
  const isTerminal = isModerated || attemptsMade >= maxAttempts;

  logJob('failed', {
    jobId: job?.data?.jobId || job?.id || 'unknown',
    jobType: 'video',
    userId: job?.data?.userId,
    attempt: attemptsMade,
    maxAttempts,
    isTerminal,
    error: isModerated ? 'content_moderated' : err.message,
  });

  if (isTerminal && !isModerated) {
    Sentry.captureException(err, {
      tags: { service: 'queue', queue: 'video' },
      extra: { jobId: job?.data?.jobId, userId: job?.data?.userId, attemptsMade, maxAttempts },
    });
  }
  if (!isTerminal) return;

  const jobId = job?.data?.jobId;
  const userId = job?.data?.userId;
  if (!jobId) return;

  let errorMessage: string;
  let refunded = false;

  if (isModerated) {
    const strikeCount = userId ? await recordModerationStrike(userId, jobId) : null;
    const withinGrace = isWithinModerationGrace(strikeCount);
    if (withinGrace && strikeCount !== null && userId) {
      refunded = await refundVideoCredit(jobId, userId);
      errorMessage = moderationWarningMessage(strikeCount);
    } else {
      errorMessage = MODERATION_USER_MESSAGE;
    }
  } else {
    errorMessage = err.message?.substring(0, 500) || 'Unknown error';
  }

  try {
    await prisma.creation.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorMessage },
    });
  } catch (dbErr) {
    log.error('Failed to update video job status', { jobId, error: (dbErr as Error).message });
  }

  if (!isModerated && userId) {
    refunded = await refundVideoCredit(jobId, userId);
  }

  alertAdminsOfVideoFailure({
    jobId,
    userId,
    kind: isModerated ? 'moderated' : 'error',
    detail: errorMessage,
    attempts: attemptsMade,
    refunded,
  });
});

// Refund the credits a video job deducted at submit. videoController tags the
// USAGE transaction with `(video=<jobId>)` and the refund mirrors its amount
// (videos cost more than 1, and the admin cost is tunable, so we read the actual
// charged amount rather than hardcoding). Idempotent + FOR UPDATE-locked, same
// as the creation refund.
async function refundVideoCredit(jobId: string, userId: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

      const usage = await tx.creditTransaction.findFirst({
        where: { userId, type: 'USAGE', description: { contains: `video=${jobId}` } },
      });
      if (!usage) return false; // covered by a weekly allowance / nothing charged

      const existingRefund = await tx.creditTransaction.findFirst({
        where: { userId, type: 'REFUND', description: { contains: `video=${jobId}` } },
      });
      if (existingRefund) return false;

      const amount = Math.abs(usage.amount); // USAGE was stored negative
      await tx.user.update({ where: { id: userId }, data: { credits: { increment: amount } } });
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'REFUND',
          amount,
          description: `Refund: video failed (video=${jobId})`,
        },
      });
      log.info('Refunded credits for terminally failed video', { jobId, userId, amount });
      return true;
    });
  } catch (refundErr) {
    log.error('Failed to refund credits for failed video', {
      jobId,
      userId,
      error: (refundErr as Error).message,
    });
    return false;
  }
}

export default worker;
