import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { uploadToS3, copyWithinS3, deleteFromS3, keyFromUrl } from '../services/s3Service';
import { presignCreations } from '../services/imageUrlService';
import { safeFilename } from '../middleware/uploadMiddleware';
import { resizeImageForGeneration } from '../utils/imageProcessor';
import { enqueueVideo } from '../queue/videoQueue';
import { getVideoCreditCost } from '../services/appSettingsService';
import { computeQueueDelayMs } from '../services/throttleService';
import { sanitizeMotionPrompt } from '../utils/videoPrompt';
import { selectVideoSources, VideoSourceInput, VideoRequestFiles } from '../utils/videoSource';
import { sanitizeCreationTitle, CREATION_STORAGE_LIMIT } from './creationsController';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('VideoController');

class InsufficientCreditsError extends Error {}

type SourceResult =
  | { ok: true; key: string }
  | { ok: false; status: number; error: string; message: string };

// Resolve ONE video source — a camera-roll `file`, a completed creation
// (`sourceJobId`), or a profile body photo (`bodyPhoto`) — into a videos/
// S3 key the job owns (uploaded or server-side copied). Returns a discriminated
// result so the caller controls the HTTP response. Used for both the primary
// source and the optional second (transition) image.
async function resolveVideoSource(
  userId: string,
  user: { fullBodyUrl: string | null; mediumBodyUrl: string | null },
  input: VideoSourceInput,
): Promise<SourceResult> {
  const { file, sourceJobId, bodyPhoto } = input;
  if (file) {
    const processed = await resizeImageForGeneration(file.buffer);
    const base = safeFilename(file.originalname).replace(/\.[^/.]+$/, '');
    const key = await uploadToS3(
      'videos',
      userId,
      `${uuidv4()}-${base}.jpg`,
      processed.buffer,
      processed.mimeType,
    );
    return { ok: true, key };
  }
  if (sourceJobId) {
    const job = await prisma.creation.findFirst({
      where: { id: sourceJobId, userId, status: 'COMPLETE' },
      select: { resultImageUrl: true, resultImage2Url: true, videoUrl: true },
    });
    const src = job?.resultImageUrl ?? job?.resultImage2Url ?? null;
    if (!job || job.videoUrl || !src) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_SOURCE',
        message: "That creation can't be used as a video source.",
      };
    }
    const key = await copyWithinS3(keyFromUrl(src), 'videos', userId, `${uuidv4()}-src.jpg`);
    return { ok: true, key };
  }
  if (bodyPhoto === 'full' || bodyPhoto === 'medium') {
    const src = bodyPhoto === 'full' ? user.fullBodyUrl : user.mediumBodyUrl;
    if (!src) {
      return {
        ok: false,
        status: 422,
        error: 'NO_BODY_PHOTOS',
        message: 'Upload that body photo in your profile first.',
      };
    }
    const key = await copyWithinS3(keyFromUrl(src), 'videos', userId, `${uuidv4()}-src.jpg`);
    return { ok: true, key };
  }
  return {
    ok: false,
    status: 400,
    error: 'NO_SOURCE',
    message: 'Pick a photo, a creation, or a body photo to animate.',
  };
}

