#!/usr/bin/env node
/**
 * Cross-platform, Node-version-agnostic unit-test runner.
 *
 * Why this exists: `node --test "glob"` only expands glob patterns on Node 21+,
 * but this project's runtime (the Docker images, prod) is Node 20 — so a glob in
 * the npm script silently matches zero files there (it only worked on a Node 22
 * dev machine). This script discovers `*.test.ts` files itself with `fs` (works on
 * Node 18+, Windows and Linux) and passes the explicit list to the built-in test
 * runner via ts-node — which works on every supported Node version.
 *
 * Run via: npm test
 */
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join, relative } = require('node:path');

const SRC = join(__dirname, '..', 'src');

function findTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTestFiles(full));
    else if (/\.test\.ts$/.test(entry.name)) found.push(full);
  }
  return found;
}

const tests = findTestFiles(SRC).sort();
if (tests.length === 0) {
  console.error('No *.test.ts files found under src/. Nothing to run.');
  process.exit(1);
}

console.log(`Running ${tests.length} test file(s):`);
for (const t of tests) console.log('  - ' + relative(process.cwd(), t));

const result = spawnSync(
  process.execPath,
  ['-r', 'ts-node/register', '--test', ...tests],
  { stdio: 'inherit' },
);

// Propagate the runner's exit code so `npm test` fails when a test fails.
process.exit(result.status ?? 1);
