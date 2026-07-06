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
  // Tour 15 guardrail: em/en dashes are banned from anything a member can
  // read (UI copy, notification/email strings). French copy here uses simple
  // punctuation (commas, colons, « à » for ranges). Code COMMENTS are exempt
  // on purpose — the repo's comment style uses em dashes heavily and they are
  // never member-facing. Scope: string/template literals + JSX text only.
  {
    files: ['src/**/*.{ts,tsx}'],
    // Scoped exemptions (measured 2026-07-06: 1148 hits, 1063 of them here):
    //  - tests + src/test fixtures simulate RAW model output and feed the
    //    typography sanitizer — em dashes there are the point, not a leak;
    //  - AI prompt files + claude-client fallbacks are model-facing, never
    //    member-facing, and their wording is calibrated (golden-tested);
    //  - normalize-typography.ts IS the sanitizer that strips these chars
    //    from real model output before a member ever sees it.
    ignores: [
      'src/**/*.test.{ts,tsx}',
      'src/test/**',
      'src/lib/**/prompt.ts',
      'src/lib/**/claude-client.ts',
      'src/lib/ai/prompt-builder.ts',
      'src/lib/text/normalize-typography.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[\\u2013\\u2014]/]',
          message:
            'Pas de tiret cadratin/demi-cadratin dans la copie UI : ponctuation simple (virgule, deux-points, « à » pour les plages).',
        },
        {
          selector: 'Literal[value=/[\\u2013\\u2014]/]',
          message:
            'Pas de tiret cadratin/demi-cadratin dans les chaînes lisibles par un membre : ponctuation simple.',
        },
        {
          selector: 'TemplateElement[value.raw=/[\\u2013\\u2014]/]',
          message:
            'Pas de tiret cadratin/demi-cadratin dans les template strings lisibles par un membre : ponctuation simple.',
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
