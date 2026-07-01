/**
 * Diagnostic (read-only): list S3 object versions + delete markers under a
 * prefix, to establish WHEN objects were deleted and whether they are still
 * restorable (bucket versioning keeps noncurrent versions 30 days).
 *
 *   cd backend
 *   node scripts/s3VersionCheck.mjs "body-photos/<userId>/"
 *
 * Uses AWS credentials from backend/.env.
 */
import 'dotenv/config';
import { S3Client, ListObjectVersionsCommand } from '@aws-sdk/client-s3';

const prefix = process.argv[2];
if (!prefix) {
  console.error('usage: node scripts/s3VersionCheck.mjs <key-prefix>');
  process.exit(1);
}

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucket = process.env.AWS_S3_BUCKET;

const out = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }));

console.log(`bucket=${bucket} prefix=${prefix}\n`);
console.log('== current/noncurrent versions ==');
for (const v of out.Versions ?? []) {
  console.log(`  ${v.IsLatest ? 'LATEST    ' : 'noncurrent'} ${v.LastModified.toISOString()} ${Math.round(v.Size / 1024)}KB ${v.Key}`);
}
console.log('\n== delete markers ==');
for (const d of out.DeleteMarkers ?? []) {
  console.log(`  ${d.IsLatest ? 'LATEST    ' : 'old       '} ${d.LastModified.toISOString()} ${d.Key}`);
}
if (!out.Versions?.length && !out.DeleteMarkers?.length) console.log('(nothing under this prefix)');
