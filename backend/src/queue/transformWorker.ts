import { Worker, UnrecoverableError } from 'bullmq';
import * as Sentry from '@sentry/node';
import { connection, CreationData } from './transformQueue';
import { recordModerationStrike } from '../services/moderationService';
import {
  generateTransformImage,
  downloadGeneratedImage,
  ContentModeratedError,
} from '../services/grokService';
import { uploadToS3 } from '../services/s3Service';
import { sendGenerationFailureAlert } from '../services/emailService';
import { env } from '../config/env';
import { adminDashboardUrl } from '../utils/adminUrl';
import {
  classifyOutcomes,
  isWithinModerationGrace,
  moderationWarningMessage,
  MODERATION_USER_MESSAGE,
  PARTIAL_TRANSIENT_USER_NOTE,
  PARTIAL_MODERATION_USER_NOTE,
  PerspectiveOutcome,
} from '../utils/moderationGrace';
import prisma from '../lib/prisma';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger, logJob, logUpload } from '../services/logger';

const log = createChildLogger('TransformWorker');

// Sentinel carried by the UnrecoverableError thrown when EVERY perspective is
// blocked by content moderation, so the `failed` handler can recognize it and
// apply the moderation-specific refund/strike handling. A PARTIAL block (some
// perspectives blocked, at least one succeeded) does NOT fail the job — it
// completes with the surviving results and never reaches this path.
// Decision logic (grace window, outcome classification, user messages) lives
// in utils/moderationGrace.ts so it can be unit-tested without this module's
// Redis connection.
const MODERATION_ERROR = 'CONTENT_MODERATED';

// Email the admin allowlist about a generation failure. Fire-and-forget; never
// throws. Email-only for now (SMS alerting awaits toll-free registration).
function alertAdminsOfGenerationFailure(data: {
  jobId: string;
  userId?: string | null;
  kind: 'moderated' | 'partial_moderation' | 'partial_error' | 'error';
  detail: string;
  attempts?: number;
  refunded?: boolean;
}): void {
  if (env.adminEmails.length === 0) return;
  const adminUrl = adminDashboardUrl(env.appUrl);
  void Promise.allSettled(
    env.adminEmails.map((email) => sendGenerationFailureAlert(email, { ...data, adminUrl })),
  ).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      log.error('Some creation failure alert emails failed to send', { jobId: data.jobId, failed });
    } else {
      log.info('Creation failure alert emailed to admins', { jobId: data.jobId, kind: data.kind });
    }
  });
}

// Image download lives in grokService.downloadGeneratedImage (shared with the
// Outfit Designer's closet generation; also handles data: URIs).

