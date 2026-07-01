// Flat ESLint config (ESLint 9) for the Expo app.
//
// Built on Expo's official shared config; eslint-config-prettier is applied last
// so Prettier owns formatting and ESLint owns code quality. Errors-only gate in
// CI (no --max-warnings) — warnings are a ratcheting backlog. Adopted onto an
// existing codebase, so a couple of noisy rules are dialed to "warn".
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = [
  ...expo,
  prettier,
  {
    ignores: ['dist/', 'node_modules/', '.expo/', 'android/', 'ios/', 'web-build/'],
  },
  {
    rules: {
      // React Native <Text> renders raw strings — it does not parse HTML
      // entities — so apostrophes/quotes in JSX text are fine. This rule is a
      // web concern; off for an RN app.
      'react/no-unescaped-entities': 'off',
      // axios attaches `create`/`isAxiosError` to its default export by design;
      // `axios.create()` / `axios.isAxiosError()` are the documented API. This
      // rule false-positives on that idiom.
      'import/no-named-as-default-member': 'off',
    },
  },
  {
    // Jest manual mocks run in the jest environment.
    files: ['**/__mocks__/**', '**/*.test.{ts,tsx,js}'],
    languageOptions: { globals: { jest: 'readonly' } },
    rules: {
      // Tests deliberately place imports AFTER jest.mock(...) calls so the mocks
      // register before the module-under-test loads. import/first would reorder
      // them above the mocks (breaking the native-module mocking), so disable it
      // and its autofix here.
      'import/first': 'off',
    },
  },
];
