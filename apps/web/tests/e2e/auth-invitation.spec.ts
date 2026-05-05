import { test, expect } from '@playwright/test';

/**
 * J1 — End-to-end smoke test for the full invitation → onboarding → login flow.
 *
 * Prerequisite: a real Postgres reachable at `DATABASE_URL`, an admin user
 * already seeded in the DB, and the dev fallback for emails (no
 * `RESEND_API_KEY`) so the magic URL is logged in the server console.
 *
 * To run:
 *   1. Seed an admin: `pnpm --filter @fxmily/web exec tsx scripts/seed-admin.ts`
 *      (script not part of J1 — for now insert manually via prisma studio).
 *   2. `pnpm --filter @fxmily/web test:e2e`
 *
 * This test is intentionally narrow: it covers the public-facing flow (login
 * page renders, onboarding page handles missing token gracefully, admin invite
 * page is gated). Full happy-path with a real email round-trip lives in J1.5
 * once the magic-URL capture helper is in place.
 */

test.describe('Auth pages — public surface', () => {
  test('login page renders the form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /connexion/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/mot de passe/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /se connecter/i })).toBeEnabled();
  });

  test('onboarding without a token shows the invalid-link state', async ({ page }) => {
    await page.goto('/onboarding/welcome');
    await expect(page.getByRole('heading', { name: /lien invalide/i })).toBeVisible();
  });

  test('onboarding with an unknown token shows the invalid-link state', async ({ page }) => {
    await page.goto('/onboarding/welcome?token=does-not-exist-aaaaaaaaaaa');
    await expect(page.getByRole('heading', { name: /lien invalide/i })).toBeVisible();
  });

  test('admin invite page redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/admin/invite');
    await expect(page).toHaveURL(/\/login/);
  });

  test('dashboard redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
