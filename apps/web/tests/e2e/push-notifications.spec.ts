import { test, expect } from '@playwright/test';

/**
 * J9 — Public-surface E2E for the Web Push notifications dispatcher.
 *
 * Mirrors `recompute-scores.spec.ts` + `weekly-reports` patterns: covers what's
 * testable without `CRON_SECRET` configured AND without a signed-in cookie.
 * The full subscribe → dispatch → audit flow is covered by `smoke-test-j9.ts`
 * (a tsx script driven directly against the dev server with Postgres seed).
 *
 * Public surface today:
 *   - GET /account/notifications redirects to /login when unauthenticated
 *   - POST /api/cron/dispatch-notifications returns 401 (with secret) or 503 (no secret)
 *   - GET on the cron endpoint returns 405
 */

test.describe('/account/notifications — auth gate', () => {
  test('GET unauthenticated redirects to /login', async ({ page }) => {
    const response = await page.goto('/account/notifications');
    // Either a 307 (redirect) or a 200 page that landed on /login.
    expect(page.url()).toContain('/login');
    // Status code may be 200 (post-redirect) or 3xx — both acceptable.
    if (response !== null) {
      expect([200, 307, 308]).toContain(response.status());
    }
  });
});

test.describe('Dispatch-notifications cron — secret gate', () => {
  test('POST /api/cron/dispatch-notifications without secret returns 401 or 503', async ({
    request,
  }) => {
    const response = await request.post('/api/cron/dispatch-notifications', {
      failOnStatusCode: false,
    });
    expect([401, 503]).toContain(response.status());
  });

  test('POST /api/cron/dispatch-notifications with wrong secret returns 401 or 503', async ({
    request,
  }) => {
    const response = await request.post('/api/cron/dispatch-notifications', {
      headers: { 'x-cron-secret': 'definitely-wrong-secret-j9' },
      failOnStatusCode: false,
    });
    expect([401, 503]).toContain(response.status());
  });

  test('GET /api/cron/dispatch-notifications returns 405 method not allowed', async ({
    request,
  }) => {
    const response = await request.get('/api/cron/dispatch-notifications', {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(405);
  });
});

test.describe('/sw.js — service worker manifest', () => {
  test('GET /sw.js returns 200 with JS content-type and no-cache header', async ({ request }) => {
    const response = await request.get('/sw.js', { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType).toContain('javascript');
    const cacheControl = response.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('no-cache');
  });
});

test.describe('/manifest.webmanifest — PWA manifest', () => {
  test('GET /manifest.webmanifest returns valid JSON manifest', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest', { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    const manifest = (await response.json()) as Record<string, unknown>;
    expect(manifest.name).toBe('Fxmily');
    expect(manifest.display).toBe('standalone');
    expect(Array.isArray(manifest.icons)).toBe(true);
  });
});
