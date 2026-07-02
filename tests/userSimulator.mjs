/**
 * User simulator — exercises the real auth lifecycle against a live backend,
 * the same way the mobile app does:
 *
 *   1. "Open the app"    → GET   /health           (backend reachable?)
 *   2. "Log in"          → POST  /api/auth/login   (expect tokens + user payload)
 *   3. "Use the app"     → GET   /api/profile/me   (access token works?)
 *   4. Checkpoints       → compare live profile values against tests/checkpoints.json
 *   5. "Edit profile"    → PATCH /api/profile/me   (the same call EditProfileScreen's
 *                          Save button makes) — round trip: change the name to a
 *                          temporary value, verify it persisted via a fresh fetch,
 *                          change it back, verify again. Leaves the account as found.
 *   6. "Buy credits"     → POST  /api/credits/purchase (+ GET /credits/balance
 *                          before/after and /credits/history). On a local dev
 *                          backend this buys CREDITS_TO_BUY credits and verifies
 *                          the balance went up by exactly that much. On live
 *                          servers (NODE_ENV=production) the endpoint MUST answer
 *                          410 Gone — credits there are only grantable through a
 *                          verified StoreKit receipt (App Store Guideline 3.1.1)
 *                          — so the 410 is asserted as the PASS condition.
 *   7. "Log out"         → POST  /api/auth/logout  (server revokes refresh token)
 *   8. Verify logout     → POST  /api/auth/refresh (replaying the logged-out
 *                          refresh token MUST be rejected with 401)
 *
 * The logout-verify step is the part that proves logout actually did something
 * server-side — a logout that returns 200 but leaves the refresh token alive
 * would pass the earlier steps and still be broken.
 *
 * Note: with REFRESH_TOKEN_ROTATION on, the final replay also trips reuse
 * detection and revokes the user's whole refresh-token family. That is
 * harmless here — we just logged out and hold no other sessions — but don't
 * point this script at an account with live devices you care about.
 *
 * Checkpoints (tests/checkpoints.json): a flat JSON object of PASSIVE
 * assertions, compared as-is against the authenticated /profile/me response
 * right after login (before any action step mutates anything). Example:
 *   { "credits": 0, "firstName": "Bart", "lastName": "Starr" }
 * Each key becomes its own PASS/FAIL row. A failing checkpoint does NOT abort
 * the run (we still log out cleanly) but does fail the overall result. Any
 * field on the profile payload can be checkpointed: credits, tier, verified,
 * username, creationCount, ... The checkpoint file is owned by the user; the
 * simulator never writes to it. Action-step parameters (the temporary name
 * used in the edit round trip, the credit pack size) live in the constants
 * below, not in the checkpoint file.
 *
 * Every run writes a timestamped markdown report to tests/results/, including
 * runs that abort on a failed lifecycle step.
 *
 * Usage (from the repo root, plain Node ≥ 18 — no install needed):
 *   node tests/userSimulator.mjs --env dev --email user@x.com --password 'secret'
 *
 * Credentials may also come from SIM_EMAIL / SIM_PASSWORD env vars, or from a
 * gitignored tests/.sim-credentials.json ({"email": "...", "password": "..."})
 * — see tests/.sim-credentials.example.json. Precedence: CLI > env > file.
 *   --env local | dev | prod   (default: dev)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function loadJsonFile(name) {
  try {
    return JSON.parse(readFileSync(join(TESTS_DIR, name), 'utf8'));
  } catch {
    return null;
  }
}

const credsFile = loadJsonFile('.sim-credentials.json') ?? {};
const envName = getArg('--env') ?? 'dev';
const apiBase = API_BASES[envName];
const email = getArg('--email') ?? process.env.SIM_EMAIL ?? credsFile.email;
const password = getArg('--password') ?? process.env.SIM_PASSWORD ?? credsFile.password;

if (!apiBase) {
  console.error(`Unknown --env "${envName}" — expected one of: ${Object.keys(API_BASES).join(', ')}`);
  process.exit(1);
}
if (!email || !password) {
  console.error(
    'Missing credentials. Pass --email/--password, set SIM_EMAIL/SIM_PASSWORD, or create tests/.sim-credentials.json (see .sim-credentials.example.json).'
  );
  process.exit(1);
}

const origin = apiBase.replace(/\/api$/, '');

// ── Result collection ──────────────────────────────────────────────────────
const results = []; // { name, pass, detail }
let currentStep = '';
let stepNum = 0;

class StepFailure extends Error {}

function step(title) {
  stepNum += 1;
  currentStep = title;
  console.log(`\n[${stepNum}] ${title}`);
}

function pass(msg) {
  results.push({ name: currentStep, pass: true, detail: msg });
  console.log(`    PASS  ${msg}`);
}

function fail(msg) {
  results.push({ name: currentStep, pass: false, detail: msg });
  console.error(`    FAIL  ${msg}`);
  throw new StepFailure(msg);
}

function checkpointResult(name, ok, detail) {
  results.push({ name, pass: ok, detail });
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

function timestamp(forFilename = false) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = forFilename
    ? `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
    : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return forFilename ? `${date}_${time}` : `${date} ${time}`;
}

function writeReport(aborted) {
  const failed = results.filter((r) => !r.pass).length;
  const overall = failed === 0 && !aborted ? 'PASS' : 'FAIL';
  const lines = [
    '# User Simulator Report',
    '',
    `- **Date:** ${timestamp()} (local)`,
    `- **Environment:** ${envName} (${apiBase})`,
    `- **User:** ${email}`,
    `- **Overall:** ${overall === 'PASS' ? '✅ PASS' : '❌ FAIL'} — ${results.length - failed}/${results.length} tests passed${aborted ? ' (run aborted on lifecycle failure)' : ''}`,
    '',
    '| # | Test | Result | Detail |',
    '|---|------|--------|--------|',
    ...results.map(
      (r, i) => `| ${i + 1} | ${r.name} | ${r.pass ? '✅ PASS' : '❌ FAIL'} | ${r.detail.replace(/\|/g, '\\|')} |`
    ),
    '',
  ];
  const resultsDir = join(TESTS_DIR, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const reportPath = join(resultsDir, `sim-report-${timestamp(true)}.md`);
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`\nReport written: ${reportPath}`);
  return overall;
}

async function request(method, url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body (e.g. nginx error page) — leave json null */
  }
  console.log(`    ${method} ${url} -> ${res.status} (${Date.now() - started}ms)`);
  return { status: res.status, json };
}

