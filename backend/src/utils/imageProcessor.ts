import sharp from 'sharp';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('ImageProcessor');

// Target size for the long edge sent to the AI pipeline. Verified empirically
// (B3, 2026-06-10): Grok Imagine outputs a FIXED 864×1152 canvas regardless of
// input resolution, and a 1504px clothing input produced no visible quality
// gain over 1024px. Raising this only inflates S3 storage and Grok payloads.
const MAX_LONG_SIDE = 1024;

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Resize image so the longest side is 1024px while maintaining aspect ratio.
 * Converts to JPEG for consistent output.
 */
export async function resizeImageForGeneration(inputBuffer: Buffer): Promise<ProcessedImage> {
  try {
    // Get original image metadata
    const metadata = await sharp(inputBuffer).metadata();

    // Check for unsupported formats (Sharp may report heif but not support decoding it)
    const format = metadata.format as string;
    if (format === 'heif' || format === 'heic') {
      throw new Error('HEIF/HEIC format not supported. Please convert to JPEG before uploading.');
    }

    // Resize so the longest side is 1024px, aspect ratio preserved
    // Sharp will automatically calculate the other dimension
    const outputBuffer = await sharp(inputBuffer)
      .rotate() // Auto-rotate based on EXIF orientation first
      .resize(MAX_LONG_SIDE, MAX_LONG_SIDE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    // Get final dimensions
    const outputMetadata = await sharp(outputBuffer).metadata();

    // Structured (Winston) so incoming-upload stats are queryable from the
    // combined logs — answers "what do real uploads look like" over time
    // (B3 instrumentation; the old console.log lines only hit docker stdout).
    log.info('Upload image processed', {
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      originalBytes: inputBuffer.length,
      originalFormat: format,
      outputWidth: outputMetadata.width,
      outputHeight: outputMetadata.height,
      outputBytes: outputBuffer.length,
    });

    return {
      buffer: outputBuffer,
      mimeType: 'image/jpeg',
      width: outputMetadata.width || 0,
      height: outputMetadata.height || 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error processing upload image', { error: errorMsg, inputBytes: inputBuffer.length });

    // Provide user-friendly error for common issues
    if (
      errorMsg.includes('heif') ||
      errorMsg.includes('HEIF') ||
      errorMsg.includes('compression format')
    ) {
      throw new Error('Unsupported image format (HEIF/HEIC). Please use JPEG or PNG.');
    }

    throw error;
  }
}

/**
 * Resize image for avatar/profile display (square, smaller)
 */
export async function resizeImageForAvatar(inputBuffer: Buffer): Promise<ProcessedImage> {
  const outputBuffer = await sharp(inputBuffer)
    // EXIF auto-rotate FIRST: with rotate() after resize(), the square cover
    // crop was computed on the un-rotated axes, cropping the wrong region of
    // portrait photos taken with EXIF orientation (fixed 2026-06-10).
    .rotate()
    .resize({
      width: 512,
      height: 512,
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  log.info('Avatar image processed', {
    originalBytes: inputBuffer.length,
    outputBytes: outputBuffer.length,
  });

  return {
    buffer: outputBuffer,
    mimeType: 'image/jpeg',
    width: 512,
    height: 512,
  };
}
