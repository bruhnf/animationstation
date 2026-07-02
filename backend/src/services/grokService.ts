import sharp from 'sharp';
import { env } from '../config/env';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createChildLogger, logExternalCall } from './logger';
import { classifyVideoPoll } from '../utils/videoPoll';
import { nearestVideoAspectRatio } from '../utils/videoAspect';
import { buildCleanupPrompt } from '../utils/outfitPrompt';

const log = createChildLogger('GrokService');

const s3 = new S3Client({
  region: env.aws.region,
  credentials: env.aws.accessKeyId
    ? { accessKeyId: env.aws.accessKeyId, secretAccessKey: env.aws.secretAccessKey }
    : undefined,
});

export type CreationPerspective = 'full_body' | 'medium';

export interface CreationInput {
  // The reference image(s) the user is transforming. At least one; all are sent
  // to the model and preserved as the subject(s).
  clothingImageUrls: string[];
  // Optional free-form prompt threaded through the compose path (feature 2).
  // When present it drives the requested scene/style; when absent a neutral
  // enhance/combine instruction is used.
  userPrompt?: string;
  // Optional legacy body-photo input, prepended as the primary subject when
  // present. AnimationStation's free-form transform has no body photos, so this
  // is normally undefined; retained only for signature/back-compat.
  userBodyImageUrl?: string;
  // Optional perspective label; no longer scopes framing (free-form), kept so
  // callers can tag logs / result slots.
  perspective?: CreationPerspective;
  // Optional output aspect ratio (e.g. '16:9', '2:3'). Validated upstream
  // against VALID_IMAGE_ASPECTS; omitted → the model picks per prompt/source.
  aspectRatio?: string | null;
}

// Aspect ratios the create UI offers (mirrors Grok Imagine's own picker).
// Controllers validate request values against this set; anything else is
// ignored rather than rejected so an older/newer client can't hard-fail.
export const VALID_IMAGE_ASPECTS = new Set(['2:3', '3:2', '1:1', '9:16', '16:9']);

export interface CreationOutput {
  perspective: CreationPerspective;
  resultImageUrl: string;
}

export function detectImageFormat(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // Check for WEBP signature at offset 8
    if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return 'webp';
    }
  }
  return null;
}

/**
 * Resolves the input — which may be an S3 key (e.g. "source-images/<uid>/<file>.jpg"),
 * a legacy public URL, or a fully-qualified non-S3 URL — into an S3 key, or null
 * if it's a non-S3 HTTP URL that should be fetched via plain HTTP.
 */
