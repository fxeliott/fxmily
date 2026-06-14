import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow the canonical `_unused` / `_input` etc. prefix for intentionally
  // unused parameters / destructured values. Common in stub adapters and
  // discriminated-union test fixtures.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Disposable build trash (e.g. `.next-trash-s8-2`): a renamed `.next` kept
    // on disk instead of `rm`. Default ignores cover `.next` but not these, so
    // a bare `eslint` would lint thousands of built JS files (a false ~17k-error
    // wall that does NOT exist on a clean CI checkout). Ignore the pattern.
    '.next-trash*/**',
    // Prisma 7 generated client lives in src/generated/prisma. tsconfig
    // already excludes it, but the flat ESLint config doesn't inherit that
    // — without this entry every regen produces thousands of lint warnings.
    'src/generated/**',
  ]),
]);

export default eslintConfig;
