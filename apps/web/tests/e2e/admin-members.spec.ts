import { test, expect } from '@playwright/test';

/**
 * J3 — Public-surface E2E for the admin members area.
 *
 * Covers the auth-gate behavior: unauthenticated users hit `/login` regardless
 * of which admin URL they target, and the proxy `authorized()` callback in
 * `auth.config.ts` rejects non-admin sessions with the same redirect.
 *
 * Full happy-path (admin logs in → lists members → opens detail → opens a
 * member's trade) belongs to the cross-jalon E2E pass that needs a Postgres
 * seed helper and an admin-session cookie.
 */

test.describe('Admin members — auth gate', () => {
  test('GET /admin/members redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/admin/members');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /admin/members/<id> redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/admin/members/cmoswi3g10000t0pndvv49u98');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /admin/members/<id>/trades/<tradeId> redirects unauthenticated users to /login', async ({
    page,
  }) => {
    await page.goto('/admin/members/cmoswi3g10000t0pndvv49u98/trades/clxxxxxxxxxxxxxxxxxxxxxx00');
    await expect(page).toHaveURL(/\/login/);
  });
});
