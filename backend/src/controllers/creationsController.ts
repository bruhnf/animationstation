import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { uploadToS3, deleteFromS3, keyFromUrl, copyWithinS3 } from '../services/s3Service';
import { presignCreation, presignCreations, presignAvatarOnly } from '../services/imageUrlService';
import { safeFilename } from '../middleware/uploadMiddleware';
import { enqueueTransform } from '../queue/transformQueue';
import { MAX_CLOTHING_ITEMS } from '../middleware/subscription';
import { TIER_CONFIG } from '../services/tierService';
import { computeQueueDelayMs } from '../services/throttleService';
import { resizeImageForGeneration } from '../utils/imageProcessor';
import { createChildLogger } from '../services/logger';
import { OUTFIT_POLICY_MESSAGE, containsBannedTerm } from '../utils/outfitPrompt';
import { VALID_IMAGE_ASPECTS } from '../services/grokService';

const log = createChildLogger('CreationsController');

// Per-user storage cap for stored creation sessions. Result images and the
// associated clothing/source photos add up over time; users hit this limit
// and must delete some sessions in their Profile before they can run another
// creation.
export const CREATION_STORAGE_LIMIT = 500;

// Max length of the optional user-authored creation title/caption. Mirrors the
// schema's VARCHAR(140) so an over-long value can never reach the DB — we trim
// to this length defensively before any write.
export const CREATION_TITLE_MAX_LENGTH = 140;

// Normalize an incoming title/caption: must be a string; control characters
// stripped, surrounding whitespace trimmed, hard-capped at the max length.
// Returns null for anything empty (so a blank title clears the caption rather
// than storing ""). Plain text only — never rendered as HTML on any surface.
export function sanitizeCreationTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\p{Cc}/gu, '').trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, CREATION_TITLE_MAX_LENGTH);
}

// Max length of the optional free-form multi-image compose prompt. Mirrors the
// schema's promptText VARCHAR(300).
export const TRANSFORM_PROMPT_MAX_LENGTH = 300;

// Normalize + moderate the optional user prompt for the multi-image compose
// path. Control chars stripped, whitespace collapsed, trimmed, hard-capped at
// 300. Returns { ok:true, value } where value is null for empty input, or
// { ok:false } when it trips the relaxed (sexual-content-only) banned-term
// screen so the caller can reject with 400 + OUTFIT_POLICY_MESSAGE.
export function sanitizeTransformPrompt(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (typeof raw !== 'string') return { ok: true, value: null };
  const cleaned = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TRANSFORM_PROMPT_MAX_LENGTH);
  if (cleaned.length === 0) return { ok: true, value: null };
  if (containsBannedTerm(cleaned)) return { ok: false };
  return { ok: true, value: cleaned };
}

// Thrown inside the submit transaction when a conditional credit decrement
// matches no row — i.e. a concurrent request drained the balance between the
// pre-check and the deduction. Used to roll back the whole transaction so a
// credit can never be double-spent into a negative balance.
class InsufficientCreditsError extends Error {}