export function resolveS3Key(ref: string, bucket: string): string | null {
  if (!ref.startsWith('http://') && !ref.startsWith('https://')) {
    // Bare key — what new rows store after the lockdown.
    return ref.replace(/^\//, '');
  }
  // Legacy URL — extract key if it points at our bucket.
  if (ref.includes(bucket) || ref.includes('.s3.') || ref.includes('s3.amazonaws.com')) {
    try {
      const urlObj = new URL(ref.split('?')[0]);
      return urlObj.pathname.replace(/^\//, '');
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchImageAsBase64(
  ref: string,
  label: string,
): Promise<{ base64: string; mimeType: string }> {
  log.debug('Fetching image', { label, ref: ref.substring(0, 100) });

  const bucket = env.aws.s3Bucket;
  let buffer: Buffer;
  let contentType = '';

  const s3Key = resolveS3Key(ref, bucket);

  if (s3Key) {
    log.debug('Resolved as S3 key, using SDK direct fetch', { label, key: s3Key });
    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
      const response = await s3.send(command);
      const bodyContents = await response.Body?.transformToByteArray();

      if (!bodyContents) {
        throw new Error('S3 returned empty body');
      }

      buffer = Buffer.from(bodyContents);
      contentType = response.ContentType || '';
      log.debug('S3 fetch success', { label, bytes: buffer.length, contentType });
    } catch (s3Error: any) {
      log.error('S3 SDK fetch failed', { label, error: s3Error.message });
      throw new Error(`Failed to fetch ${label} from S3: ${s3Error.message}`);
    }
  } else {
    // Hardening: every body/clothing ref is one of OUR S3 keys, set by our own
    // upload paths — never a user-supplied URL (legacy full-S3-URL rows still
    // resolve to a key above). Refuse to HTTP-fetch an arbitrary URL rather than
    // keep a latent SSRF surface here.
    log.error('Refusing to fetch non-S3 image ref', { label, refPreview: ref.substring(0, 80) });
    throw new Error(`${label} could not be resolved to an S3 key`);
  }

  log.debug('Image buffer details', {
    label,
    bufferSize: buffer.length,
    firstBytes: buffer.slice(0, 20).toString('hex'),
  });

  // Detect actual format from magic bytes
  const detectedFormat = detectImageFormat(buffer);
  log.debug('Image format detected', { label, format: detectedFormat || 'UNKNOWN' });

  if (!detectedFormat) {
    // Log what we actually got
    const preview = buffer.slice(0, 200).toString('utf8');
    log.error('Invalid image data', { label, contentType, preview: preview.substring(0, 100) });
    throw new Error(
      `${label} is not a valid image (got ${contentType}, first bytes suggest non-image data)`,
    );
  }

  const mimeType = `image/${detectedFormat}`;
  const base64 = buffer.toString('base64');

  log.debug('Image fetch complete', { label, mimeType, base64Length: base64.length });

  return { base64, mimeType };
}

/**
 * Thrown when xAI's content moderation blocks a generation (e.g. an attempt to
 * produce nude / sexual / revealing-attire imagery). Kept distinct from
 * transient technical failures so the creation worker can skip the credit refund
 * AND skip retries for a policy rejection (Terms of Service §5.4), while still
 * refunding genuine failures.
 *
 * Detection note: xAI does not publicly document the REST field for a blocked
 * result. What we know: a blocked response carries no image and the signal
 * contains the word "moderated" (the same wording Grok Imagine shows users). We
 * therefore match /moderat/i on the response body and log the full raw body on
 * any no-image response, so the first real moderation reveals the exact shape
 * and we can tighten this to the precise field.
 */
export class ContentModeratedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentModeratedError';
  }
}

// General multi-image composition prompt (AnimationStation feature 2). The
// reference images are provided to the model; the user's free-form prompt (when
// present) drives the requested scene/style while the reference subjects are
// preserved. `perspective` is retained for signature compatibility only and no
// longer scopes the framing.
function buildPrompt(perspective: CreationPerspective | undefined, userPrompt?: string): string {
  void perspective;
  const cleaned = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (cleaned) {
    return (
      `Create a photorealistic image based on the provided reference image(s) and this instruction: "${cleaned}". ` +
      'Preserve the key subject(s) from the reference image(s); apply the requested scene/style; ' +
      'coherent lighting and composition, high detail.'
    );
  }
  return (
    'Combine and enhance the provided reference image(s) into a single coherent, ' +
    'high-quality photorealistic image.'
  );
}

/**
 * Text-to-image generation. Used by BOTH the Outfit Designer (closet items —
 * pass the wrapped catalog prompt from utils/outfitPrompt.ts, default 3:4) and
 * the unified Create flow (sanitized free-form prompt + user-chosen aspect).
 * Returns the result image as a URL or data: URI, same contract as
 * generateTransformImage. Moderation blocks throw ContentModeratedError so the
 * caller can apply the strike/refund policy.
 */
export async function generateImageFromText(prompt: string, aspectRatio = '3:4'): Promise<string> {
  const endpoint = `${env.grok.apiUrl}/images/generations`;
  log.info('Text-to-image generation started', { promptLength: prompt.length, aspectRatio });

  const requestBody = {
    model: 'grok-imagine-image',
    prompt,
    n: 1,
    response_format: 'url',
    // Without this Grok picks an orientation per prompt. Callers pass the
    // user's chosen ratio (create UI) or 3:4 (closet cards / Grok's own
    // creation output canvas, 864×1152).
    aspect_ratio: aspectRatio,
  };

  const startTime = Date.now();
  // Single text-to-image call is much faster than an edit, but keep a generous
  // ceiling consistent with the creation call.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.grok.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;
    const responseBody = await response.text();
    const looksModerated = /moderat/i.test(responseBody);

    if (!response.ok) {
      logExternalCall('Grok', 'generateOutfit', {
        method: 'POST',
        url: endpoint,
        statusCode: response.status,
        durationMs,
        success: false,
        error: responseBody.substring(0, 500),
      });
      if (looksModerated) {
        log.warn('Grok content moderation block (outfit, error response)', {
          statusCode: response.status,
          body: responseBody.substring(0, 1000),
        });
        throw new ContentModeratedError(
          `Grok moderated the outfit request (HTTP ${response.status})`,
        );
      }
      throw new Error(`Grok API error ${response.status}: ${responseBody.substring(0, 300)}`);
    }

    const data = JSON.parse(responseBody) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const imageData = data.data?.[0];

    if (imageData?.url || imageData?.b64_json) {
      logExternalCall('Grok', 'generateOutfit', {
        method: 'POST',
        url: endpoint,
        statusCode: response.status,
        durationMs,
        success: true,
        resultType: imageData.url ? 'url' : 'base64',
      });
      log.info('Outfit generation completed', {
        durationMs,
        resultType: imageData.url ? 'url' : 'base64',
      });
      return imageData.url ?? `data:image/png;base64,${imageData.b64_json}`;
    }

    log.warn('Grok returned no outfit image — raw body for diagnosis', {
      statusCode: response.status,
      looksModerated,
      body: responseBody.substring(0, 2000),
    });
    logExternalCall('Grok', 'generateOutfit', {
      method: 'POST',
      url: endpoint,
      statusCode: response.status,
      durationMs,
      success: false,
      error: 'No image content in response',
    });
    if (looksModerated) {
      throw new ContentModeratedError('Grok moderated the outfit request (no image returned)');
    }
    throw new Error('Grok API returned no image content');
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError') {
      logExternalCall('Grok', 'generateOutfit', {
        method: 'POST',
        url: endpoint,
        durationMs: Date.now() - startTime,
        success: false,
        error: 'Request timed out after 90 seconds',
      });
      throw new Error('Grok API request timed out');
    }
    throw err;
  }
}

