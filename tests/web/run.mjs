// Runs the website end-to-end suites against a locally running backend.
//   npm run test:web            # both suites
//   npm run test:web -- auth    # just the auth flow
//   npm run test:web -- video   # just the feed video layout
//
// Prereqs are documented in tests/web/README.md. Exits non-zero on any failure.
const SUITES = {
  auth: () => import('./authFlow.e2e.mjs'),
  video: () => import('./feedVideoLayout.e2e.mjs'),
};

const requested = process.argv.slice(2).filter((a) => a in SUITES);
const names = requested.length ? requested : Object.keys(SUITES);

const results = [];
for (const name of names) {
  console.log(`\n=== ${name} ===`);
  const { run } = await SUITES[name]();
  results.push(...(await run()));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
  process.exit(1);
}
