/**
 * J9 visual smoke — `/account/notifications` page screenshots.
 *
 * Captures two screenshots as the visual evidence attached to PR #33:
 *   1. unauthenticated GET → redirect to /login
 *   2. authenticated GET as a member → renders the notifications page
 *
 * V1 caveat (acceptable per the briefing): in dev without `VAPID_PUBLIC_KEY`
 * configured, `<PushToggle>` is rendered as the "Configuration en attente"
 * fallback instead of one of the 5 active states (loading / idle-no-sub /
 * subscribed / unsupported / not-standalone / permission-denied). The
 * screenshot still proves the auth gate works, the page Server Component
 * renders without crashing, and the page chrome (header + Pill + sections)
 * is correct.
 *
 * Skipping policy:
 *   - If Playwright Chromium isn't usable (binary missing), the suite is
 *     skipped with a clear `test.skip(...)` message rather than failing.
 *
 * Output:
 *   - `apps/web/test-results/captures-j9/01-redirect-login.png`
 *   - `apps/web/test-results/captures-j9/02-notifications-page.png`
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { chromium } from '@playwright/test';

import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const SEED_EMAIL = 'j9.visual.member.e2e.test@fxmily.local';
const SEED_PASSWORD = 'J9VisualPwd-2026!';
const CAPTURES_DIR = path.join('test-results', 'captures-j9');

let seeded: SeededUser | null = null;

/**
 * Probe whether Playwright can actually launch Chromium.
 * Catches the most common failure mode (binary not installed) and lets the
 * suite skip gracefully with a pedagogical message instead of crashing the
 * whole `pnpm test:e2e` invocation.
 */
async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run this suite.`,
    };
  }
  return { ok: true };
}

test.describe('J9 visual — /account/notifications', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await mkdir(CAPTURES_DIR, { recursive: true });
    // Idempotent cleanup before seeding (in case a previous run left rows
    // behind — `cleanupTestUsers` matches every `*.e2e.test@fxmily.local`).
    await cleanupTestUsers();
    seeded = await seedMemberUser({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      firstName: 'J9',
      lastName: 'Visual',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('GET /account/notifications unauthenticated → redirect to /login', async ({ page }) => {
    await page.goto('/account/notifications');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/login');

    await page.screenshot({
      path: path.join(CAPTURES_DIR, '01-redirect-login.png'),
      fullPage: true,
    });
  });

  test('GET /account/notifications authenticated as member → renders', async ({
    page,
    request,
  }) => {
    if (!seeded) throw new Error('seed missing — beforeAll did not run');

    // The shared `loginAs` helper resolves `baseURL` from
    // `page.context().pages()[0]?.url()`. On a fresh test the only page is
    // still `about:blank`, whose `URL(...).origin` parses to the literal
    // string `'null'` and crashes `browserContext.addCookies` with
    // "Invalid URL". Navigating to a real route first puts a valid origin
    // (http://localhost:3000) in the page URL so the helper resolves cleanly.
    await page.goto('/login');

    await loginAs(page, request, seeded.email, seeded.password);
    await page.goto('/account/notifications');
    await page.waitForLoadState('networkidle');

    // The page heading is the cheapest invariant we can lean on: it shows up
    // regardless of whether VAPID is configured (idle-no-sub vs config
    // pending fork happens *under* the header).
    await expect(page.getByRole('heading', { level: 1, name: /Notifications/i })).toBeVisible();

    await page.screenshot({
      path: path.join(CAPTURES_DIR, '02-notifications-page.png'),
      fullPage: true,
    });
  });
});
