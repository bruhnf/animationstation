import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { uploadToS3, deleteFromS3, keyFromUrl } from '../services/s3Service';
import { presignUserPhotos } from '../services/imageUrlService';
import { getPresignedUrl } from '../services/s3Service';
import { safeFilename } from '../middleware/uploadMiddleware';
import { resizeImageForTryOn, resizeImageForAvatar } from '../utils/imageProcessor';
import { createChildLogger, logUpload } from '../services/logger';

const log = createChildLogger('UploadController');

type BodyPhotoField = 'avatarUrl' | 'fullBodyUrl' | 'mediumBodyUrl';

// A body photo being deleted may still be referenced by the user's historical
// try-on jobs as the "original input" display slide (TryOnJob.bodyPhotoUrl).
// Null those references in the same operation, BEFORE the S3 object goes away,
// so clients never render a slide whose object is permanently gone (2026-06-11
// incident: feed carousels showed an unfixable "Tap to reload" for weeks-old
// posts after the owner replaced their body photos). Matches both storage
// forms: bare S3 key (current rows) and legacy full-URL rows ending in the key.
async function detachJobBodyPhotoRefs(userId: string, key: string): Promise<void> {
  try {
    const detached = await prisma.tryOnJob.updateMany({
      where: {
        userId,
        OR: [{ bodyPhotoUrl: key }, { bodyPhotoUrl: { endsWith: `/${key.replace(/^\/+/, '')}` } }],
      },
      data: { bodyPhotoUrl: null },
    });
    if (detached.count > 0) {
      log.info('Detached body-photo references from historical try-on jobs', {
        userId,
        key,
        jobsDetached: detached.count,
      });
    }
  } catch (err) {
    // Never block the photo operation on this bookkeeping; a missed detach
    // degrades to the old behavior (dead slide) rather than a failed request.
    log.error('Failed to detach job body-photo references', {
      userId,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleBodyPhotoUpload(
  req: Request,
  res: Response,
  field: BodyPhotoField,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const { userId } = req.user;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Delete old photo from S3 if it exists. Historical try-on jobs may still
  // reference it for display — detach those references first (full/medium
  // body photos are the only fields jobs reference; avatars never are).
  const oldUrl = user[field];
  if (oldUrl) {
    const oldKey = keyFromUrl(oldUrl);
    if (field !== 'avatarUrl') {
      await detachJobBodyPhotoRefs(userId, oldKey);
    }
    deleteFromS3(oldKey).catch((err) => {
      log.error('Failed to delete old photo from S3', { userId, field, error: err.message });
    });
  }

  // Resize image before upload
  // Avatar gets square crop, body photos get 576x1024 portrait resize
  let processedBuffer: Buffer;
  let mimeType: string;

  try {
    if (field === 'avatarUrl') {
      const processed = await resizeImageForAvatar(req.file.buffer);
      processedBuffer = processed.buffer;
      mimeType = processed.mimeType;
    } else {
      const processed = await resizeImageForTryOn(req.file.buffer);
      processedBuffer = processed.buffer;
      mimeType = processed.mimeType;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Image processing failed';
    logUpload('failed', {
      userId,
      fileType: field,
      fileName: req.file.originalname,
      success: false,
      error: errorMsg,
    });
    res.status(400).json({
      error: 'Image processing failed',
      message:
        errorMsg.includes('HEIF') || errorMsg.includes('format')
          ? 'Unsupported image format. Please use JPEG or PNG.'
          : 'Could not process image. Please try a different photo.',
    });
    return;
  }

  // Always use .jpg extension since we convert to JPEG
  const baseFilename = safeFilename(req.file.originalname).replace(/\.[^/.]+$/, '');
  const filename = `${uuidv4()}-${baseFilename}.jpg`;
  const key = await uploadToS3('body-photos', userId, filename, processedBuffer, mimeType);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { [field]: key },
    select: { avatarUrl: true, fullBodyUrl: true, mediumBodyUrl: true },
  });

  const presigned = await presignUserPhotos(updated);
  res.json({ url: await getPresignedUrl(key), photos: presigned });
}

async function handleBodyPhotoDelete(
  req: Request,
  res: Response,
  field: BodyPhotoField,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { userId } = req.user;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const url = user[field];
  if (url) {
    const oldKey = keyFromUrl(url);
    if (field !== 'avatarUrl') {
      await detachJobBodyPhotoRefs(userId, oldKey);
    }
    deleteFromS3(oldKey).catch((err) => {
      log.error('Failed to delete photo from S3', { userId, field, error: err.message });
    });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { [field]: null },
    select: { avatarUrl: true, fullBodyUrl: true, mediumBodyUrl: true },
  });

  res.json({ photos: await presignUserPhotos(updated) });
}

export const uploadAvatar = (req: Request, res: Response) =>
  handleBodyPhotoUpload(req, res, 'avatarUrl');

export const uploadFullBody = (req: Request, res: Response) =>
  handleBodyPhotoUpload(req, res, 'fullBodyUrl');

export const uploadMediumBody = (req: Request, res: Response) =>
  handleBodyPhotoUpload(req, res, 'mediumBodyUrl');

export const deleteAvatar = (req: Request, res: Response) =>
  handleBodyPhotoDelete(req, res, 'avatarUrl');

export const deleteFullBody = (req: Request, res: Response) =>
  handleBodyPhotoDelete(req, res, 'fullBodyUrl');

export const deleteMediumBody = (req: Request, res: Response) =>
  handleBodyPhotoDelete(req, res, 'mediumBodyUrl');
