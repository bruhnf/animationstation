/**
 * Diagnostic: log in, fetch the feed + own profile, then try to actually
 * download every image URL in the responses and report what the image host
 * (S3) says. Pinpoints "Tap to reload" causes: expired signature, access
 * denied, missing object (NoSuchKey), or a bare S3 key that never got
 * presigned.
 *
 *   node tests/imageProbe.mjs --env prod
 *
 * Credentials resolve like userSimulator.mjs: CLI > env > .sim-credentials.json.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const API_BASES = {
  local: 'http://localhost:3000/api',
  dev: 'https://api-dev.creation-mirror.ai/api',
  prod: 'https://api.creation-mirror.ai/api',
};

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
let creds = {};
try { creds = JSON.parse(readFileSync(join(TESTS_DIR, '.sim-credentials.json'), 'utf8')); } catch {}

const envName = getArg('--env') ?? 'prod';
const apiBase = API_BASES[envName];
const email = getArg('--email') ?? process.env.SIM_EMAIL ?? creds.email;
const password = getArg('--password') ?? process.env.SIM_PASSWORD ?? creds.password;

const login = await fetch(`${apiBase}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (login.status !== 200) {
  console.error(`login failed: ${login.status}`);
  process.exit(1);
}
const { accessToken } = await login.json();
const auth = { Authorization: `Bearer ${accessToken}` };

// Collect every string that looks like an image reference from feed + profile.
const sources = [];
const pages = parseInt(getArg('--pages') ?? '1', 10);
const paths = [
  ...Array.from({ length: pages }, (_, i) => `/feed?page=${i + 1}`),
  '/profile/me',
  '/creations/history',
];
for (const path of paths) {
  const r = await fetch(`${apiBase}${path}`, { headers: auth });
  const body = await r.json().catch(() => null);
  sources.push({ path, status: r.status, body });
}

const URL_FIELDS = [
  'avatarUrl', 'fullBodyUrl', 'mediumBodyUrl', 'sourceImageUrl',
  'refImage1Url', 'refImage2Url', 'resultImageUrl', 'resultImage2Url',
];
const found = []; // { from, field, value }
function walk(node, from) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, from));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (URL_FIELDS.includes(k) && typeof v === 'string' && v.length > 0) {
        found.push({ from, field: k, value: v });
      } else {
        walk(v, from);
      }
    }
  }
}
for (const s of sources) {
  console.log(`${s.path} -> ${s.status}`);
  walk(s.body, s.path);
}
console.log(`\n${found.length} image reference(s) collected. Probing...\n`);

const tally = {};
for (const f of found) {
  let verdict;
  let detail = '';
  if (!/^https?:\/\//.test(f.value)) {
    verdict = 'NOT A URL (bare S3 key — presign helper was skipped?)';
    detail = f.value.slice(0, 70);
  } else {
    try {
      const r = await fetch(f.value);
      if (r.ok) {
        verdict = `OK ${r.status}`;
        await r.arrayBuffer(); // drain
      } else {
        const text = await r.text();
        const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '';
        const msg = text.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? '';
        verdict = `FAIL ${r.status} ${code}`;
        detail = msg.slice(0, 90);
      }
    } catch (err) {
      verdict = `FETCH ERROR`;
      detail = String(err?.cause?.code ?? err.message).slice(0, 90);
    }
  }
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  if (!verdict.startsWith('OK')) {
    const host = /^https?:\/\//.test(f.value) ? new URL(f.value).host : '(none)';
    console.log(`  ${verdict}  [${f.from} ${f.field}] host=${host} ${detail}`);
  }
}

console.log('\n=== Tally ===');
for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)} × ${v}`);
}
