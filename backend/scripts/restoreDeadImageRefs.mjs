/**
 * Repair tool for dangling TryOnJob image references (2026-06-11 incident:
 * body-photo replace/delete removed S3 objects that historical jobs still
 * reference, surfacing as permanent "Tap to reload" in the app).
 *
 * Input: a psql export of `jobId|field|value` lines (see the SQL in the
 * session notes / git history). For every referenced S3 object:
 *   1. HEAD it. Exists → fine.
 *   2. Missing → if the bucket still holds noncurrent versions behind a
 *      delete marker (30-day versioning window), REMOVE the delete marker(s)
 *      to restore the object.
 *   3. Still missing (no versions) → emit SQL to NULL that job field so the
 *      client stops rendering a dead slide.
 *
 * Credentials: intentionally does NOT load backend/.env — it relies on the
 * default AWS credential chain (~/.aws/credentials), because the app's IAM
 * user has no version/restore permissions (least privilege). Run from the
 * admin workstation only.
 *
 *   node scripts/restoreDeadImageRefs.mjs <refs-file> [--apply]
 *
 * Without --apply it is a dry run: reports what it WOULD restore/null.
 */
import { readFileSync } from 'node:fs';
import {
  S3Client,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.AWS_S3_BUCKET ?? 'evofaceflow-uploads';
const refsFile = process.argv[2];
const apply = process.argv.includes('--apply');
if (!refsFile) {
  console.error('usage: node scripts/restoreDeadImageRefs.mjs <refs-file> [--apply]');
  process.exit(1);
}

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

function toKey(value) {
  if (!/^https?:\/\//.test(value)) return value.replace(/^\/+/, '');
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

// Parse refs: jobId|field|value (ignore non-matching lines from psql noise)
const rows = readFileSync(refsFile, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^[0-9a-f-]{36}\|/.test(l))
  .map((l) => {
    const [jobId, field, ...rest] = l.split('|');
    return { jobId, field, value: rest.join('|') };
  });

const byKey = new Map();
for (const r of rows) {
  const key = toKey(r.value);
  if (!key) continue;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}
console.log(`${rows.length} references, ${byKey.size} unique S3 keys. Checking...\n`);

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return false;
    throw err;
  }
}

const dead = [];
let okCount = 0;
const keys = [...byKey.keys()];
const CONCURRENCY = 8;
for (let i = 0; i < keys.length; i += CONCURRENCY) {
  await Promise.all(
    keys.slice(i, i + CONCURRENCY).map(async (key) => {
      if (await exists(key)) okCount += 1;
      else dead.push(key);
    }),
  );
}
console.log(`${okCount} keys exist, ${dead.length} missing.\n`);

const restored = [];
const unrecoverable = [];
for (const key of dead) {
  const v = await s3.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: key }));
  const markers = (v.DeleteMarkers ?? []).filter((m) => m.Key === key);
  const versions = (v.Versions ?? []).filter((x) => x.Key === key);
  if (versions.length === 0) {
    unrecoverable.push(key);
    console.log(`  UNRECOVERABLE (no versions left): ${key}`);
    continue;
  }
  if (apply) {
    for (const m of markers) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key, VersionId: m.VersionId }));
    }
    if (await exists(key)) {
      restored.push(key);
      console.log(`  RESTORED: ${key}`);
    } else {
      unrecoverable.push(key);
      console.log(`  RESTORE FAILED (still missing after marker removal): ${key}`);
    }
  } else {
    restored.push(key);
    console.log(`  WOULD RESTORE (${versions.length} version(s), ${markers.length} marker(s)): ${key}`);
  }
}

console.log(`\n=== Summary (${apply ? 'APPLIED' : 'DRY RUN'}) ===`);
console.log(`  exist: ${okCount}  restored: ${restored.length}  unrecoverable: ${unrecoverable.length}`);

if (unrecoverable.length > 0) {
  console.log('\n=== SQL to null unrecoverable references (run via psql) ===');
  for (const key of unrecoverable) {
    for (const r of byKey.get(key)) {
      console.log(
        `UPDATE tryon_jobs SET "${r.field}" = NULL WHERE id = '${r.jobId}' AND "${r.field}" = '${r.value.replace(/'/g, "''")}';`,
      );
    }
  }
}