export async function submitTransform(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  log.debug('submitTransform called', { user: req.user });

  const files = req.files as Express.Multer.File[] | undefined;
  // Alternative clothing source: a saved closet item (Outfit Designer). The
  // client sends its id as a multipart text field instead of a photo file.
  const closetItemId =
    typeof req.body?.closetItemId === 'string' && req.body.closetItemId.trim().length > 0
      ? req.body.closetItemId.trim()
      : null;

  if (files && files.length > 0 && closetItemId) {
    res.status(400).json({ error: 'Send either a reference photo or a closet item, not both' });
    return;
  }
  // Text-to-image path: no reference images at all. The prompt (validated
  // below) then becomes mandatory — an empty submit has nothing to generate.
  const isTextToImage = (!files || files.length === 0) && !closetItemId;

  const { userId } = req.user;

  // Check clothing item limit (same for all users)
  if (files && files.length > MAX_CLOTHING_ITEMS) {
    res.status(400).json({
      error: `Maximum ${MAX_CLOTHING_ITEMS} clothing item(s) per creation`,
    });
    return;
  }

  // Fetch fresh tier, credit, and body photo state from DB — never trust JWT claims for these
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tier: true,
      credits: true,
      aiProcessingConsentAt: true,
    },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // App Store Review Guidelines 5.1.1(i) / 5.1.2(i): explicit user consent is
  // required before transmitting personal data to a third-party AI service.
  // The mobile app surfaces an opt-in dialog naming xAI / Grok Imagine before
  // the first submit, then POSTs /api/profile/me/ai-consent to set this
  // timestamp. Without it, refuse before any S3 upload or credit deduction.
  if (!user.aiProcessingConsentAt) {
    res.status(403).json({
      error: 'AI_CONSENT_REQUIRED',
      message:
        'Before generating an image, please review and accept the disclosure that the image(s) you provide will be sent to xAI (Grok Imagine API) for processing.',
    });
    return;
  }

  // Storage cap: count non-failed jobs (failed jobs have no stored results
  // so they don't contribute). If at or above the cap, refuse the new job
  // before any S3 upload or credit deduction so honest users don't pay for
  // a creation they can't store.
  const storedCount = await prisma.creation.count({
    where: { userId, status: { not: 'FAILED' } },
  });
  if (storedCount >= CREATION_STORAGE_LIMIT) {
    log.info('Creation blocked: storage limit reached', { userId, storedCount });
    res.status(403).json({
      error: 'CREATION_LIMIT_REACHED',
      message: `You've reached the ${CREATION_STORAGE_LIMIT}-session storage limit. Delete some sessions from your Profile to continue.`,
      stored: storedCount,
      limit: CREATION_STORAGE_LIMIT,
    });
    return;
  }

  const { tier, credits } = user;
  const weeklyLimit = TIER_CONFIG[tier].weeklyLimit;

  log.debug('User tier status (live)', { userId, tier, credits, weeklyLimit });

  // FREE tier (no weekly allowance) needs credits
  if (weeklyLimit <= 0 && credits <= 0) {
    log.info('Creation blocked: no weekly allowance or credits', { userId, tier, credits });
    res.status(403).json({
      error: 'SUBSCRIPTION_REQUIRED',
      message: 'Please upgrade or purchase credits to use creation.',
    });
    return;
  }

  // Count non-failed jobs in the rolling 7-day window to enforce the weekly limit.
  // Rolling window (rather than calendar week) keeps the reset gradual: usage
  // ages out continuously, so a user can't burn the full quota at the end of
  // one week and the start of the next.
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekCount = await prisma.creation.count({
    where: { userId, createdAt: { gte: weekStart }, status: { not: 'FAILED' } },
  });

  // Fast-fail (pre-S3-upload): weekly allowance exhausted AND no credits →
  // refuse now so the user isn't made to wait on uploads for a submission
  // that can't run. This check is advisory only — the authoritative
  // free-or-paid decision is re-taken inside the submit transaction below,
  // under a user-row lock, where it can't race a concurrent submission.
  if (!(weeklyLimit > 0 && weekCount < weeklyLimit) && credits <= 0) {
    res.status(429).json({
      error: 'WEEKLY_LIMIT_REACHED',
      message:
        weeklyLimit > 0
          ? `Weekly limit of ${weeklyLimit} reached. Purchase credits for more creations.`
          : 'No credits remaining. Purchase credits to use creation.',
      weeklyUsed: weekCount,
      weeklyLimit,
    });
    return;
  }

  // Optional free-form prompt (multi-image compose, feature 2). Sanitized,
  // length-capped, and screened against the relaxed (sexual-content-only)
  // denylist. A hit rejects the submit BEFORE any S3 upload or credit spend.
  const promptResult = sanitizeTransformPrompt(req.body?.prompt);
  if (!promptResult.ok) {
    res.status(400).json({ error: 'PROMPT_REJECTED', message: OUTFIT_POLICY_MESSAGE });
    return;
  }
  const promptText = promptResult.value;
  if (isTextToImage && !promptText) {
    res.status(400).json({
      error: 'PROMPT_REQUIRED',
      message: 'Describe what you want to create, or attach a photo to transform.',
    });
    return;
  }

  // Optional output aspect ratio from the create UI. Anything outside the
  // known set is treated as "not specified" so client drift can't hard-fail.
  const aspectRatio =
    typeof req.body?.aspectRatio === 'string' && VALID_IMAGE_ASPECTS.has(req.body.aspectRatio)
      ? req.body.aspectRatio
      : null;

  // Pre-allocate the jobId so the credit-deduction transaction can be tagged
  // with it (the worker's failure handler parses the tag to refund).
  const jobId = uuidv4();

  // Resolve the clothing source into ref-images/ S3 keys. Both paths run
  // BEFORE the credit deduction so a failure here can never charge the user.
  const clothingKeys: string[] = [];
  if (closetItemId) {
    // Closet path: the item's generated outfit image is COPIED (server-side)
    // into ref-images/ so this job owns its key — deleting the closet
    // item later can never break this job's images, and every existing
    // S3-cleanup path (job delete, account delete, orphan scan) works
    // unchanged. Ownership is enforced by the userId filter.
    const closetItem = await prisma.closetItem.findFirst({
      where: { id: closetItemId, userId },
      select: { id: true, imageUrl: true },
    });
    if (!closetItem) {
      res
        .status(404)
        .json({ error: 'CLOSET_ITEM_NOT_FOUND', message: 'That closet item no longer exists.' });
      return;
    }
    const key = await copyWithinS3(
      keyFromUrl(closetItem.imageUrl),
      'ref-images',
      userId,
      `${uuidv4()}-closet.jpg`,
    );
    clothingKeys.push(key);
  } else if (files && files.length > 0) {
    // Upload path: resize + store. Stores S3 keys, not public URLs — the
    // bucket is private; presigned URLs are minted at read time.
    for (const file of files) {
      const processed = await resizeImageForGeneration(file.buffer);
      const baseFilename = safeFilename(file.originalname).replace(/\.[^/.]+$/, '');
      const filename = `${uuidv4()}-${baseFilename}.jpg`;
      const key = await uploadToS3(
        'ref-images',
        userId,
        filename,
        processed.buffer,
        processed.mimeType,
      );
      clothingKeys.push(key);
    }
  }
  // Guest creations are forced private until the user converts to a real account.
  // This keeps anonymous accounts from publishing public UGC (limits the
  // App Store Guideline 1.2 moderation surface). Converted users' old guest
  // jobs stay private; there is no per-job publish toggle today.
  const isPrivate =
    req.user.isGuest === true || req.body?.isPrivate === true || req.body?.isPrivate === 'true';

  // Optional user-authored caption shown under the result on the feed. Plain
  // text, trimmed + length-capped; blank/absent → null (no caption).
  const title = sanitizeCreationTitle(req.body?.title);

  // Soft per-user throttle. Bursts beyond the tier-specific free quota get
  // a short BullMQ delay (admin-tunable ladder, default 10/20/30/40s) so
  // rapid-fire submissions are paced without a hard 429. The client renders a
  // countdown from `scheduledStartAt`. Config is read at runtime from
  // AppSettings (see services/throttleService.ts).
  const throttle = await computeQueueDelayMs(userId, tier);
  const scheduledStartAt = throttle.delayMs > 0 ? new Date(Date.now() + throttle.delayMs) : null;
  if (throttle.delayMs > 0) {
    log.info('Creation submission throttled', {
      userId,
      tier,
      ordinal: throttle.ordinal,
      burst: throttle.burst,
      delayMs: throttle.delayMs,
      jobId,
    });
  }

  // Create the job row and — when the creation is paid with a credit — deduct
  // the credit in a SINGLE interactive transaction. Either both land or neither
  // does, so a credit can never be charged without a job row for the worker to
  // refund against on terminal failure. The `job=<id>` token in the description
  // is parsed by queue/transformWorker.ts — don't change its format without updating
  // that worker.
  //
  // The transaction starts by LOCKING the user row (SELECT ... FOR UPDATE),
  // which serializes concurrent submissions from the same user. Without it,
  // the weekly-allowance count and the job insert are separate steps, so N
  // parallel submissions at limit-1 all read the same count and all pass —
  // overshooting the weekly cap with free sessions (demonstrated empirically
  // in scripts/raceChecks.mjs). The weekly count is therefore re-taken INSIDE
  // the lock; the pre-check above remains only a fast-fail that spares the
  // S3 uploads. A consequence of the recount: if a racing submission consumed
  // the last allowance slot first, this one correctly falls through to credit
  // payment (or rolls back as out-of-credits) instead of riding free.
  //
  // The deduction stays a CONDITIONAL update (credits >= 1) as belt-and-braces:
  // if anything ever bypasses the row lock, the balance still can't go negative.
  // If it matches no row, we throw to roll back the job row too and report
  // out-of-credits.
  let chargedCredit = false;
  try {
    chargedCredit = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const weekCountNow = await tx.creation.count({
        where: { userId, createdAt: { gte: weekStart }, status: { not: 'FAILED' } },
      });
      const payWithCredit = !(weeklyLimit > 0 && weekCountNow < weeklyLimit);
      await tx.creation.create({
        data: {
          id: jobId,
          userId,
          isPrivate,
          title,
          // Null for a pure text-to-image generation (no reference inputs).
          refImage1Url: clothingKeys[0] ?? null,
          refImage2Url: clothingKeys[1] ?? null,
          // Free-form transform has no body photo; the reference image lives in
          // refImage1Url and the generated result in resultImageUrl.
          sourceImageUrl: null,
          promptText,
          perspectivesUsed: [],
          creditsAtTime: user.credits,
          scheduledStartAt,
        },
      });
      if (payWithCredit) {
        const deducted = await tx.user.updateMany({
          where: { id: userId, credits: { gte: 1 } },
          data: { credits: { decrement: 1 } },
        });
        if (deducted.count === 0) {
          throw new InsufficientCreditsError();
        }
        await tx.creditTransaction.create({
          data: {
            userId,
            type: 'USAGE',
            amount: -1,
            description: `Creation generation (job=${jobId})`,
          },
        });
      }
      return payWithCredit;
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      log.info('Creation credit race: balance drained by a concurrent request', { userId, jobId });
      // Best-effort cleanup of the clothing photos we uploaded before the race
      // was detected, so they don't orphan in S3 (the orphan sweep is a backstop).
      for (const key of clothingKeys) {
        deleteFromS3(key).catch(() => {});
      }
      res.status(429).json({
        error: 'WEEKLY_LIMIT_REACHED',
        message: 'No credits remaining. Purchase credits to use creation.',
        weeklyUsed: weekCount,
        weeklyLimit,
      });
      return;
    }
    throw err;
  }

  // Worker reads from S3 via SDK using these keys — no public URL needed.
  //
  // The enqueue happens AFTER the credit-deduction transaction has committed. If
  // it throws (e.g. a Redis blip), the job row would otherwise be stranded
  // PENDING forever — no worker to run it and no `failed` handler to refund it.
  // Roll it back here: mark the row FAILED and refund the credit (if one was
  // spent), then surface a 503 so the client can retry.
  try {
    await enqueueTransform(
      { jobId, userId, clothingUrls: clothingKeys, promptText, aspectRatio },
      throttle.delayMs,
    );
  } catch (enqueueErr) {
    log.error('Failed to enqueue creation after commit — rolling back', {
      userId,
      jobId,
      error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
    });
    try {
      await prisma.$transaction([
        prisma.creation.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            errorMessage: 'Could not queue your creation. Please try again.',
          },
        }),
        ...(chargedCredit
          ? [
              prisma.user.update({ where: { id: userId }, data: { credits: { increment: 1 } } }),
              prisma.creditTransaction.create({
                // Same `job=<id>` tag the worker's refund path uses, so its
                // idempotency check would skip a duplicate if it ever ran.
                data: {
                  userId,
                  type: 'REFUND' as const,
                  amount: 1,
                  description: `Refund: enqueue failed (job=${jobId})`,
                },
              }),
            ]
          : []),
      ]);
    } catch (rollbackErr) {
      log.error('Rollback after enqueue failure also failed', {
        userId,
        jobId,
        error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }
    // Best-effort: drop the clothing photos uploaded for this now-dead job.
    for (const key of clothingKeys) deleteFromS3(key).catch(() => {});
    res.status(503).json({
      error: 'QUEUE_UNAVAILABLE',
      message: 'Could not start your creation right now. Please try again in a moment.',
    });
    return;
  }

  res.status(202).json({
    jobId,
    status: 'PENDING',
    scheduledStartAt,
    queueDelayMs: throttle.delayMs,
  });
}