const worker = new Worker<CreationData>(
  'transform',
  async (job) => {
    const { jobId, userId, clothingUrls, promptText } = job.data;
    const startTime = Date.now();

    // AnimationStation is free-form: one generation per submission (there are no
    // per-body-photo perspectives). A single 'full_body' unit keeps the result
    // in resultImageUrl — what the feed / grid / detail read — and lets the
    // existing moderation / refund / skip-on-retry machinery below run unchanged
    // (classifyOutcomes maps a lone outcome cleanly: ok→clean, moderated→
    // all_blocked, failed→all_failed).
    const genUnits: Array<{ perspective: 'full_body' | 'medium' }> = [{ perspective: 'full_body' }];

    logJob('started', {
      jobId,
      jobType: 'transform',
      userId,
      attempt: job.attemptsMade + 1,
      clothingCount: clothingUrls.length,
      perspectives: genUnits.map((p) => p.perspective),
    });

    await prisma.creation.update({
      where: { id: jobId },
      data: { status: 'PROCESSING' },
    });

    // Skip-on-retry: read any result keys a prior attempt already produced and
    // persisted (below), so a retry of a partially-failed multi-perspective job
    // doesn't re-pay Grok for a perspective that already succeeded.
    const existing = await prisma.creation.findUnique({
      where: { id: jobId },
      select: { resultImageUrl: true, resultImage2Url: true },
    });
    const existingKeyFor = (p: 'full_body' | 'medium'): string | null =>
      (p === 'full_body' ? existing?.resultImageUrl : existing?.resultImage2Url) ?? null;

    // Whether this BullMQ attempt is the last one — earlier attempts rethrow
    // transient errors so the job retries; the final attempt absorbs them so
    // the job can still complete with whatever perspectives survived.
    const isFinalAttempt = job.attemptsMade + 1 >= ((job.opts.attempts as number | undefined) ?? 1);
    // Transient errors absorbed on the final attempt, kept for the all-failed
    // rethrow and the admin alert detail.
    const transientErrors: Error[] = [];

    // Process one perspective: generate → fetch bytes → upload → persist its key.
    // Persisting the key immediately (rather than only in the final COMPLETE
    // transaction) is what lets a retry skip an already-finished perspective.
    // Returns 'moderated' when the AI provider blocked THIS perspective, and
    // 'failed' for a transient error on the FINAL attempt — both reported
    // upward (instead of thrown) so the caller can complete the job with
    // whatever survived.
    async function processPerspective(
      bodyPhoto: (typeof genUnits)[number],
    ): Promise<PerspectiveOutcome> {
      if (existingKeyFor(bodyPhoto.perspective)) {
        log.info('Skipping perspective already generated on a prior attempt', {
          jobId,
          perspective: bodyPhoto.perspective,
        });
        return 'ok';
      }

      log.debug('Processing generation', {
        jobId,
        perspective: bodyPhoto.perspective,
        referenceCount: clothingUrls.length,
      });

      try {
        return await generateAndPersist(bodyPhoto);
      } catch (err) {
        // Non-moderation failure (Grok 5xx, download, S3, DB). Not final
        // attempt → rethrow so BullMQ retries the job (already-persisted
        // perspectives are skipped on the retry). Final attempt → absorb, so
        // a surviving perspective can still be delivered.
        if (!isFinalAttempt) throw err;
        const error = err instanceof Error ? err : new Error(String(err));
        transientErrors.push(error);
        log.error('Perspective failed on final attempt — completing with survivors if any', {
          jobId,
          userId,
          perspective: bodyPhoto.perspective,
          error: error.message,
        });
        return 'failed';
      }
    }

    // The generate→download→upload→persist pipeline for one perspective.
    // Throws on transient failure; returns 'moderated' on a policy block.
    async function generateAndPersist(
      bodyPhoto: (typeof genUnits)[number],
    ): Promise<PerspectiveOutcome> {
      // grokService accepts S3 keys (preferred) or full URLs (legacy rows).
      // Free-form transform: the reference image(s) the user uploaded are the
      // only inputs — no body photo is prepended.
      let resultUrl: string;
      try {
        resultUrl = await generateTransformImage({
          clothingImageUrls: clothingUrls,
          userPrompt: promptText ?? undefined,
          perspective: bodyPhoto.perspective,
        });
      } catch (genErr) {
        if (genErr instanceof ContentModeratedError) {
          // Policy rejection for THIS perspective. Don't fail the job from in
          // here — report it upward so the job can still complete if another
          // perspective succeeded (Grok false-positives on single perspectives
          // were observed with completely ordinary clothing).
          log.warn('Creation blocked by content moderation', {
            jobId,
            userId,
            perspective: bodyPhoto.perspective,
            reason: genErr.message,
          });
          return 'moderated';
        }
        throw genErr;
      }

      log.debug('Got result from Grok', {
        jobId,
        perspective: bodyPhoto.perspective,
        resultLength: resultUrl.length,
        isBase64: resultUrl.startsWith('data:'),
        isUrl: resultUrl.startsWith('http'),
      });

      // Grok returns either base64 data or a temporary URL that will expire;
      // upload the bytes to S3 for permanent storage either way.
      if (!resultUrl.startsWith('data:') && !resultUrl.startsWith('http')) {
        throw new Error(`Unexpected result format from Grok: ${resultUrl.substring(0, 50)}`);
      }
      const buffer = await downloadGeneratedImage(resultUrl);

      // Upload to S3 — store the key only; presigned URLs are minted at read time.
      const key = await uploadToS3('results', userId, `${uuidv4()}.jpg`, buffer, 'image/jpeg');

      logUpload('completed', {
        userId,
        fileType: 'creation-result',
        s3Key: key,
        fileSize: buffer.length,
        success: true,
        perspective: bodyPhoto.perspective,
      });

      // Persist this perspective's key right away so a retry skips it.
      await prisma.creation.update({
        where: { id: jobId },
        data:
          bodyPhoto.perspective === 'full_body'
            ? { resultImageUrl: key }
            : { resultImage2Url: key },
      });
      return 'ok';
    }

    // Run the generation unit(s). Kept as a map/Promise.all so the surrounding
    // outcome-classification + partial/refund machinery stays intact; today
    // there is exactly one free-form generation per job.
    const outcomes = await Promise.all(genUnits.map(processPerspective));
    const succeeded = genUnits.filter((_, i) => outcomes[i] === 'ok').map((p) => p.perspective);
    const moderated = genUnits
      .filter((_, i) => outcomes[i] === 'moderated')
      .map((p) => p.perspective);
    const failed = genUnits.filter((_, i) => outcomes[i] === 'failed').map((p) => p.perspective);
    const verdict = classifyOutcomes(outcomes);

    // EVERY perspective blocked → genuine policy rejection. Terminal: BullMQ
    // must not retry, and the `failed` handler applies strike + grace-refund
    // handling on the sentinel.
    if (verdict === 'all_blocked') {
      throw new UnrecoverableError(MODERATION_ERROR);
    }

    // Nothing generated and at least one loss was a transient error (final
    // attempt). Rethrow → ordinary terminal failure: FAILED + refund, no
    // strike (an error, not the content filter, caused the miss).
    if (verdict === 'all_failed') {
      throw transientErrors[0] ?? new Error('All perspectives failed');
    }

    // Partial: deliver what survived rather than discarding a paid-for result.
    // A COMPLETE job's errorMessage doubles as the user-facing notice the
    // clients render alongside the results.
    let userNote: string | null = null;

    // Transient partial: the user paid for two views and got one through no
    // fault of their own → refund the credit and say so.
    if (failed.length > 0) {
      const refunded = userId ? await refundJobCredit(jobId, userId) : false;
      userNote = PARTIAL_TRANSIENT_USER_NOTE;
      log.warn('Perspective(s) hit transient errors — completing with survivors, credit refunded', {
        jobId,
        userId,
        failed,
        succeeded,
        refunded,
      });
      alertAdminsOfGenerationFailure({
        jobId,
        userId,
        kind: 'partial_error',
        detail:
          `Failed perspective(s): ${failed.join(', ')}. Delivered: ${succeeded.join(', ')}. ` +
          `Credit refunded: ${refunded ? 'yes' : 'no (none spent or already refunded)'}. ` +
          `Last error: ${transientErrors[transientErrors.length - 1]?.message ?? 'unknown'}`,
      });
    }

    // Moderation partial: no strike and no refund — a result was delivered,
    // and the same clothing passing on another perspective is strong evidence
    // the block was a filter false positive.
    if (moderated.length > 0) {
      userNote = userNote ?? PARTIAL_MODERATION_USER_NOTE;
      log.warn('Perspective(s) blocked by moderation — completing job with the rest', {
        jobId,
        userId,
        moderated,
        succeeded,
      });
      alertAdminsOfGenerationFailure({
        jobId,
        userId,
        kind: 'partial_moderation',
        detail: `Blocked perspective(s): ${moderated.join(', ')}. Delivered: ${succeeded.join(', ')}.`,
      });
    }

    const durationMs = Date.now() - startTime;

    // Every surviving perspective's key is now persisted; flip to COMPLETE +
    // bump the lifetime counter (result URLs were written incrementally above).
    await prisma.$transaction([
      prisma.creation.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETE',
          perspectivesUsed: succeeded,
          ...(userNote ? { errorMessage: userNote } : {}),
        },
      }),
      // Increment lifetime creation counter only on successful completion
      prisma.user.update({
        where: { id: userId },
        data: { creationCount: { increment: 1 } },
      }),
    ]);

    logJob('completed', {
      jobId,
      jobType: 'transform',
      userId,
      durationMs,
      perspectivesCompleted: succeeded,
    });
  },
  { connection, concurrency: 3 },
);

