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
  // Fail the CI run if a committed `.only` is present: a stray `test.only`
  // silently skips the entire rest of the suite, so a green build could be
  // hiding 99 % of the e2e coverage. Locally `.only` stays allowed for fast
  // iteration. (Cheap, zero-risk permanence gate — no committed `.only` exists
  // today, so this never flips a currently-green run red.)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // CI runs against `next dev` (compile-on-demand). A cold first hit on a
  // heavy route (e.g. /journal, /dashboard with Recharts) can take several
  // seconds while Next compiles it, which previously tripped the default
  // 5s `expect` / 30s navigation timeouts intermittently (`socket hang up`
  // is handled separately by the retry in `src/test/e2e-auth.ts`; this
  // covers the render-side cold-compile timeouts). The bumps only delay
  // FAILING assertions — passing ones resolve as soon as the element shows,
  // so the happy-path suite stays ~the same wall-clock. Local runs keep the
  // snappy defaults.
  //
  // ⚠️ CE COMMENTAIRE A ANNONCÉ « fix différé » APRÈS QUE LE FIX A ÉTÉ LIVRÉ.
  // Il disait : « le fix de fond (un serveur E2E `next start` de production)
  // est différé : il entre en conflit avec le refine `AUTH_URL must be HTTPS in
  // production` ». Ce serveur existe depuis `049fc7c5` —
  // `.github/workflows/e2e-prod-build.yml` lance `next build && next start` et
  // y fait tourner les gates 4/5/6 du service worker, le conflit `AUTH_URL`
  // étant résolu en lui passant `https://localhost:3000`. Laisser le mot
  // « différé » ici, c'est décrire comme impossible un chemin déjà emprunté —
  // et le prochain à lire renoncerait à l'élargir.
  //
  // Ce qui RESTE vrai, et qui justifie ces timeouts : la suite par défaut, y
  // compris les quatre shards requis, tourne toujours contre `pnpm dev`
  // (`webServer` ci-dessus). Le build de production ne couvre aujourd'hui que
  // les trois gates du service worker, là où la compilation à la demande
  // masquait le comportement des assets hachés.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    actionTimeout: process.env.CI ? 15_000 : 0,
    // `PW_NAV_TIMEOUT` lets a slow local disk (first-hit Turbopack compile can
    // exceed 30s — e.g. a cold `/api/auth/*` route measured at ~47s here)
    // absorb cold-compile navigations without tripping a false timeout.
    // Unset → identical to the previous behaviour, so CI is unchanged.
    navigationTimeout: Number(process.env.PW_NAV_TIMEOUT) || (process.env.CI ? 45_000 : 30_000),
    trace: process.env.PLAYWRIGHT_CAPTURE === 'all' ? 'on' : 'retain-on-failure',
    screenshot: process.env.PLAYWRIGHT_CAPTURE === 'all' ? 'on' : 'only-on-failure',
    video: process.env.PLAYWRIGHT_CAPTURE === 'all' ? 'on' : 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-iphone-15', use: { ...devices['iPhone 15'] } },
  ],
  ...(webServer ? { webServer } : {}),
});