export async function getJobStatus(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { jobId } = req.params;
  const job = await prisma.creation.findUnique({
    where: { id: jobId },
    include: {
      user: {
        select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
      },
    },
  });
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  // Visibility: owner can always read (including in-progress / failed jobs);
  // non-owners can only read public completed posts. This is also what the
  // mobile poll loop hits for its own jobs and what CommentsScreen hits
  // when opening someone else's post from the feed.
  const isOwner = job.userId === req.user.userId;
  if (!isOwner && job.isPrivate) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const { user, ...rest } = job;
  const [presignedJob, presignedUser] = await Promise.all([
    presignCreation(rest),
    presignAvatarOnly(user),
  ]);
  // Public posts surface their input thumbnails (body photo + clothing) along
  // with the result — the same content the feed card shows. Private jobs are
  // already 404'd to non-owners above, so only the owner (or a public post)
  // reaches here.
  res.json({ ...presignedJob, user: presignedUser });
}

export async function getCreationsHistory(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
  const limit = 20;

  const jobs = await prisma.creation.findMany({
    where: { userId: req.user.userId, status: 'COMPLETE' },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      // Whether the owner has bookmarked this look — drives the yellow "Save
      // Look" state in the profile detail modal.
      savedLooks: { where: { userId: req.user.userId }, select: { id: true } },
    },
  });

  const presigned = await presignCreations(jobs);
  const withSaved = presigned.map(({ savedLooks, ...job }) => ({
    ...job,
    saved: savedLooks.length > 0,
  }));

  res.json({ jobs: withSaved, page });
}