worker.on('failed', async (job, err) => {
  // A content-moderation block is re-raised as UnrecoverableError(MODERATION_ERROR):
  // BullMQ won't retry it, and per ToS §5.4 it must NOT be refunded. It's
  // terminal even though attemptsMade may still be < maxAttempts.
  const isModerated = err?.message === MODERATION_ERROR;
  const attemptsMade = job?.attemptsMade ?? 0;
  const maxAttempts = (job?.opts?.attempts as number | undefined) ?? 1;
  const isTerminal = isModerated || attemptsMade >= maxAttempts;

  logJob('failed', {
    jobId: job?.data?.jobId || job?.id || 'unknown',
    jobType: 'transform',
    userId: job?.data?.userId,
    attempt: attemptsMade,
    maxAttempts,
    isTerminal,
    error: isModerated ? 'content_moderated' : err.message,
  });

  log.error('Job failed with stack trace', {
    jobId: job?.data?.jobId,
    stack: err.stack,
  });

  // Report genuine terminal failures to Sentry so a broken Grok pipeline pages us
  // instead of dying silently in the logs. Content-moderation blocks are an
  // expected policy outcome, not an error — don't alert on those. No-op when
  // Sentry is disabled.
  if (isTerminal && !isModerated) {
    Sentry.captureException(err, {
      tags: { service: 'queue', queue: 'transform' },
      extra: {
        jobId: job?.data?.jobId,
        userId: job?.data?.userId,
        attemptsMade,
        maxAttempts,
      },
    });
  }

  // Non-terminal failure: BullMQ will retry. Leave the DB row in PROCESSING
  // (set at the start of the attempt) and don't refund — the credit only
  // needs returning if the final attempt also fails.
  if (!isTerminal) return;

  const jobId = job?.data?.jobId;
  const userId = job?.data?.userId;
  if (!jobId) return;

  let errorMessage: string;
  let refunded = false;

  if (isModerated) {
    // Every perspective was blocked. Record the strike, then decide refund:
    // the first MODERATION_GRACE_WARNINGS strikes are warnings (credit
    // refunded, message says so); after that the ToS §5.4 no-refund policy
    // applies. An unknown count (strike bookkeeping failed) falls back to the
    // no-refund path — same behavior as before the grace window existed.
    const strikeCount = userId ? await recordModerationStrike(userId, jobId) : null;
    const withinGrace = isWithinModerationGrace(strikeCount);
    if (withinGrace && strikeCount !== null && userId) {
      refunded = await refundJobCredit(jobId, userId);
      errorMessage = moderationWarningMessage(strikeCount);
    } else {
      errorMessage = MODERATION_USER_MESSAGE;
    }
    log.warn(
      withinGrace
        ? 'Creation blocked by content moderation — warning issued, credit refunded'
        : 'Creation blocked by content moderation — credit NOT refunded (ToS 5.4)',
      { jobId, userId, strikeCount },
    );
  } else {
    errorMessage = err.message?.substring(0, 500) || 'Unknown error';
  }

  try {
    await prisma.creation.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorMessage },
    });
  } catch (dbErr: unknown) {
    log.error('Failed to update job status in database', {
      jobId,
      error: (dbErr as Error).message,
    });
  }

  // Non-moderation terminal failure: always refund any credit deducted at
  // submit time.
  if (!isModerated && userId) {
    refunded = await refundJobCredit(jobId, userId);
  }

  // Email the admins about every terminal failure, whatever the cause.
  alertAdminsOfGenerationFailure({
    jobId,
    userId,
    kind: isModerated ? 'moderated' : 'error',
    detail: errorMessage,
    attempts: attemptsMade,
    refunded,
  });
});