// Fixed server-side cleanup prompt. Turns a messy user upload (website
// screenshot with text/prices/UI, a photo of a person wearing the item, a
// cluttered scene) into a clean catalog-style product shot the creation pipeline
// can use. The instructions to strip people/text/logos also keep the output
// inside the same "ordinary clothing product shot" envelope the Outfit Designer
// enforces, so the moderation posture is unchanged.
/**
 * "Clean Up" an uploaded clothing image into a catalog-style product shot via a
 * single Grok image-edit call. Used by the closet cleanup endpoint. An OPTIONAL
 * `cleanedInstruction` (already sanitized by validateCleanupInstruction) is
 * embedded in the fixed base prompt via buildCleanupPrompt. Returns the result
 * as a URL or data: URI; a moderation block throws ContentModeratedError so the
 * caller can apply the same strike/refund policy as generate/creation.
 */
export async function cleanupClothingImage(
  imageBuffer: Buffer,
  mimeType: string,
  cleanedInstruction = '',
): Promise<string> {
  const endpoint = `${env.grok.apiUrl}/images/edits`;
  log.info('Clothing cleanup started', {
    bytes: imageBuffer.length,
    mimeType,
    hasInstruction: cleanedInstruction.length > 0,
  });

  const requestBody = {
    model: 'grok-imagine-image',
    prompt: buildCleanupPrompt(cleanedInstruction),
    images: [{ url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` }],
    n: 1,
    response_format: 'url',
  };

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.grok.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;
    const responseBody = await response.text();
    const looksModerated = /moderat/i.test(responseBody);

    if (!response.ok) {
      logExternalCall('Grok', 'cleanupClothing', {
        method: 'POST',
        url: endpoint,
        statusCode: response.status,
        durationMs,
        success: false,
        error: responseBody.substring(0, 500),
      });
      if (looksModerated) {
        log.warn('Grok content moderation block (cleanup, error response)', {
          statusCode: response.status,
          body: responseBody.substring(0, 1000),
        });
        throw new ContentModeratedError(
          `Grok moderated the cleanup request (HTTP ${response.status})`,
        );
      }
      throw new Error(`Grok API error ${response.status}: ${responseBody.substring(0, 300)}`);
    }

    const data = JSON.parse(responseBody) as { data?: Array<{ url?: string; b64_json?: string }> };
    const imageData = data.data?.[0];
    if (imageData?.url || imageData?.b64_json) {
      logExternalCall('Grok', 'cleanupClothing', {
        method: 'POST',
        url: endpoint,
        statusCode: response.status,
        durationMs,
        success: true,
        resultType: imageData.url ? 'url' : 'base64',
      });
      log.info('Clothing cleanup completed', {
        durationMs,
        resultType: imageData.url ? 'url' : 'base64',
      });
      return imageData.url ?? `data:image/png;base64,${imageData.b64_json}`;
    }

    log.warn('Grok returned no cleanup image — raw body for diagnosis', {
      statusCode: response.status,
      looksModerated,
      body: responseBody.substring(0, 2000),
    });
    if (looksModerated) {
      throw new ContentModeratedError('Grok moderated the cleanup request (no image returned)');
    }
    throw new Error('Grok API returned no image content');
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError') {
      logExternalCall('Grok', 'cleanupClothing', {
        method: 'POST',
        url: endpoint,
        durationMs: Date.now() - startTime,
        success: false,
        error: 'Request timed out after 90 seconds',
      });
      throw new Error('Grok API request timed out');
    }
    throw err;
  }
}

/**
 * Resolve a generation result (https URL or data: URI) into image bytes.
 * Mirrors the creation worker's download step; exported so the closet
 * controller can reuse it.
 */
export async function downloadGeneratedImage(resultRef: string): Promise<Buffer> {
  if (resultRef.startsWith('data:')) {
    const base64 = resultRef.slice(resultRef.indexOf(',') + 1);
    return Buffer.from(base64, 'base64');
  }
  const response = await fetch(resultRef);
  if (!response.ok) {
    throw new Error(
      `Failed to download generated image: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Image-to-video (Grok Imagine video). Async: POST /videos/generations returns
// a request_id; we poll GET /videos/{request_id} until status === 'done', then
// return the result video URL. Contract per
// https://docs.x.ai/developers/model-capabilities/video/image-to-video
// ---------------------------------------------------------------------------

export interface VideoGenOptions {
  durationSec?: number; // 1–15, default 8
  aspectRatio?: string; // e.g. "3:4"
  resolution?: '480p' | '720p' | '1080p';
  // Optional additional image(s) (S3 keys / refs) sent as xAI `reference_images`
  // — used for the "transition between two images" feature: the prompt describes
  // the transition and this is the target/reference. (xAI has no literal
  // first→last-frame interpolation; this is the supported reference-to-video path.)
  referenceImageRefs?: string[];
}

// How long we'll wait for a video to finish before giving up (transient failure
// → refund + retry semantics, same as a creation technical failure).
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_WAIT_MS = 6 * 60 * 1000; // 6 minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Animate a source image into a short video. `imageRef` is an S3 key (preferred)
 * or legacy full URL — fetched and inlined as a data URI, never sent as an
 * arbitrary URL (same SSRF-safe posture as the creation path). `motionPrompt` is
 * the user's animation instruction. Returns the result video URL (https) on
 * success; throws ContentModeratedError on a policy block and a plain Error on
 * any transient/technical failure (so the worker refunds + retries like creation).
 */
export async function generateVideo(
  imageRef: string,
  motionPrompt: string,
  opts: VideoGenOptions = {},
): Promise<string> {
  const submitUrl = `${env.grok.apiUrl}/videos/generations`;
  const refRefs = opts.referenceImageRefs ?? [];
  // xAI treats `image` (image-to-video) and `reference_images` (reference-to-
  // video) as MUTUALLY EXCLUSIVE — sending both is a 400 invalid-argument.
  //   • 0 extra images → I2V: a single `image`, prompt-driven animation.
  //   • 1+ extra images (the "transition between two images" feature) → R2V:
  //     ALL images go in `reference_images` (no `image`), and the prompt
  //     describes the transition/blend between them.
  const useR2V = refRefs.length > 0;

  const toDataUri = async (ref: string, label: string) => {
    const img = await fetchImageAsBase64(ref, label);
    return `data:${img.mimeType};base64,${img.base64}`;
  };

  // Fetch the PRIMARY source once so we can both inline it AND measure its aspect
  // ratio. We must tell Grok the aspect that matches the source — its default is
  // 16:9, so a portrait creation/body photo would come back squished. (R2V uses the
  // first image's aspect as the output frame.)
  const primary = await fetchImageAsBase64(
    imageRef,
    useR2V ? 'video-reference-image-1' : 'video-source-image',
  );
  const primaryDataUri = `data:${primary.mimeType};base64,${primary.base64}`;
  let sourceAspect: string | undefined;
  try {
    const meta = await sharp(Buffer.from(primary.base64, 'base64')).metadata();
    sourceAspect = nearestVideoAspectRatio(meta.width, meta.height);
  } catch {
    // measurement failed — fall through to the portrait default below
  }

  const common = {
    model: 'grok-imagine-video',
    prompt: motionPrompt,
    duration: opts.durationSec ?? 8,
    aspect_ratio: opts.aspectRatio ?? sourceAspect ?? '3:4',
    resolution: opts.resolution ?? '720p',
  };

  let requestBody: Record<string, unknown>;
  if (useR2V) {
    // Primary already fetched above; fetch the remaining transition image(s).
    const restRefs = await Promise.all(
      refRefs.map(async (ref, i) => ({
        url: await toDataUri(ref, `video-reference-image-${i + 2}`),
      })),
    );
    requestBody = { ...common, reference_images: [{ url: primaryDataUri }, ...restRefs] };
  } else {
    requestBody = { ...common, image: { url: primaryDataUri } };
  }

  log.info('Video generation submit', {
    promptLength: motionPrompt.length,
    duration: common.duration,
    aspectRatio: common.aspect_ratio,
    mode: useR2V ? 'R2V' : 'I2V',
    referenceImages: useR2V ? refRefs.length + 1 : 0,
  });

  // --- Submit ---
  const submitStart = Date.now();
  const submitController = new AbortController();
  const submitTimeout = setTimeout(() => submitController.abort(), 60000);
  let requestId: string;
  try {
    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.grok.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: submitController.signal,
    });
    clearTimeout(submitTimeout);
    const body = await res.text();
    // Moderation detection at submit. The structured `respect_moderation === false`
    // flag is the primary signal and is safe on ANY body. A substring match on
    // "moderat" is ALSO used, but ONLY on an error (non-2xx) body — there it
    // matches Grok's real block shape `400 {"error":"...rejected by content
    // moderation."}`, exactly as the image paths (generateImage / outfit /
    // cleanup) do. It is deliberately NOT applied to a success body or the poll
    // response, where `respect_moderation: true` is a normal field whose NAME a
    // substring match would wrongly flag (the original "discarded every good
    // video" bug — see utils/videoPoll.ts).
    let parsed: { request_id?: string; respect_moderation?: boolean } = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* non-JSON error body */
    }
    const moderationFailed = parsed.respect_moderation === false;
    if (!res.ok) {
      logExternalCall('Grok', 'submitVideo', {
        method: 'POST',
        url: submitUrl,
        statusCode: res.status,
        durationMs: Date.now() - submitStart,
        success: false,
        error: body.substring(0, 500),
      });
      if (moderationFailed || /moderat/i.test(body)) {
        log.warn('Grok content moderation block (video submit, error response)', {
          statusCode: res.status,
          body: body.substring(0, 1000),
        });
        throw new ContentModeratedError(`Grok moderated the video request (HTTP ${res.status})`);
      }
      throw new Error(`Grok video submit error ${res.status}: ${body.substring(0, 300)}`);
    }
    if (!parsed.request_id) {
      if (moderationFailed)
        throw new ContentModeratedError('Grok moderated the video request (no request_id)');
      throw new Error('Grok video submit returned no request_id');
    }
    requestId = parsed.request_id;
    logExternalCall('Grok', 'submitVideo', {
      method: 'POST',
      url: submitUrl,
      statusCode: res.status,
      durationMs: Date.now() - submitStart,
      success: true,
    });
  } catch (err) {
    clearTimeout(submitTimeout);
    if ((err as Error).name === 'AbortError') throw new Error('Grok video submit timed out');
    throw err;
  }

  // --- Poll ---
  const pollUrl = `${env.grok.apiUrl}/videos/${requestId}`;
  const deadline = Date.now() + VIDEO_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(VIDEO_POLL_INTERVAL_MS);
    const pollController = new AbortController();
    const pollTimeout = setTimeout(() => pollController.abort(), 30000);
    let body: string;
    let status: number;
    try {
      const res = await fetch(pollUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${env.grok.apiKey}` },
        signal: pollController.signal,
      });
      clearTimeout(pollTimeout);
      status = res.status;
      body = await res.text();
    } catch (err) {
      clearTimeout(pollTimeout);
      // A transient poll error: keep polling until the deadline.
      log.debug('Video poll attempt errored — will retry', {
        requestId,
        error: (err as Error).message,
      });
      continue;
    }

    if (!status.toString().startsWith('2')) {
      // Non-2xx poll — treat 4xx as terminal, otherwise keep trying.
      if (status >= 400 && status < 500) {
        throw new Error(`Grok video poll error ${status}: ${body.substring(0, 200)}`);
      }
      continue;
    }

    // Decision logic lives in utils/videoPoll.ts (pure + unit-tested). NEVER
    // substring-match the body for "moderat" — `respect_moderation` is a normal
    // field name and a substring match discarded every good video.
    const verdict = classifyVideoPoll(JSON.parse(body));
    if (verdict.kind === 'success') {
      logExternalCall('Grok', 'pollVideo', {
        method: 'GET',
        url: pollUrl,
        statusCode: status,
        durationMs: 0,
        success: true,
      });
      log.info('Video generation completed', { requestId });
      return verdict.url;
    }
    if (verdict.kind === 'moderated') {
      log.warn('Grok content moderation block (video)', {
        requestId,
        body: body.substring(0, 1000),
      });
      throw new ContentModeratedError('Grok moderated the video request');
    }
    if (verdict.kind === 'failed') {
      throw new Error('Grok video generation failed');
    }
    // pending → keep polling.
    log.debug('Video still processing', { requestId });
  }

  throw new Error('Grok video generation timed out (exceeded max wait)');
}

/**
 * Download a generated video (https URL) into a Buffer. Guarded by a timeout so
 * a hung/stalled CDN response can't pin a BullMQ worker slot past its lock (the
 * poll path is already timeout-guarded; this is the last unguarded network hop).
 */
export async function downloadVideo(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to download generated video: ${res.status} ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateTransformImage(input: CreationInput): Promise<string> {
  const { userBodyImageUrl, perspective, clothingImageUrls, userPrompt, aspectRatio } = input;

  log.info('Creation generation started', {
    perspective,
    hasBodyImage: !!userBodyImageUrl,
    referenceCount: clothingImageUrls.length,
    aspectRatio: aspectRatio ?? null,
  });

  // Fetch the reference image(s) the user is transforming.
  const referenceImages = await Promise.all(
    clothingImageUrls.map((url, i) => fetchImageAsBase64(url, `reference-image-${i + 1}`)),
  );

  // Build images array as objects with url field (xAI /images/edits format).
  // Reference: https://docs.x.ai/developers/rest-api-reference/inference/images
  // A legacy body photo (if ever provided) is prepended as the primary subject;
  // AnimationStation's free-form transform sends only the reference image(s).
  const images: Array<{ url: string }> = [];
  if (userBodyImageUrl) {
    const bodyImage = await fetchImageAsBase64(userBodyImageUrl, 'body-image');
    images.push({ url: `data:${bodyImage.mimeType};base64,${bodyImage.base64}` });
  }
  images.push(
    ...referenceImages.map((img) => ({ url: `data:${img.mimeType};base64,${img.base64}` })),
  );

  const prompt = buildPrompt(perspective, userPrompt);

  log.debug('Grok API request prepared', {
    endpoint: `${env.grok.apiUrl}/images/edits`,
    model: 'grok-imagine-image',
    imageCount: images.length,
    promptLength: prompt.length,
  });

  const requestBody = {
    model: 'grok-imagine-image',
    prompt,
    images, // Array of { url: "data:..." } objects for multi-image editing
    n: 1,
    response_format: 'url',
    // Only sent when the user picked a ratio; otherwise the edit keeps the
    // model's default framing (typically follows the source image).
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
  };

  const startTime = Date.now();

  // Set timeout for API call (2 minutes max for image generation)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(`${env.grok.apiUrl}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.grok.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;

    const responseBody = await response.text();

    // Content-moderation signal (see ContentModeratedError). A blocked
    // generation has no image and mentions "moderated"; detect on both the
    // error path and the 200-but-no-image path below.
    const looksModerated = /moderat/i.test(responseBody);

    if (!response.ok) {
      logExternalCall('Grok', 'generateImage', {
        method: 'POST',
        url: `${env.grok.apiUrl}/images/edits`,
        statusCode: response.status,
        durationMs,
        success: false,
        error: responseBody.substring(0, 500),
        perspective,
      });
      if (looksModerated) {
        // Log a generous slice of the raw body so we can pin the exact field.
        log.warn('Grok content moderation block (error response)', {
          perspective,
          statusCode: response.status,
          body: responseBody.substring(0, 1000),
        });
        throw new ContentModeratedError(`Grok moderated the request (HTTP ${response.status})`);
      }
      throw new Error(`Grok API error ${response.status}: ${responseBody}`);
    }

    const data = JSON.parse(responseBody) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    const imageData = data.data?.[0];

    if (imageData?.url) {
      logExternalCall('Grok', 'generateImage', {
        method: 'POST',
        url: `${env.grok.apiUrl}/images/edits`,
        statusCode: response.status,
        durationMs,
        success: true,
        perspective,
        resultType: 'url',
      });
      log.info('Creation generation completed', { perspective, durationMs, resultType: 'url' });
      return imageData.url;
    }

    if (imageData?.b64_json) {
      logExternalCall('Grok', 'generateImage', {
        method: 'POST',
        url: `${env.grok.apiUrl}/images/edits`,
        statusCode: response.status,
        durationMs,
        success: true,
        perspective,
        resultType: 'base64',
        resultLength: imageData.b64_json.length,
      });
      log.info('Creation generation completed', { perspective, durationMs, resultType: 'base64' });
      return `data:image/png;base64,${imageData.b64_json}`;
    }

    // 2xx but no image is, in practice, a moderation block. Log the FULL body
    // (first real hit will reveal the exact moderation field for diagnosis).
    log.warn('Grok returned no image content — raw body for diagnosis', {
      perspective,
      statusCode: response.status,
      looksModerated,
      body: responseBody.substring(0, 2000),
    });
    logExternalCall('Grok', 'generateImage', {
      method: 'POST',
      url: `${env.grok.apiUrl}/images/edits`,
      statusCode: response.status,
      durationMs,
      success: false,
      error: 'No image content in response',
      perspective,
    });
    if (looksModerated) {
      throw new ContentModeratedError('Grok moderated the request (no image returned)');
    }
    throw new Error('Grok API returned no image content');
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    if ((err as Error).name === 'AbortError') {
      logExternalCall('Grok', 'generateImage', {
        method: 'POST',
        url: `${env.grok.apiUrl}/images/edits`,
        durationMs,
        success: false,
        error: 'Request timed out after 2 minutes',
        perspective,
      });
      throw new Error('Grok API request timed out after 2 minutes');
    }
    throw err;
  }
}
