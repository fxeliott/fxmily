import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for J1 E2E tests.
 *
 * The app needs a real Postgres reachable at `DATABASE_URL` (Docker compose
 * default) AND a valid `apps/web/.env` to start. The CI matrix will need a
 * Postgres service; for local runs we assume `docker compose -f
 * docker-compose.dev.yml up -d` was launched at the repo root.
 */
const webServer = process.env.PLAYWRIGHT_NO_SERVER
  ? undefined
  : {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    };

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false, // shared DB state — run serially
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-iphone-15', use: { ...devices['iPhone 15'] } },
  ],
  ...(webServer ? { webServer } : {}),
});