// Refund the credit a job deducted at submit time, if any. creationsController
// tags the USAGE transaction with `(job=<jobId>)` for exactly this lookup.
// Idempotent: if a REFUND for this jobId already exists (e.g. a prior failed
// handler invocation), skip — avoids double-refund on duplicate failure
// events. The already-refunded check runs INSIDE one transaction that first
// locks the user row (FOR UPDATE), so two concurrent invocations for the same
// job serialize — the second sees the first's REFUND row instead of both
// passing a check-then-create race. Returns true only when a refund was
// actually issued.
async function refundJobCredit(jobId: string, userId: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

      const usage = await tx.creditTransaction.findFirst({
        where: {
          userId,
          type: 'USAGE',
          description: { contains: `job=${jobId}` },
        },
      });
      if (!usage) return false; // covered by a weekly allowance — nothing to refund

      const existingRefund = await tx.creditTransaction.findFirst({
        where: {
          userId,
          type: 'REFUND',
          description: { contains: `job=${jobId}` },
        },
      });
      if (existingRefund) {
        log.info('Refund already issued for failed job — skipping', { jobId, userId });
        return false;
      }

      // Refund exactly what was charged (read from the USAGE row) rather than a
      // hardcoded 1, so the refund always matches the charge if the per-creation
      // cost ever changes. Mirrors videoWorker.refundVideoCredit.
      const refundAmount = Math.abs(usage.amount);
      await tx.user.update({
        where: { id: userId },
        data: { credits: { increment: refundAmount } },
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'REFUND',
          amount: refundAmount,
          description: `Refund: creation failed (job=${jobId})`,
        },
      });
      log.info('Refunded credit for terminally failed job', { jobId, userId });
      return true;
    });
  } catch (refundErr: unknown) {
    log.error('Failed to refund credit for failed job', {
      jobId,
      userId,
      error: (refundErr as Error).message,
    });
    return false;
  }
}

worker.on('completed', (job) => {
  log.debug('Job completed event', { bullmqJobId: job.id });
});

export default worker;
