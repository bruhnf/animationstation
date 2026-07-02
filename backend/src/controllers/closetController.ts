import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { uploadToS3, deleteFromS3, keyFromUrl } from '../services/s3Service';
import { presignClosetItem, presignClosetItems } from '../services/imageUrlService';
import {
  generateImageFromText,
  cleanupClothingImage,
  downloadGeneratedImage,
  ContentModeratedError,
} from '../services/grokService';
import { resizeImageForGeneration } from '../utils/imageProcessor';
import {
  validateOutfitDescription,
  buildOutfitPrompt,
  validateCleanupInstruction,
  deriveItemName,
  randomOutfitIdea,
  CLOSET_ITEM_NAME_MAX,
} from '../utils/outfitPrompt';
import { recordModerationStrike } from '../services/moderationService';
import { MODERATION_GRACE_WARNINGS } from '../utils/moderationGrace';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('ClosetController');

// Per-user cap on stored closet items. Generated outfits are ~100-200 KB each;
// the cap bounds both storage and the list-endpoint payload.
export const CLOSET_ITEM_LIMIT = 100;

// Every generation is one Grok Imagine call, so it costs 1 credit — closet
// generations are NOT covered by the subscription weekly creation allowance
// (that allowance meters creations, which this is not).
const GENERATION_CREDIT_COST = 1;

// Thrown inside the charge transaction when the conditional decrement matches
// no row (concurrent requests drained the balance). Mirrors creationsController.
class InsufficientCreditsError extends Error {}

/**
 * GET /api/closet/surprise — return a random, ready-to-edit outfit description
 * for the designer's "Surprise me" button. Pure combinatorial generation (no
 * Grok, no credit, no DB) so it's instant and free; the returned text still
 * flows through validate + buildOutfitPrompt when the user hits Generate.
 */
export function surpriseOutfit(_req: Request, res: Response): void {
  res.json({ prompt: randomOutfitIdea() });
}

/**
 * POST /api/closet/generate — body: { description }
 *
 * Flow mirrors submitTransform's money-safety rules:
 *   validate + cap checks (free) → charge 1 credit (transactional, conditional)
 *   → Grok call → store image + row. Any failure after the charge refunds;
 *   a moderation block applies the same strike + grace policy as creation.
 */
