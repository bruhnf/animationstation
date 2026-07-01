import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

const s3 = new S3Client({
  region: env.aws.region,
  credentials: env.aws.accessKeyId
    ? { accessKeyId: env.aws.accessKeyId, secretAccessKey: env.aws.secretAccessKey }
    : undefined,
});

const BUCKET = env.aws.s3Bucket;

export type S3Prefix =
  | 'body-photos'
  | 'clothing-photos'
  | 'tryon-results'
  | 'closet'
  | 'tryon-videos';

export async function uploadToS3(
  prefix: S3Prefix,
  userId: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const key = `${prefix}/${userId}/${filename}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function deleteFromS3(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Raw-key PUT for singleton / app-managed objects (e.g. the splash image) that
// don't fit the per-user `uploadToS3` shape. Caller controls the full key.
export async function putS3Object(key: string, buffer: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }),
  );
}

// Server-side copy within the bucket (no bytes through this process). Used when
// a closet item is used for a try-on: the job gets its OWN copy under
// clothing-photos/, so deleting the closet item later can never dangle a
// TryOnJob image reference.
export async function copyWithinS3(
  sourceKey: string,
  destPrefix: S3Prefix,
  userId: string,
  filename: string,
): Promise<string> {
  const destKey = `${destPrefix}/${userId}/${filename}`;
  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      // CopySource is "<bucket>/<key>", URI-encoded per the S3 API.
      CopySource: `${BUCKET}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`,
      Key: destKey,
    }),
  );
  return destKey;
}

// --- Presigned-URL cache ----------------------------------------------------
// Presigning is local crypto, but the feed signs ~120 URLs PER request (20 jobs
// × up to 6 keys). Re-signing the SAME key on every request is the feed's
// dominant latency cost (load test: ~580ms floor while CPU/RAM sat idle). Public
// feed images are identical for everyone, so a short-TTL in-process cache near-
// eliminates repeat signing. Per-process (the win is repeat keys on a box),
// bounded in size, and swept periodically. Disable with PRESIGN_CACHE=off.
const PRESIGN_CACHE_ENABLED = process.env.PRESIGN_CACHE !== 'off';
const PRESIGN_MIN_REMAINING_MS = 10 * 60 * 1000; // a served URL must keep >= 10 min of validity
const PRESIGN_MAX_REUSE_MS = 30 * 60 * 1000; // never reuse one signed URL longer than 30 min
const PRESIGN_CACHE_MAX_ENTRIES = 10_000;

interface PresignEntry {
  url: string;
  reuseUntil: number; // epoch ms; serve from cache only while now < reuseUntil
}
const presignCache = new Map<string, PresignEntry>();

if (PRESIGN_CACHE_ENABLED) {
  const sweep = setInterval(
    () => {
      const now = Date.now();
      for (const [k, v] of presignCache) if (now >= v.reuseUntil) presignCache.delete(k);
    },
    5 * 60 * 1000,
  );
  // Don't let the sweep timer keep the event loop (and process) alive.
  if (typeof sweep.unref === 'function') sweep.unref();
}

function signUrl(key: string, expiresInSeconds: number): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  // Short-lived URLs (e.g. upload links) aren't cached — they'd expire too soon to reuse.
  const cacheable = PRESIGN_CACHE_ENABLED && expiresInSeconds * 1000 > PRESIGN_MIN_REMAINING_MS;
  if (!cacheable) return signUrl(key, expiresInSeconds);

  const cacheKey = `${expiresInSeconds}:${key}`;
  const hit = presignCache.get(cacheKey);
  if (hit && Date.now() < hit.reuseUntil) return hit.url;

  const url = await signUrl(key, expiresInSeconds);
  const reuseUntil =
    Date.now() + Math.min(PRESIGN_MAX_REUSE_MS, expiresInSeconds * 1000 - PRESIGN_MIN_REMAINING_MS);

  // Crude size bound: when full, drop the oldest ~10% (Map keeps insertion order).
  if (presignCache.size >= PRESIGN_CACHE_MAX_ENTRIES) {
    let drop = Math.ceil(PRESIGN_CACHE_MAX_ENTRIES * 0.1);
    for (const k of presignCache.keys()) {
      presignCache.delete(k);
      if (--drop <= 0) break;
    }
  }
  presignCache.set(cacheKey, { url, reuseUntil });
  return url;
}

export function keyFromUrl(url: string): string {
  // Extract S3 key from a stored URL or key path
  if (url.startsWith('http')) {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '');
  }
  return url;
}

// Fetch an object's bytes through the backend. Used by the public share-image
// proxy: social-link scrapers (og:image) need a STABLE url, but presigned URLs
// expire in an hour, so we stream the bytes from a permanent path instead.
export async function getS3ObjectBytes(
  key: string,
): Promise<{ body: Buffer; contentType: string }> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = Buffer.from(await out.Body!.transformToByteArray());
  return { body, contentType: out.ContentType ?? 'image/jpeg' };
}

export interface S3ObjectInfo {
  key: string;
  sizeBytes: number;
  lastModified: Date | null;
}

// List all objects (key + size + mtime) under a given prefix, handling S3
// pagination automatically.
export async function listS3ObjectsUnderPrefix(prefix: string): Promise<S3ObjectInfo[]> {
  const objects: S3ObjectInfo[] = [];
  let continuationToken: string | undefined;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const res = await s3.send(cmd);
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        objects.push({
          key: obj.Key,
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified ?? null,
        });
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

// List all object keys under a given prefix.
export async function listS3KeysUnderPrefix(prefix: string): Promise<string[]> {
  return (await listS3ObjectsUnderPrefix(prefix)).map((o) => o.key);
}

// Enumerate all S3 keys owned by a user across all prefixes.
// Mirrors the set gathered in profileController.deleteAccount.
export async function listUserS3Keys(
  avatarUrl: string | null,
  fullBodyUrl: string | null,
  mediumBodyUrl: string | null,
  jobs: Array<{
    clothingPhoto1Url: string | null;
    clothingPhoto2Url: string | null;
    resultFullBodyUrl: string | null;
    resultMediumUrl: string | null;
  }>,
  closetImageUrls: string[] = [],
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (avatarUrl) keys.add(keyFromUrl(avatarUrl));
  if (fullBodyUrl) keys.add(keyFromUrl(fullBodyUrl));
  if (mediumBodyUrl) keys.add(keyFromUrl(mediumBodyUrl));
  for (const j of jobs) {
    if (j.clothingPhoto1Url) keys.add(keyFromUrl(j.clothingPhoto1Url));
    if (j.clothingPhoto2Url) keys.add(keyFromUrl(j.clothingPhoto2Url));
    if (j.resultFullBodyUrl) keys.add(keyFromUrl(j.resultFullBodyUrl));
    if (j.resultMediumUrl) keys.add(keyFromUrl(j.resultMediumUrl));
  }
  for (const url of closetImageUrls) {
    keys.add(keyFromUrl(url));
  }
  return keys;
}
