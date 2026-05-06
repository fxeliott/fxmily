import { test, expect } from '@playwright/test';

/**
 * J5 — Public-surface E2E for the daily check-in flow.
 *
 * Posture identical to J2/J3/J4 specs: we cover what's testable without a
 * seeded Postgres + signed-in cookie. The full member happy-path (login →
 * fill morning wizard → see streak go up) lands once the cross-jalon seed
 * helper exists.
 *
 * Public surface today:
 *   - /checkin, /checkin/morning, /checkin/evening all redirect unauth → /login
 *   - POST /api/cron/checkin-reminders returns 401 without the secret header
 *     (or 503 if CRON_SECRET isn't configured in the test environment)
 *   - GET on the cron endpoint returns 405
 */

test.describe('Check-in pages — auth gate', () => {
  test('GET /checkin redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/checkin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /checkin/morning redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/checkin/morning');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /checkin/evening redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/checkin/evening');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Cron endpoint — secret gate', () => {
  test('POST /api/cron/checkin-reminders without secret returns 401 or 503', async ({
    request,
  }) => {
    const response = await request.post('/api/cron/checkin-reminders', {
      failOnStatusCode: false,
    });
    // 401 when CRON_SECRET is configured, 503 when it isn't (refuse-by-default
    // in dev/CI without the secret set).
    expect([401, 503]).toContain(response.status());
  });

  test('POST /api/cron/checkin-reminders with wrong secret returns 401 or 503', async ({
    request,
  }) => {
    const response = await request.post('/api/cron/checkin-reminders', {
      headers: { 'x-cron-secret': 'definitely-wrong-secret' },
      failOnStatusCode: false,
    });
    expect([401, 503]).toContain(response.status());
  });

  test('GET /api/cron/checkin-reminders returns 405 method not allowed', async ({ request }) => {
    const response = await request.get('/api/cron/checkin-reminders', {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(405);
  });
});
