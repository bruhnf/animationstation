// Flat ESLint config (ESLint 9) for the backend.
//
// Philosophy: ESLint covers code QUALITY; Prettier owns formatting (so
// eslint-config-prettier is applied last to disable any stylistic rules that
// would fight it). Introduced onto a large pre-existing codebase, so the noisy
// rules are dialed to "warn" — CI fails on errors only (no --max-warnings), and
// the warnings form a backlog to ratchet down over time.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'prisma/migrations/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // TypeScript already flags undefined identifiers; no-undef on TS is noise.
      'no-undef': 'off',
      // `namespace` is required for TS module augmentation (e.g. the Express
      // Request type extension in httpLogger.ts), so this rule can't apply here.
      '@typescript-eslint/no-namespace': 'off',
      // Pragmatic backlog rules (warn, don't block) for a codebase adopting lint.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // Tests use node:test globals and looser typing.
    files: ['**/*.test.ts', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Plain Node tooling scripts are CommonJS — require() is correct there.
    files: ['**/*.js', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettier,
);
