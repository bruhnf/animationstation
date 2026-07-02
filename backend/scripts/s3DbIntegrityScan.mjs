/**
 * DB ↔ S3 integrity scan: cross-references every image reference stored in the
 * database against the actual contents of the S3 bucket, in both directions:
 *
 *   1. Dead DB references — a User/Creation row points at an S3 key that does
 *      not exist (would render as a permanently broken image in the app).
 *   2. Orphaned S3 objects — an object in the bucket that no DB row references
 *      (wasted storage; left behind by deletes/replacements that missed S3).
 *   3. Per-job completeness — whether each COMPLETE creation still has all four
 *      core images (clothing, body photo input, full-body result, medium
 *      result), with perspectivesUsed taken into account.
 *
 * This is an OFFLINE comparison over two text exports, so it runs anywhere and
 * touches nothing:
 *
 *   --dump <file>  psql export with "### REFS" / "### JOBS" / "### USERS"
 *                  sections (see the SQL in scripts/sql notes / git history of
 *                  this file). REFS lines: kind|rowId|field|value
 *                  JOBS lines:  id|userId|username|status|perspectives|created|
 *                               hasClothing1|hasClothing2|hasBody|hasResFull|hasResMed|error
 *   --s3 <file>    `aws s3 ls s3://<bucket> --recursive` output
 *   --label <txt>  heading for the report (e.g. "PROD")
 *
 * Read-only by design: it prints a report and exits. Cleanup is a separate,
 * deliberate step (admin dashboard orphan tools / restoreDeadImageRefs.mjs).
 */
import { readFileSync } from 'node:fs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dumpFile = arg('dump');
const s3File = arg('s3');
const label = arg('label') ?? 'SCAN';
if (!dumpFile || !s3File) {
  console.error('usage: node scripts/s3DbIntegrityScan.mjs --dump <db-dump> --s3 <s3-listing> [--label PROD]');
  process.exit(1);
}

