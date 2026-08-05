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
import { test as base, type Locator, type Page } from '@playwright/test';

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

/**
 * Root a content locator in the page content that is REALLY PLACED, excluding
 * React's streaming staging area.
 *
 * WHY THIS EXISTS — measured, not theorised. `s7-admin-espace.spec.ts` failed
 * three times in a row in CI (run 31001531324, shard 2/4) then passed on re-run
 * with no code change. The failure trace shows what the DOM looked like the
 * instant `page.goto()` returned:
 *
 *   <body>
 *     <div class="…lg:pl-64">…<div id="main-content">…<main>   ← PLACED, still EMPTY
 *     <div hidden id="S:0"><main>…the real content…</main></div>  ← STAGING
 *
 * React streams a Suspense boundary's HTML into a `hidden` staging div that is a
 * DIRECT CHILD OF <body>, then an inline script relocates it into the placed
 * slot. While that relocation happens the document holds TWO <main> elements and
 * TWO copies of the content, so a page-rooted `main li` locator resolves to two
 * elements → `strict mode violation`, which is FATAL (never retried away). It is
 * also why the same run first logged `unexpected value "hidden"`: the only copy
 * it could see at that moment was the staged one, inside `[hidden]`.
 *
 * Measured on a real page: `main li …` is ambiguous on at least 1 load out of 12
 * (a 1 ms sampler necessarily misses part of the window, so that is a floor);
 * `#main-content main li …` is ambiguous on 0/12 — and CANNOT be, since the
 * staging div lives outside `#main-content` (see `app/layout.tsx`).
 *
 * Use this instead of `page.locator('main …')` / `page.getByRole('main')` for any
 * assertion that runs right after a navigation. It is STRICTER than the raw
 * locator, never more permissive: `.first()` would have hidden the race instead
 * of removing it.
 */
export function placedMain(page: Page): Locator {
  return page.locator('#main-content main');
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
