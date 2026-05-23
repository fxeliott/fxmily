import { test, expect } from '@playwright/test';

/**
 * T5 — Public-surface E2E for the Admin Track Record CRUD.
 *
 * Same posture as `admin-annotation.spec.ts` (J4) : covers what's testable
 * without a seeded Postgres + admin-session cookie. The full happy-path
 * (admin logs in → creates trade → publish toggle → edit → delete → list
 * reflects mutations) lands in the cross-jalon E2E pass once the seed helper
 * lands (carry-over depuis J2).
 *
 * Public surface today :
 *   - GET /admin/track-record               → 307 /login (anonymous).
 *   - GET /admin/track-record/new           → 307 /login.
 *   - GET /admin/track-record/<id>/edit     → 307 /login (regardless of id valid/invalid).
 *
 * Pages render-sans-throw verifies l'autorité du gate (proxy `auth.config.ts`
 * authorized() callback) — la 307 prouve que toute la chain auth + Server
 * Component loader fonctionne (sinon le request crash en 500).
 */

test.describe('Admin track record — auth gate', () => {
  test('GET /admin/track-record redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/admin/track-record');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /admin/track-record/new redirects unauthenticated users to /login', async ({
    page,
  }) => {
    await page.goto('/admin/track-record/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /admin/track-record/<id>/edit redirects unauthenticated users to /login', async ({
    page,
  }) => {
    // ID arbitraire — l'auth gate doit fire AVANT le findUnique (qui sinon
    // pour un ID inexistant retournerait notFound = 404). Le 307 prouve que
    // proxy auth.config.ts cut court avant la page Server Component.
    await page.goto('/admin/track-record/clxxxxxxxxxxxxxxxxxxxxxx00/edit');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /admin/track-record passes URL filter searchParams through (anonymous → /login)', async ({
    page,
  }) => {
    // Vérifie que l'auth gate ne crash pas sur des searchParams présents.
    // Le proxy s'applique avant le parsing — donc même avec des filters,
    // le user anonyme finit sur /login.
    await page.goto('/admin/track-record?segment=live&status=open');
    await expect(page).toHaveURL(/\/login/);
  });
});