// Same normalization as the backend's presign helpers: rows may hold a bare
// key or (legacy) a full https URL.
function toKey(value) {
  if (!/^https?:\/\//.test(value)) return value.replace(/^\/+/, '');
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

// ---- Parse the DB dump -----------------------------------------------------
const sections = { REFS: [], JOBS: [], USERS: [] };
let current = null;
for (const line of readFileSync(dumpFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^### (\w+)/);
  if (m) {
    current = sections[m[1]] ? m[1] : null;
    continue;
  }
  if (current && line.trim()) sections[current].push(line);
}

const refs = sections.REFS.map((l) => {
  const [kind, rowId, field, ...rest] = l.split('|');
  return { kind, rowId, field, key: toKey(rest.join('|')) };
}).filter((r) => r.key);

const jobs = sections.JOBS.map((l) => {
  const [id, userId, username, status, perspectives, createdAt, c1, c2, body, resFull, resMed, ...err] = l.split('|');
  return {
    id, userId, username, status, createdAt,
    perspectives: perspectives ? perspectives.split(',') : [],
    hasClothing1: c1 === '1', hasClothing2: c2 === '1', hasBody: body === '1',
    hasResultFull: resFull === '1', hasResultMedium: resMed === '1',
    errorMessage: err.join('|'),
  };
});

const users = new Map(
  sections.USERS.map((l) => {
    const [id, username, isGuest] = l.split('|');
    return [id, { username, isGuest: isGuest === '1' }];
  }),
);

// ---- Parse the S3 listing ---------------------------------------------------
// `aws s3 ls --recursive` lines: "2026-06-10 15:09:46     133226 key/with spaces.jpg"
const s3 = new Map();
for (const line of readFileSync(s3File, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\S+ \S+ +(\d+) (.+)$/);
  if (m) s3.set(m[2], parseInt(m[1], 10));
}

// ---- 1. Dead DB references --------------------------------------------------
const refKeys = new Set(refs.map((r) => r.key));
const deadRefs = refs.filter((r) => !s3.has(r.key));

// ---- 2. Orphaned S3 objects --------------------------------------------------
const orphans = [...s3.keys()].filter((k) => !refKeys.has(k));
const orphanBytes = orphans.reduce((n, k) => n + s3.get(k), 0);
const orphansByPrefix = new Map();
for (const k of orphans) {
  const prefix = k.split('/')[0];
  const e = orphansByPrefix.get(prefix) ?? { count: 0, bytes: 0, sample: [] };
  e.count += 1;
  e.bytes += s3.get(k);
  if (e.sample.length < 5) e.sample.push(k);
  orphansByPrefix.set(prefix, e);
}

// ---- 3. Per-job completeness -------------------------------------------------
// "All 4" = clothing1 + body input + both results. A COMPLETE job that only
// used one perspective legitimately has one result — flag it separately from a
// missing image that the job's own perspectivesUsed says should exist.
const completeJobs = jobs.filter((j) => j.status === 'COMPLETE');
const incomplete = [];
for (const j of completeJobs) {
  const missing = [];
  if (!j.hasClothing1) missing.push('refImage1Url');
  if (!j.hasBody) missing.push('sourceImageUrl');
  if (j.perspectives.includes('full_body') && !j.hasResultFull) missing.push('resultImageUrl');
  if (j.perspectives.includes('medium') && !j.hasResultMedium) missing.push('resultImage2Url');
  const singlePerspective = j.perspectives.length === 1;
  if (missing.length > 0 || singlePerspective) {
    incomplete.push({ ...j, missing, singlePerspective });
  }
}

// ---- Report -------------------------------------------------------------------
const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
console.log(`\n================ DB ↔ S3 INTEGRITY — ${label} ================`);
console.log(`DB references: ${refs.length} (${refKeys.size} unique keys) · S3 objects: ${s3.size} · jobs: ${jobs.length} (${completeJobs.length} COMPLETE) · users: ${users.size}`);

console.log(`\n--- 1. DB references whose S3 object is MISSING: ${deadRefs.length} ---`);
for (const r of deadRefs) {
  const owner = r.kind === 'user'
    ? `user ${users.get(r.rowId)?.username ?? r.rowId}`
    : `job ${r.rowId}`;
  console.log(`  ${owner} · ${r.field} → ${r.key}`);
}
if (deadRefs.length === 0) console.log('  ✓ none — every DB image reference resolves to a live S3 object');

console.log(`\n--- 2. S3 objects NOT referenced by any DB row: ${orphans.length} (${fmtMB(orphanBytes)}) ---`);
for (const [prefix, e] of [...orphansByPrefix.entries()].sort()) {
  console.log(`  ${prefix}/: ${e.count} objects, ${fmtMB(e.bytes)}`);
  for (const k of e.sample) console.log(`     e.g. ${k}`);
  if (e.count > e.sample.length) console.log(`     …+${e.count - e.sample.length} more`);
}
if (orphans.length === 0) console.log('  ✓ none — every S3 object is referenced by the DB');

console.log(`\n--- 3. COMPLETE jobs missing expected images: ${incomplete.filter((j) => j.missing.length).length} (of ${completeJobs.length}) ---`);
for (const j of incomplete) {
  if (j.missing.length === 0) continue;
  console.log(`  ${j.createdAt} · ${j.username} · ${j.id}\n     missing: ${j.missing.join(', ')} (perspectives: ${j.perspectives.join(',') || '—'})`);
}
if (incomplete.every((j) => j.missing.length === 0)) console.log('  ✓ none — every COMPLETE job has all images its perspectives call for');

const singles = incomplete.filter((j) => j.singlePerspective && j.missing.length === 0);
if (singles.length > 0) {
  console.log(`\n  ℹ ${singles.length} COMPLETE job(s) ran with a single perspective (legitimate when only one body photo existed, or one view was moderation-blocked):`);
  for (const j of singles) console.log(`     ${j.createdAt} · ${j.username} · ${j.id} (${j.perspectives.join(',')})`);
}

// Orphan keys in full, machine-readable, for a cleanup pass.
if (orphans.length > 0) {
  console.log(`\n--- Full orphan key list (${orphans.length}) ---`);
  for (const k of orphans.sort()) console.log(`  ${k}`);
}