export async function generateOutfit(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId } = req.user;

  const validation = validateOutfitDescription(req.body?.description);
  if (!validation.ok) {
    res.status(400).json({ error: 'INVALID_DESCRIPTION', message: validation.error });
    return;
  }
  const description = validation.cleaned;

  const itemCount = await prisma.closetItem.count({ where: { userId } });
  if (itemCount >= CLOSET_ITEM_LIMIT) {
    res.status(403).json({
      error: 'CLOSET_FULL',
      message: `Your closet is full (${CLOSET_ITEM_LIMIT} items). Delete some items to design more.`,
      limit: CLOSET_ITEM_LIMIT,
    });
    return;
  }

  // Pre-allocate the item id so the charge can be tagged for the refund path.
  const itemId = uuidv4();

  // Charge BEFORE the Grok call (conditional decrement under a row lock —
  // concurrent generations can't drive the balance negative). Refunded below
  // on any failure.
  try {
    await prisma.$transaction(async (tx) => {
      const deducted = await tx.user.updateMany({
        where: { id: userId, credits: { gte: GENERATION_CREDIT_COST } },
        data: { credits: { decrement: GENERATION_CREDIT_COST } },
      });
      if (deducted.count === 0) throw new InsufficientCreditsError();
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'USAGE',
          amount: -GENERATION_CREDIT_COST,
          description: `Outfit generation (closet=${itemId})`,
        },
      });
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      res.status(403).json({
        error: 'INSUFFICIENT_CREDITS',
        message: 'Designing an outfit costs 1 credit. Purchase credits to continue.',
      });
      return;
    }
    throw err;
  }

  const refund = async (reason: string) => {
    try {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { credits: { increment: GENERATION_CREDIT_COST } },
        }),
        prisma.creditTransaction.create({
          data: {
            userId,
            type: 'REFUND',
            amount: GENERATION_CREDIT_COST,
            description: `Refund: ${reason} (closet=${itemId})`,
          },
        }),
      ]);
    } catch (refundErr) {
      // A failed refund is silently-lost user money — page it, don't just log it.
      log.error('Outfit-generation refund failed', {
        userId,
        itemId,
        reason,
        error: refundErr instanceof Error ? refundErr.message : String(refundErr),
      });
      Sentry.captureException(refundErr, {
        tags: { area: 'closet-generate-refund' },
        extra: { userId, itemId, reason },
      });
    }
  };

  try {
    const prompt = buildOutfitPrompt(description);
    const resultRef = await generateImageFromText(prompt);

    // Normalize through the same pipeline as uploaded clothing photos (1024px
    // long side, JPEG) so creations from the closet behave identically.
    const raw = await downloadGeneratedImage(resultRef);
    const processed = await resizeImageForGeneration(raw);
    const key = await uploadToS3(
      'closet',
      userId,
      `${itemId}.jpg`,
      processed.buffer,
      processed.mimeType,
    );

    const item = await prisma.closetItem.create({
      data: {
        id: itemId,
        userId,
        name: deriveItemName(description),
        description,
        imageUrl: key,
      },
    });

    log.info('Closet item generated', { userId, itemId, descriptionLength: description.length });
    res.status(201).json(await presignClosetItem(item));
  } catch (err) {
    if (err instanceof ContentModeratedError) {
      // Same policy as creation: record a strike; the first
      // MODERATION_GRACE_WARNINGS strikes are refunded warnings, repeat
      // offenders stop being refunded (ToS §5.4). A null count (bookkeeping
      // failed) falls back to no-refund.
      const strikeCount = await recordModerationStrike(userId, `closet:${itemId}`);
      const withinGrace = strikeCount !== null && strikeCount <= MODERATION_GRACE_WARNINGS;
      if (withinGrace) await refund('outfit blocked by content policy (warning)');
      log.warn('Outfit generation content-moderated', { userId, itemId, strikeCount, withinGrace });
      res.status(422).json({
        error: 'CONTENT_MODERATED',
        message: withinGrace
          ? `This description was blocked by our AI provider's content policy. AnimationStation blocks sexually explicit or pornographic content. Your credit was refunded (warning ${strikeCount} of ${MODERATION_GRACE_WARNINGS}).`
          : "This description was blocked by our AI provider's content policy. AnimationStation blocks sexually explicit or pornographic content. Per our Terms, the credit for this attempt was not refunded.",
      });
      return;
    }

    await refund('outfit generation failed');
    log.error('Outfit generation failed', {
      userId,
      itemId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({
      error: 'GENERATION_FAILED',
      message:
        'Could not generate the outfit right now. Your credit was refunded — please try again.',
    });
  }
}

/**
 * POST /api/closet/cleanup — multipart field `photo`.
 *
 * "Clean Up" an uploaded clothing image into a catalog-style product shot and
 * save it to the closet. Same money-safety as generateOutfit (charge 1 credit,
 * refund on any failure, moderation strike/grace) — the only difference is the
 * Grok input is the user's image + a fixed cleanup prompt instead of free text.
 */
export async function cleanupOutfit(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId } = req.user;

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'NO_PHOTO', message: 'Attach a photo to clean up.' });
    return;
  }

  // Optional custom styling instruction (multipart text field `prompt`).
  // Sanitized + denylisted BEFORE any credit is spent; empty = base cleanup only.
  const instructionResult = validateCleanupInstruction(req.body?.prompt);
  if (!instructionResult.ok) {
    res.status(400).json({ error: 'INVALID_INSTRUCTION', message: instructionResult.error });
    return;
  }
  const cleanedInstruction = instructionResult.cleaned;

  const itemCount = await prisma.closetItem.count({ where: { userId } });
  if (itemCount >= CLOSET_ITEM_LIMIT) {
    res.status(403).json({
      error: 'CLOSET_FULL',
      message: `Your closet is full (${CLOSET_ITEM_LIMIT} items). Delete some items to add more.`,
      limit: CLOSET_ITEM_LIMIT,
    });
    return;
  }

  const itemId = uuidv4();

  // Charge before the Grok call (conditional decrement under a row lock).
  try {
    await prisma.$transaction(async (tx) => {
      const deducted = await tx.user.updateMany({
        where: { id: userId, credits: { gte: GENERATION_CREDIT_COST } },
        data: { credits: { decrement: GENERATION_CREDIT_COST } },
      });
      if (deducted.count === 0) throw new InsufficientCreditsError();
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'USAGE',
          amount: -GENERATION_CREDIT_COST,
          description: `Outfit cleanup (closet=${itemId})`,
        },
      });
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      res.status(403).json({
        error: 'INSUFFICIENT_CREDITS',
        message: 'Cleaning up a photo costs 1 credit. Purchase credits to continue.',
      });
      return;
    }
    throw err;
  }

  const refund = async (reason: string) => {
    try {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { credits: { increment: GENERATION_CREDIT_COST } },
        }),
        prisma.creditTransaction.create({
          data: {
            userId,
            type: 'REFUND',
            amount: GENERATION_CREDIT_COST,
            description: `Refund: ${reason} (closet=${itemId})`,
          },
        }),
      ]);
    } catch (refundErr) {
      log.error('Outfit-cleanup refund failed', {
        userId,
        itemId,
        reason,
        error: refundErr instanceof Error ? refundErr.message : String(refundErr),
      });
      Sentry.captureException(refundErr, {
        tags: { area: 'closet-cleanup-refund' },
        extra: { userId, itemId, reason },
      });
    }
  };

  try {
    // Normalize the upload (1024px long side, JPEG) before sending to Grok, and
    // again on the result, so the closet item matches generated items exactly.
    const input = await resizeImageForGeneration(file.buffer);
    const resultRef = await cleanupClothingImage(input.buffer, input.mimeType, cleanedInstruction);
    const raw = await downloadGeneratedImage(resultRef);
    const processed = await resizeImageForGeneration(raw);
    const key = await uploadToS3(
      'closet',
      userId,
      `${itemId}.jpg`,
      processed.buffer,
      processed.mimeType,
    );

    const item = await prisma.closetItem.create({
      data: {
        id: itemId,
        userId,
        // Name/describe from the custom instruction when given, else a default.
        name: cleanedInstruction ? deriveItemName(cleanedInstruction) : 'Cleaned-up outfit',
        description: cleanedInstruction || 'Cleaned up from an uploaded photo',
        imageUrl: key,
      },
    });

    log.info('Closet item cleaned up', { userId, itemId });
    res.status(201).json(await presignClosetItem(item));
  } catch (err) {
    if (err instanceof ContentModeratedError) {
      const strikeCount = await recordModerationStrike(userId, `cleanup:${itemId}`);
      const withinGrace = strikeCount !== null && strikeCount <= MODERATION_GRACE_WARNINGS;
      if (withinGrace) await refund('cleanup blocked by content policy (warning)');
      log.warn('Outfit cleanup content-moderated', { userId, itemId, strikeCount, withinGrace });
      res.status(422).json({
        error: 'CONTENT_MODERATED',
        message: withinGrace
          ? `This image was blocked by our AI provider's content policy. AnimationStation blocks sexually explicit or pornographic content. Your credit was refunded (warning ${strikeCount} of ${MODERATION_GRACE_WARNINGS}).`
          : "This image was blocked by our AI provider's content policy. AnimationStation blocks sexually explicit or pornographic content. Per our Terms, the credit for this attempt was not refunded.",
      });
      return;
    }

    await refund('outfit cleanup failed');
    log.error('Outfit cleanup failed', {
      userId,
      itemId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({
      error: 'CLEANUP_FAILED',
      message:
        'Could not clean up the photo right now. Your credit was refunded — please try again.',
    });
  }
}

export async function listCloset(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const items = await prisma.closetItem.findMany({
    where: { userId: req.user.userId },
    orderBy: { createdAt: 'desc' },
    take: CLOSET_ITEM_LIMIT,
  });

  res.json({
    items: await presignClosetItems(items),
    count: items.length,
    limit: CLOSET_ITEM_LIMIT,
  });
}

export async function renameClosetItem(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name.length === 0 || name.length > CLOSET_ITEM_NAME_MAX) {
    res.status(400).json({ error: `name must be 1–${CLOSET_ITEM_NAME_MAX} characters` });
    return;
  }

  // updateMany so the userId filter enforces ownership at the DB level.
  const updated = await prisma.closetItem.updateMany({
    where: { id: req.params.itemId, userId: req.user.userId },
    data: { name },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: 'Closet item not found' });
    return;
  }
  const item = await prisma.closetItem.findUnique({ where: { id: req.params.itemId } });
  res.json(item ? await presignClosetItem(item) : { id: req.params.itemId, name });
}

export async function deleteClosetItem(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId } = req.user;

  const item = await prisma.closetItem.findFirst({
    where: { id: req.params.itemId, userId },
    select: { id: true, imageUrl: true },
  });
  if (!item) {
    res.status(404).json({ error: 'Closet item not found' });
    return;
  }

  await prisma.closetItem.delete({ where: { id: item.id } });

  // Safe to delete the S3 object: creations COPY the image into ref-images/
  // at submit time, so nothing else references closet keys. Fire-and-forget —
  // the weekly orphan scan backstops a miss.
  deleteFromS3(keyFromUrl(item.imageUrl)).catch((err) => {
    log.warn('S3 delete failed for closet item', {
      userId,
      itemId: item.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  res.json({ deleted: true });
}
