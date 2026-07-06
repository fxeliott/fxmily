/**
 * Visual smoke-tour J6 — admin member journey through the new dashboard.
 *
 * Captures the dashboard rendered against the deterministic seed set
 * (seedTradeHistory + seedCheckinHistory), then the admin member-detail
 * overview tab with the J6.5 score integration.
 *
 * Run with `PLAYWRIGHT_CAPTURE=all` to keep screenshots even when the test
 * passes. Output: `apps/web/test-results/captures/`.
 *
 * Behavioural coverage stays in the dedicated unit/integration suites; this
 * test is for visual regression + onboarding docs + design review across
 * jalons.
 */

import { expect, test } from './fixtures';

import {
  cleanupTestUsers,
  seedAdminUser,
  seedCheckinHistory,
  seedTradeHistory,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let seeded: SeededUser | null = null;

// V1.9 hygiène 2026-05-15 round 3 : ROOT CAUSE FOUND + FIXED.
// `loginAs` helper was reading `page.context().pages()[0]?.url()` to
// determine the baseURL, but that returns `'about:blank'` for a fresh
// context (truthy → fallback `?? 'http://localhost:3000'` bypassed).
// `new URL('about:blank').origin === 'null'` → callbackUrl became
// `'null/dashboard'` → Auth.js v5 `new URL(callbackUrl)` threw
// `TypeError: Invalid URL` → session cookie never set.
// Fix: `loginAs` now reads `process.env.PLAYWRIGHT_BASE_URL` directly
// (same source of truth as `playwright.config.ts:28`). Un-fixme.
test.describe('Visual smoke-tour J6 — admin dashboard with seeded analytics', () => {
  test.beforeEach(async () => {
    await cleanupTestUsers();
    seeded = await seedAdminUser({
      firstName: 'Eve',
      lastName: 'J6Tour',
    });
    await seedTradeHistory(seeded.id, { count: 100, seed: 42 });
    await seedCheckinHistory(seeded.id, { days: 30, seed: 42 });
  });

  test.afterEach(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('login → dashboard 30d → dashboard 7d → admin member detail', async ({ page, request }) => {
    if (!seeded) throw new Error('seed missing');

    // ─── 1) Login + redirect to dashboard ───────────────────────────────
    await loginAs(page, request, seeded.email, seeded.password);

    // ─── 2) Dashboard default range (30j) ───────────────────────────────
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/j6-01-dashboard-30d.png',
      fullPage: true,
    });

    // ─── 3) Dashboard range = 7j (URL param toggle) ─────────────────────
    await page.goto('/dashboard?range=7d');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/j6-02-dashboard-7d.png',
      fullPage: true,
    });

    // ─── 4) Dashboard range = 6m (longer window) ────────────────────────
    await page.goto('/dashboard?range=6m');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/j6-03-dashboard-6m.png',
      fullPage: true,
    });

    // ─── 5) Admin members list ──────────────────────────────────────────
    await page.goto('/admin/members');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/j6-04-admin-members-list.png',
      fullPage: true,
    });

    // ─── 6) Admin member detail — Overview tab with J6.5 scores ─────────
    await page.goto(`/admin/members/${seeded.id}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/j6-05-admin-member-overview-with-scores.png',
      fullPage: true,
    });

    // ─── 7) Mobile viewport (iPhone SE) ─────────────────────────────────
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/captures/j6-06-dashboard-mobile-iphone-se.png',
      fullPage: true,
    });

    // ─── 8) Mobile patterns scroll (iPhone SE) ──────────────────────────
    await page
      .getByText('Patterns', { exact: false })
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({
      path: 'test-results/captures/j6-07-dashboard-mobile-patterns.png',
      fullPage: true,
    });
  });

  // S4 — own test block (the visual tour above already runs close to the 30s
  // budget; piggy-backing these steps onto it timed the whole tour out).
  test('S4 — /verification at 375px + FAB vs legal footer geometry (DOD4-B1)', async ({
    page,
    request,
  }) => {
    if (!seeded) throw new Error('seed missing');
    await loginAs(page, request, seeded.email, seeded.password);

    // ─── /verification joins the 375px sweep (S3 surface, S4 DoD#4) ─────
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/verification');
    await expect(page.getByRole('heading', { name: 'Ta réalité de trading' })).toBeVisible();
    await page.screenshot({
      path: 'test-results/captures/j6-08-verification-mobile-iphone-se.png',
      fullPage: true,
    });

    // ─── DOD4-B1 regression lock — the Log-Express FAB must never cover
    //     the legal footer nav (≥640px, where the nav is right-aligned). ──
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto('/dashboard');
    const fab = page.locator('[data-slot="log-express-fab"]');
    const mentions = page.getByRole('link', { name: 'Mentions légales' });
    await expect(fab).toBeVisible();
    await mentions.scrollIntoViewIfNeeded();
    await expect(mentions).toBeVisible();
    const fabBox = await fab.boundingBox();
    const linkBox = await mentions.boundingBox();
    if (!fabBox || !linkBox) throw new Error('FAB or legal link not measurable');
    const horizontalOverlap =
      linkBox.x < fabBox.x + fabBox.width && fabBox.x < linkBox.x + linkBox.width;
    const verticalOverlap =
      linkBox.y < fabBox.y + fabBox.height && fabBox.y < linkBox.y + linkBox.height;
    expect(horizontalOverlap && verticalOverlap).toBe(false);
  });
});
