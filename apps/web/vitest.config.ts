import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
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
    },
  },
});
