/**
 * Shared Playwright test fixtures for the Fxmily E2E suite.
 *
 * WHY THIS EXISTS.
 * The global `<CookieBanner>` (app/layout.tsx) is `position: fixed; bottom;
 * z-40`. On several surfaces it sits ON TOP of a sticky wizard footer or a
 * bottom-right FAB, so its subtree intercepts the click a test aims at the CTA
 * underneath — a flake that reads as "the button doesn't work". Every spec used
 * to carry its OWN `dismissCookieBanner(page)` helper (19 identical copies), and
 * a spec that FORGOT it hit the intercept in CI only. This fixture pre-seeds the
 * banner's dismiss flag ONCE, for every test, via the overridden `page` fixture —
 * so no spec has to remember, and the banner never mounts during a run.
 *
 * It is an INFO-only banner (SPEC §16 — technical cookies only, no consent gate),
 * so pre-dismissing it changes nothing about what the tests exercise.
 *
 * OPT-OUT. A spec that actually needs to SEE the banner (e.g. one testing the
 * banner itself) sets `test.use({ seedCookieDismissed: false })` at the top of
 * its describe block. None do today, but the escape hatch keeps the default
 * honest and future-proof.
 *
 * USAGE. Import `test` (and `expect`, `chromium`, … re-exported below) from this
 * module instead of `@playwright/test`:
 *   import { test, expect } from './fixtures';
 */
import { test as base, type Page } from '@playwright/test';

/** The localStorage key the CookieBanner reads (components/legal/cookie-banner.tsx). */
const COOKIE_DISMISSED_KEY = 'fxmily.cookie.dismissed';

/**
 * Seed the cookie-banner dismiss flag on a page the DEFAULT fixture doesn't own
 * — a spec that opens its own `browser.newContext().newPage()` (e.g. an admin +
 * member in two contexts) must call this before the first navigation of each
 * such page, since the overridden `page` fixture only covers the primary page.
 */
export async function dismissCookieBannerOn(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, '1');
  }, COOKIE_DISMISSED_KEY);
}

type Fixtures = {
  /** When true (default), pre-seed the cookie-banner dismiss flag on every page. */
  seedCookieDismissed: boolean;
};

export const test = base.extend<Fixtures>({
  // Option — overridable per-spec via `test.use({ seedCookieDismissed: false })`.
  seedCookieDismissed: [true, { option: true }],

  // Override the built-in `page` fixture so the seed runs before the first
  // navigation of EVERY test. `addInitScript` re-runs on each document, so the
  // flag is present the instant the app boots — the banner's SSR snapshot is
  // already `hidden` and it never mounts.
  // (The fixture callback is named `run`, not Playwright's usual `use`, so
  // react-hooks/rules-of-hooks doesn't mistake it for React's `use` hook.)
  page: async ({ page, seedCookieDismissed }, run) => {
    if (seedCookieDismissed) {
      await page.addInitScript((key) => {
        window.localStorage.setItem(key, '1');
      }, COOKIE_DISMISSED_KEY);
    }
    await run(page);
  },
});

// Re-export the rest of the Playwright test API so a spec only has to swap the
// import PATH (`@playwright/test` → `./fixtures`), never its named imports.
export {
  expect,
  chromium,
  request,
  devices,
  type Page,
  type Locator,
  type BrowserContext,
  type ConsoleMessage,
  type APIRequestContext,
} from '@playwright/test';
