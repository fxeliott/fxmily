import { expect, test } from '@playwright/test';

/**
 * V1.8 REFLECT — Public-surface E2E auth gates.
 *
 * Posture identical to J5 `checkin.spec.ts` carbone : we cover what is
 * testable without a seeded Postgres + signed-in cookie. The wizard
 * happy-path (login → fill 5 steps → see crisis banner / recent timeline)
 * lands once the cross-jalon seed helper exists.
 *
 * Public surface today :
 *   - `/review`, `/review/new`, `/reflect`, `/reflect/new` all redirect
 *     unauthenticated visitors to `/login`.
 *   - The `/api/admin/weekly-batch/*` admin endpoints (V1.7.2) are NOT
 *     in the V1.8 surface — they keep their own spec.
 *
 * Anti-pattern guarded : these pages are auth-gated at the Server
 * Component level (top-of-file `auth()` + redirect). They are NOT
 * protected solely by the proxy.ts matcher — so even if the matcher
 * regresses, anonymous traffic still bounces here.
 */

test.describe('V1.8 REFLECT pages — auth gate', () => {
  test('GET /review redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/review');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /review/new redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/review/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /reflect redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/reflect');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /reflect/new redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/reflect/new');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('V1.8 REFLECT — crisis banner URL state honoured (visual)', () => {
  // These tests only verify the redirect target — the visual banner mounts
  // post-login (gated). Anonymous visit to /review?crisis=high must still
  // bounce to /login (the URL state alone doesn't bypass the gate).
  test('GET /review?crisis=high still redirects unauthenticated users', async ({ page }) => {
    await page.goto('/review?crisis=high');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /review?crisis=medium still redirects unauthenticated users', async ({ page }) => {
    await page.goto('/review?crisis=medium');
    await expect(page).toHaveURL(/\/login/);
  });
});