// POST /api/video — generate an AI video by animating a source image, with an
// OPTIONAL second image to transition toward.
//
// Each source (primary, and optional second) is one of: a multipart `photo` /
// `photo2` (camera roll), `sourceJobId` / `sourceJobId2` (a completed creation's
// result), or `bodyPhoto` / `bodyPhoto2` = 'full'|'medium' (a profile body
// photo). Chosen images are copied/uploaded under videos/ so the job owns
// the keys. The primary lands in sourceImageUrl (poster); the optional second in
// refImage1Url and is passed to Grok as a `reference_images` entry, with
// the motion prompt describing the transition. (xAI has no literal first→last
// frame interpolation; the second image is a reference/target, prompt-driven.)
// Videos are real-account only (route is blockGuests) and always cost credits.
export async function submitVideo(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId } = req.user;

  const promptResult = sanitizeMotionPrompt(req.body?.motionPrompt);
  if (!promptResult.ok) {
    res.status(400).json({ error: 'INVALID_MOTION_PROMPT', message: promptResult.error });
    return;
  }
  const motionPrompt = promptResult.value!;
  const title = sanitizeCreationTitle(req.body?.title);
  // Guest videos are forced PRIVATE — anonymous accounts never publish public UGC
  // (keeps the Guideline 1.2 moderation surface small), matching guest creations.
  const isPrivate =
    req.user.isGuest === true || req.body?.isPrivate === true || req.body?.isPrivate === 'true';

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      credits: true,
      tier: true,
      aiProcessingConsentAt: true,
      fullBodyUrl: true,
      mediumBodyUrl: true,
    },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Same explicit AI-processing consent gate as creation (we send a user image to
  // xAI). Checked before any upload or credit charge.
  if (!user.aiProcessingConsentAt) {
    res.status(403).json({
      error: 'AI_CONSENT_REQUIRED',
      message:
        'Before generating a video, please review and accept the disclosure that your photo will be sent to xAI (Grok Imagine API) for processing.',
    });
    return;
  }

  // Storage cap (shared with creation — both are creations rows).
  const storedCount = await prisma.creation.count({ where: { userId, status: { not: 'FAILED' } } });
  if (storedCount >= CREATION_STORAGE_LIMIT) {
    res.status(403).json({
      error: 'CREATION_LIMIT_REACHED',
      message: `You've reached the ${CREATION_STORAGE_LIMIT}-session storage limit. Delete some from your Profile to continue.`,
    });
    return;
  }

  const creditCost = await getVideoCreditCost();
  if (user.credits < creditCost) {
    res.status(403).json({
      error: 'SUBSCRIPTION_REQUIRED',
      message: `Videos cost ${creditCost} credits. Purchase credits to create one.`,
      creditCost,
    });
    return;
  }

  // Select the source inputs from the request (pure; reads req.files.photo /
  // photo2 — the field-name + .fields contract is unit-tested in
  // utils/videoSource.test.ts), then resolve each into a videos/ key the
  // job owns. BEFORE the credit charge, so a source error never charges the user.
  const { primary, second } = selectVideoSources(
    req.body,
    req.files as VideoRequestFiles | undefined,
  );

  if (!primary) {
    res.status(400).json({
      error: 'NO_SOURCE',
      message: 'Pick a photo, a creation, or a body photo to animate.',
    });
    return;
  }

  // Track every key we create so we can clean them ALL up on any later failure.
  const createdKeys: string[] = [];
  let sourceImageKey: string;
  let secondImageKey: string | null = null;
  try {
    const r1 = await resolveVideoSource(userId, user, primary);
    if (!r1.ok) {
      res.status(r1.status).json({ error: r1.error, message: r1.message });
      return;
    }
    sourceImageKey = r1.key;
    createdKeys.push(r1.key);

    // Optional second/transition image — only when the client sent one.
    if (second) {
      const r2 = await resolveVideoSource(userId, user, second);
      if (!r2.ok) {
        for (const k of createdKeys) deleteFromS3(k).catch(() => {});
        res.status(r2.status).json({ error: r2.error, message: r2.message });
        return;
      }
      secondImageKey = r2.key;
      createdKeys.push(r2.key);
    }
  } catch (srcErr) {
    for (const k of createdKeys) deleteFromS3(k).catch(() => {});
    log.error('Video source resolution failed', {
      userId,
      error: srcErr instanceof Error ? srcErr.message : String(srcErr),
    });
    res
      .status(500)
      .json({ error: 'SOURCE_FAILED', message: 'Could not prepare your image. Please try again.' });
    return;
  }

  const jobId = uuidv4();

  // Same soft per-user throttle as creation (parity): bursts beyond the tier free
  // quota get a short BullMQ delay so rapid-fire submissions are paced. Video is
  // a heavier Grok call than an image, so pacing matters at least as much.
  // Counts all non-FAILED creations (images + videos share the window) and
  // honors User.throttleResetAt, so a credit purchase clears the queue here too.
  const throttle = await computeQueueDelayMs(userId, user.tier);
  const scheduledStartAt = throttle.delayMs > 0 ? new Date(Date.now() + throttle.delayMs) : null;
  if (throttle.delayMs > 0) {
    log.info('Video submission throttled', {
      userId,
      tier: user.tier,
      ordinal: throttle.ordinal,
      burst: throttle.burst,
      delayMs: throttle.delayMs,
      jobId,
    });
  }

  // Charge credits + create the job row atomically, under a user-row lock so
  // concurrent submits can't overspend. Conditional decrement is belt-and-braces.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const deducted = await tx.user.updateMany({
        where: { id: userId, credits: { gte: creditCost } },
        data: { credits: { decrement: creditCost } },
      });
      if (deducted.count === 0) throw new InsufficientCreditsError();
      await tx.creation.create({
        data: {
          id: jobId,
          userId,
          kind: 'VIDEO',
          isPrivate,
          title,
          motionPrompt,
          sourceImageUrl: sourceImageKey,
          // The optional second/transition image is stored here (unused for
          // videos otherwise) so it's presigned + cleaned up like any job key.
          refImage1Url: secondImageKey,
          perspectivesUsed: [],
          creditsAtTime: user.credits,
          // Null when not throttled; drives the client's "starts in M:SS" countdown.
          scheduledStartAt,
        },
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'USAGE',
          amount: -creditCost,
          description: `Video generation (video=${jobId})`,
        },
      });
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      for (const k of createdKeys) deleteFromS3(k).catch(() => {});
      res
        .status(403)
        .json({ error: 'SUBSCRIPTION_REQUIRED', message: 'Not enough credits.', creditCost });
      return;
    }
    throw err;
  }

  try {
    await enqueueVideo(
      {
        jobId,
        userId,
        sourceImageKey,
        referenceImageKeys: secondImageKey ? [secondImageKey] : undefined,
        motionPrompt,
        creditCost,
      },
      throttle.delayMs,
    );
  } catch (enqueueErr) {
    log.error('Failed to enqueue video — rolling back', {
      userId,
      jobId,
      error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
    });
    try {
      await prisma.$transaction([
        prisma.creation.update({
          where: { id: jobId },
          data: { status: 'FAILED', errorMessage: 'Could not queue your video. Please try again.' },
        }),
        prisma.user.update({ where: { id: userId }, data: { credits: { increment: creditCost } } }),
        prisma.creditTransaction.create({
          data: {
            userId,
            type: 'REFUND',
            amount: creditCost,
            description: `Refund: enqueue failed (video=${jobId})`,
          },
        }),
      ]);
    } catch (rbErr) {
      log.error('Rollback after video enqueue failure also failed', {
        jobId,
        error: rbErr instanceof Error ? rbErr.message : String(rbErr),
      });
    }
    for (const k of createdKeys) deleteFromS3(k).catch(() => {});
    res.status(503).json({
      error: 'QUEUE_UNAVAILABLE',
      message: 'Could not start your video right now. Please try again.',
    });
    return;
  }

  res.status(202).json({
    jobId,
    status: 'PENDING',
    creditCost,
    scheduledStartAt,
    queueDelayMs: throttle.delayMs,
  });
}

// GET /api/video — the caller's completed videos, newest first (presigned).
export async function getVideoHistory(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
  const limit = 20;

  const jobs = await prisma.creation.findMany({
    where: { userId: req.user.userId, kind: 'VIDEO', status: 'COMPLETE' },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });

  res.json({ jobs: await presignCreations(jobs), page });
}