// Action-step parameters. These belong to the journey script, NOT to
// tests/checkpoints.json (which is passive assertions only).
const NAME_EDIT_SUFFIX = '_sim'; // appended to make the temporary name in the edit round trip
const CREDITS_TO_BUY = 10; // pack size for the buy-credits step (local dev backend only)

const checkpoints = loadJsonFile('checkpoints.json') ?? {};

function runCheckpoints(profile) {
  const entries = Object.entries(checkpoints);
  if (entries.length === 0) {
    console.log('    (no checkpoints defined — skipping)');
    return;
  }
  for (const [key, expected] of entries) {
    const name = `Checkpoint: ${key}`;
    if (!(key in profile)) {
      checkpointResult(name, false, `field "${key}" not present on /profile/me response`);
      continue;
    }
    const actual = profile[key];
    const ok = actual === expected;
    checkpointResult(name, ok, `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
  }
}

async function main() {
  console.log(`User simulator — env: ${envName} (${apiBase})`);
  console.log(`Simulated user: ${email}`);

  // ── 1. Open the app ────────────────────────────────────────────────────
  step('Open app — backend health check');
  const health = await request('GET', `${origin}/health`);
  if (health.status !== 200) fail(`expected 200 from /health, got ${health.status}: ${JSON.stringify(health.json)}`);
  pass(`backend is up (${JSON.stringify(health.json)})`);

  // ── 2. Log in ──────────────────────────────────────────────────────────
  step('Log in');
  const login = await request('POST', `${apiBase}/auth/login`, { body: { email, password } });
  if (login.status !== 200) fail(`expected 200 from login, got ${login.status}: ${JSON.stringify(login.json)}`);
  const session = login.json;
  if (!session.accessToken) fail('login response is missing accessToken');
  if (!session.refreshToken) fail('login response is missing refreshToken');
  if (!session.user?.id) fail('login response is missing user.id');
  if (session.user.email.toLowerCase() !== email.toLowerCase()) {
    fail(`logged-in email mismatch: got ${session.user.email}`);
  }
  pass(`logged in as ${session.user.username} (id ${session.user.id}, tier ${session.user.tier}, ${session.user.credits} credits)`);

  // ── 3. Use the app — authenticated request ─────────────────────────────
  step('Fetch own profile with access token');
  const me = await request('GET', `${apiBase}/profile/me`, { token: session.accessToken });
  if (me.status !== 200) fail(`expected 200 from /profile/me, got ${me.status}: ${JSON.stringify(me.json)}`);
  const profile = me.json?.user ?? me.json;
  if (profile?.id !== session.user.id) fail(`/profile/me returned id ${profile?.id}, expected ${session.user.id}`);
  pass('access token accepted; profile matches the logged-in user');

  // ── 4. Checkpoints — expected vs actual ────────────────────────────────
  step('Checkpoints (tests/checkpoints.json vs live profile)');
  runCheckpoints(profile);

  // ── 5. Edit profile round trip (the "Save" button, twice) ──────────────
  // Change the name to a temporary value, verify it persisted, change it
  // back, verify again. Exercises the full save path both ways and leaves
  // the account exactly as found, so the passive checkpoints stay honest.
  async function saveName(targets, label) {
    const patch = await request('PATCH', `${apiBase}/profile/me`, {
      token: session.accessToken,
      body: targets,
    });
    if (patch.status !== 200) {
      fail(`expected 200 from profile update (${label}), got ${patch.status}: ${JSON.stringify(patch.json)}`);
    }
    // The app trusts the PATCH response to update its local store
    // (EditProfileScreen → updateUser), so the echo must already be correct.
    const badEcho = Object.entries(targets).filter(([k, v]) => patch.json?.[k] !== v);
    if (badEcho.length > 0) {
      fail(`update response (${label}) did not echo the new values: ${badEcho.map(([k]) => `${k}=${JSON.stringify(patch.json?.[k])}`).join(', ')}`);
    }
  }

  async function fetchProfileFields(keys) {
    const r = await request('GET', `${apiBase}/profile/me`, { token: session.accessToken });
    if (r.status !== 200) fail(`expected 200 from /profile/me, got ${r.status}: ${JSON.stringify(r.json)}`);
    const p = r.json?.user ?? r.json;
    return Object.fromEntries(keys.map((k) => [k, p?.[k]]));
  }

  // Restoring null via PATCH isn't possible (the schema takes strings), so an
  // account with no name on file is restored to '' — visually identical in the app.
  const originalName = {
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
  };
  const tempName = {
    firstName: `${originalName.firstName.slice(0, 50 - NAME_EDIT_SUFFIX.length) || 'Sim'}${NAME_EDIT_SUFFIX}`,
    lastName: `${originalName.lastName.slice(0, 50 - NAME_EDIT_SUFFIX.length) || 'User'}${NAME_EDIT_SUFFIX}`,
  };

  step(`Edit profile — change name to temporary value (PATCH /profile/me, as the Save button does)`);
  await saveName(tempName, 'temp name');
  pass(`profile update accepted (firstName="${tempName.firstName}", lastName="${tempName.lastName}")`);

  step('Verify the name change persisted (fresh /profile/me fetch)');
  const afterEdit = await fetchProfileFields(['firstName', 'lastName']);
  for (const [key, expected] of Object.entries(tempName)) {
    checkpointResult(
      `Name edit: ${key}`,
      afterEdit[key] === expected,
      `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(afterEdit[key])}`
    );
  }

  step('Edit profile — restore the original name');
  await saveName(originalName, 'restore');
  const afterRestore = await fetchProfileFields(['firstName', 'lastName']);
  const restoredOk = Object.entries(originalName).every(([k, v]) => afterRestore[k] === v);
  if (!restoredOk) {
    fail(`restore did not stick: ${JSON.stringify(afterRestore)}, expected ${JSON.stringify(originalName)}`);
  }
  pass(`name restored to firstName="${originalName.firstName}", lastName="${originalName.lastName}"`);

  // ── 6. Buy credits ──────────────────────────────────────────────────────
  // POST /api/credits/purchase is the dev-only purchase path ("kept available
  // in dev to support local testing without StoreKit"). On live servers
  // (NODE_ENV=production) it MUST answer 410 Gone — App Store Guideline 3.1.1
  // forbids granting credits outside a verified StoreKit receipt — so on
  // prod/dev the 410 itself is the PASS condition (the guard works).
  step('Check credit balance (GET /credits/balance)');
  const balBefore = await request('GET', `${apiBase}/credits/balance`, { token: session.accessToken });
  if (balBefore.status !== 200) fail(`expected 200 from /credits/balance, got ${balBefore.status}: ${JSON.stringify(balBefore.json)}`);
  const creditsBefore = balBefore.json.credits;
  if (creditsBefore !== profile.credits) {
    fail(`/credits/balance (${creditsBefore}) disagrees with /profile/me (${profile.credits})`);
  }
  pass(`balance endpoint agrees with profile: ${creditsBefore} credits (tier ${balBefore.json.tier}, weekly ${balBefore.json.weeklyUsed}/${balBefore.json.weeklyLimit})`);

  step(`Buy ${CREDITS_TO_BUY} credits (POST /credits/purchase)`);
  const buy = await request('POST', `${apiBase}/credits/purchase`, {
    token: session.accessToken,
    body: { credits: CREDITS_TO_BUY },
  });
  if (buy.status === 410) {
    pass(
      'endpoint correctly disabled on this server (410 Gone) — credits on live servers are only grantable via a verified StoreKit receipt (App Store Guideline 3.1.1). Run with --env local to exercise the purchase flow.'
    );
  } else if (buy.status === 200) {
    if (buy.json.credits !== creditsBefore + CREDITS_TO_BUY) {
      fail(`purchase response shows ${buy.json.credits} credits, expected ${creditsBefore + CREDITS_TO_BUY}`);
    }
    pass(`purchase accepted: +${buy.json.purchased} credits at $${buy.json.pricePerCredit}/credit ($${buy.json.totalPrice} total), new balance ${buy.json.credits}`);

    step(`Verify the ${CREDITS_TO_BUY} credits arrived (fresh balance + transaction history)`);
    const balAfter = await request('GET', `${apiBase}/credits/balance`, { token: session.accessToken });
    if (balAfter.status !== 200) fail(`expected 200 from /credits/balance, got ${balAfter.status}: ${JSON.stringify(balAfter.json)}`);
    checkpointResult(
      'Credits: balance after purchase',
      balAfter.json.credits === creditsBefore + CREDITS_TO_BUY,
      `expected ${creditsBefore + CREDITS_TO_BUY} (was ${creditsBefore}, bought ${CREDITS_TO_BUY}), actual ${balAfter.json.credits}`
    );
    const history = await request('GET', `${apiBase}/credits/history?limit=1`, { token: session.accessToken });
    const latest = history.json?.transactions?.[0];
    checkpointResult(
      'Credits: transaction recorded',
      history.status === 200 && latest?.amount === CREDITS_TO_BUY,
      latest
        ? `latest transaction: ${latest.type} ${latest.amount >= 0 ? '+' : ''}${latest.amount} ("${latest.description}")`
        : `no transaction found (status ${history.status})`
    );
  } else {
    fail(`expected 200 (local dev) or 410 (live server) from /credits/purchase, got ${buy.status}: ${JSON.stringify(buy.json)}`);
  }

  // ── 7. Log out ─────────────────────────────────────────────────────────
  step('Log out');
  const logout = await request('POST', `${apiBase}/auth/logout`, {
    body: { refreshToken: session.refreshToken },
  });
  if (logout.status !== 200) fail(`expected 200 from logout, got ${logout.status}: ${JSON.stringify(logout.json)}`);
  pass('logout accepted');

  // ── 8. Prove the session is dead ───────────────────────────────────────
  step('Replay the logged-out refresh token (must be rejected)');
  const replay = await request('POST', `${apiBase}/auth/refresh`, {
    body: { refreshToken: session.refreshToken },
  });
  if (replay.status !== 401) {
    fail(`revoked refresh token was NOT rejected — got ${replay.status}: ${JSON.stringify(replay.json)}`);
  }
  pass('server rejected the revoked refresh token with 401 — logout really ended the session');
}

main()
  .then(() => {
    const overall = writeReport(false);
    if (overall === 'PASS') {
      console.log('\nAll tests passed — login/logout lifecycle and checkpoints OK.');
    } else {
      console.error('\nOne or more checkpoints FAILED (lifecycle completed).');
      process.exit(1);
    }
  })
  .catch((err) => {
    if (err instanceof StepFailure) {
      writeReport(true);
    } else {
      results.push({ name: currentStep || 'Simulator crash', pass: false, detail: String(err?.message ?? err) });
      console.error(`\nSimulator crashed: ${err instanceof Error ? err.message : String(err)}`);
      writeReport(true);
    }
    process.exit(1);
  });
