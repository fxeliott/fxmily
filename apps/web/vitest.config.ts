import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // Next.js's `server-only` guard package isn't installed (Next bundler
      // shims it at build time). Under Vitest we route the import to a
      // no-op so tests can transitively import server-side libs.
      'server-only': path.resolve(import.meta.dirname, 'src/test/server-only.shim.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'src/generated', 'tests/e2e/**'],
    /**
     * Stub env vars so any module that transitively imports `@/lib/env` does
     * not crash Zod validation at module-load time. The unit tests in this
     * suite never actually open a Postgres connection — Prisma clients are
     * lazily instantiated and only connect on the first query.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/fxmily_unused',
      AUTH_SECRET: 'unit-test-secret-not-used-but-must-be-at-least-32-chars',
      AUTH_URL: 'http://localhost:3000',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/generated/**', '**/*.test.ts', '**/*.spec.ts'],
      /**
       * RATCHET thresholds — set ~1.5 pts under the measured baseline
       * (2026-07-02 : stmts 78.58 / branches 66.14 / funcs 76.39 / lines
       * 78.88 on 4125+ tests) so CI fails on a coverage REGRESSION without
       * demanding aspirational coverage. Raise them as coverage grows;
       * never lower them to make a PR pass.
       */
      thresholds: {
        statements: 77,
        branches: 64.5,
        functions: 74.5,
        lines: 77,
      },
    },
  },
});