// Bulk-delete sessions owned by the requesting user. Used by the multi-select
// flow on the user's own Profile screen.
//
// We only delete jobs that belong to the requester — Prisma's deleteMany with
// { userId, id: { in } } enforces this on the DB. Cascades on the FK
// relationships clean up Likes, Comments, and Notifications referencing the
// deleted jobs (see schema.prisma).
//
// Best-effort S3 cleanup: each job has unique-per-job clothing photo and
// result image keys; we delete those. We deliberately do NOT delete
// `sourceImageUrl` because it points at the user's own body photo which is
// shared across many jobs and managed via the Profile photo controls.
export async function bulkDeleteJobs(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { jobIds } = req.body as { jobIds?: unknown };
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    res.status(400).json({ error: 'jobIds must be a non-empty array' });
    return;
  }
  if (jobIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'jobIds must be strings' });
    return;
  }
  if (jobIds.length > CREATION_STORAGE_LIMIT) {
    res
      .status(400)
      .json({ error: `Cannot delete more than ${CREATION_STORAGE_LIMIT} sessions at once` });
    return;
  }

  const userId = req.user.userId;
  const ids = jobIds as string[];

  // Look up the jobs we're about to delete so we can clean up S3 keys after.
  // Filter by userId so a malicious caller cannot enumerate or delete other
  // users' jobs by guessing IDs.
  const jobs = await prisma.creation.findMany({
    where: { id: { in: ids }, userId },
    select: {
      id: true,
      kind: true,
      refImage1Url: true,
      refImage2Url: true,
      resultImageUrl: true,
      resultImage2Url: true,
      videoUrl: true,
      sourceImageUrl: true,
    },
  });

  if (jobs.length === 0) {
    res.json({ deleted: 0 });
    return;
  }

  const deletableIds = jobs.map((j) => j.id);
  const result = await prisma.creation.deleteMany({
    where: { id: { in: deletableIds }, userId },
  });

  // Fire-and-forget S3 cleanup — the user's API response shouldn't wait on
  // (and shouldn't fail because of) S3 delete latency. Orphaned objects can
  // be cleaned up later by a sweep job.
  const keysToDelete: string[] = [];
  for (const j of jobs) {
    if (j.refImage1Url) keysToDelete.push(keyFromUrl(j.refImage1Url));
    if (j.refImage2Url) keysToDelete.push(keyFromUrl(j.refImage2Url));
    if (j.resultImageUrl) keysToDelete.push(keyFromUrl(j.resultImageUrl));
    if (j.resultImage2Url) keysToDelete.push(keyFromUrl(j.resultImage2Url));
    if (j.videoUrl) keysToDelete.push(keyFromUrl(j.videoUrl));
    // VIDEO jobs OWN their source image (copied/uploaded under videos/),
    // so delete it. For IMAGE creations sourceImageUrl is the user's shared profile
    // body photo — never delete that here.
    if (j.kind === 'VIDEO' && j.sourceImageUrl) keysToDelete.push(keyFromUrl(j.sourceImageUrl));
  }
  for (const key of keysToDelete) {
    deleteFromS3(key).catch((err) => {
      log.warn('S3 cleanup failed for deleted creation', {
        userId,
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  log.info('Bulk-deleted creation sessions', {
    userId,
    requestedCount: ids.length,
    deletedCount: result.count,
    s3KeysQueued: keysToDelete.length,
  });

  res.json({ deleted: result.count });
}

export async function updateJobPrivacy(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { jobId } = req.params;
  const { isPrivate } = req.body;

  if (typeof isPrivate !== 'boolean') {
    res.status(400).json({ error: 'isPrivate must be a boolean' });
    return;
  }

  const job = await prisma.creation.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== req.user.userId) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const updated = await prisma.creation.update({
    where: { id: jobId },
    data: { isPrivate },
  });

  res.json(await presignCreation(updated));
}

// Set or clear the optional title/caption on one of the caller's own creations.
// Owner-only (a non-owner / unknown id is indistinguishable as 404). Sending an
// empty/blank title clears it. The caption is plain text — sanitized here and
// never rendered as HTML on any surface.
export async function updateJobTitle(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { jobId } = req.params;
  // Allow null/'' to explicitly clear the caption; otherwise must be a string.
  if (
    req.body?.title !== undefined &&
    req.body?.title !== null &&
    typeof req.body?.title !== 'string'
  ) {
    res.status(400).json({ error: 'title must be a string' });
    return;
  }
  const title = sanitizeCreationTitle(req.body?.title);

  const job = await prisma.creation.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== req.user.userId) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const updated = await prisma.creation.update({
    where: { id: jobId },
    data: { title },
  });

  res.json(await presignCreation(updated));
}
