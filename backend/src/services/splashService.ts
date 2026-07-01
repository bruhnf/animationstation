import crypto from 'crypto';
import { env } from '../config/env';
import { putS3Object, deleteFromS3, getS3ObjectBytes, listS3ObjectsUnderPrefix } from './s3Service';

// Backend-controlled splash/announcement screen, stored in S3 under the
// `splash/` prefix as a SINGLETON (at most one published image). The mobile app
// asks GET /api/splash on launch; when a splash exists it's shown full-screen.
//
// Why S3 (not a local dir): the app runs behind a load balancer on multiple
// instances (see DEPLOYMENT.md §17). A local file would only land on one box, so
// an admin upload would be inconsistent across instances. S3 is shared + already
// used everywhere. The `splash/` prefix is intentionally OUTSIDE the orphan-scan
// prefixes (admin.ts `S3_PREFIXES`), so the reconciliation scan never flags it.

const SPLASH_PREFIX = 'splash/';
const SPLASH_BASENAME = 'announcement';
const SPLASH_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;
type SplashExtension = (typeof SPLASH_EXTENSIONS)[number];

const CONTENT_TYPE_BY_EXT: Record<SplashExtension, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const EXT_BY_MIME: Record<string, SplashExtension> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ActiveSplash {
  // Stable identity of THIS published splash (changes whenever it's replaced).
  // The app keys its "seen / don't show again" tracking on it, so a newly
  // published splash shows at least once even to users who dismissed the prior.
  id: string;
  key: string; // S3 key
  contentType: string;
  sizeBytes: number;
  publishedAt: string; // ISO timestamp (S3 lastModified)
}

function extFromKey(key: string): SplashExtension | null {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return (SPLASH_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SplashExtension) : null;
}

// Short per-instance cache so /api/splash (hit on EVERY app cold start) doesn't
// do an S3 ListObjects every time. The publishing instance invalidates its own
// cache immediately on publish/remove; other instances behind the load balancer
// reflect an admin change within the TTL. 60s is fine for a launch announcement.
const SPLASH_CACHE_TTL_MS = 60_000;
let splashCache: { value: ActiveSplash | null; expiresAt: number } | null = null;

/** Drop the cached splash so the next read re-resolves from S3. */
export function invalidateSplashCache(): void {
  splashCache = null;
}

export async function getActiveSplash(): Promise<ActiveSplash | null> {
  if (splashCache && splashCache.expiresAt > Date.now()) {
    return splashCache.value;
  }
  const value = await resolveActiveSplash();
  splashCache = { value, expiresAt: Date.now() + SPLASH_CACHE_TTL_MS };
  return value;
}

async function resolveActiveSplash(): Promise<ActiveSplash | null> {
  const objects = await listS3ObjectsUnderPrefix(SPLASH_PREFIX);
  // Extension priority (only one should exist — publish clears old ones first).
  for (const ext of SPLASH_EXTENSIONS) {
    const obj = objects.find((o) => extFromKey(o.key) === ext && o.sizeBytes > 0);
    if (!obj) continue;
    const mtime = obj.lastModified ?? new Date(0);
    const id = crypto
      .createHash('sha1')
      .update(`${ext}:${obj.sizeBytes}:${mtime.getTime()}`)
      .digest('hex')
      .slice(0, 16);
    return {
      id,
      key: obj.key,
      contentType: CONTENT_TYPE_BY_EXT[ext],
      sizeBytes: obj.sizeBytes,
      publishedAt: mtime.toISOString(),
    };
  }
  return null;
}

// Public URL the app loads the image from. The id rides along as a cache buster
// so a replaced splash is never served from a stale client/CDN cache.
export function splashImageUrl(splash: ActiveSplash): string {
  return `${env.appUrl}/api/splash/image?v=${splash.id}`;
}

// Fetch the splash image bytes from S3 (served by GET /api/splash/image).
export async function readSplashBytes(
  splash: ActiveSplash,
): Promise<{ body: Buffer; contentType: string }> {
  return getS3ObjectBytes(splash.key);
}

// Publish a new splash, replacing any previous one (any extension).
export async function publishSplash(buffer: Buffer, mimetype: string): Promise<ActiveSplash> {
  const ext = EXT_BY_MIME[mimetype];
  if (!ext) throw new Error('Splash image must be JPEG, PNG, or WebP');
  await removeSplash();
  await putS3Object(`${SPLASH_PREFIX}${SPLASH_BASENAME}.${ext}`, buffer, CONTENT_TYPE_BY_EXT[ext]);
  invalidateSplashCache(); // reflect the new image immediately on this instance
  const active = await getActiveSplash();
  if (!active) throw new Error('Splash uploaded but could not be read back');
  return active;
}

// Delete every splash candidate object. Returns how many were removed.
export async function removeSplash(): Promise<number> {
  const objects = await listS3ObjectsUnderPrefix(SPLASH_PREFIX);
  let removed = 0;
  for (const o of objects) {
    if (extFromKey(o.key)) {
      await deleteFromS3(o.key);
      removed += 1;
    }
  }
  invalidateSplashCache(); // a removed/replaced splash must not linger in cache
  return removed;
}
