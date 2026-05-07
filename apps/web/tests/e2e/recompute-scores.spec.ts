import { test, expect } from '@playwright/test';

/**
 * J6 — Public-surface E2E for the behavioral score recompute cron.
 *
 * Mirrors `checkin.spec.ts` posture: covers what's testable without
 * `CRON_SECRET` configured + no signed-in cookie. The full
 * trade-then-recompute flow is covered by `smoke-tour-j6.spec.ts`.
 *
 * Public surface today:
 *   - POST /api/cron/recompute-scores returns 401 (with secret) or 503 (no secret)
 *   - GET on the cron endpoint returns 405
 */

test.describe('Recompute-scores cron — secret gate', () => {
  test('POST /api/cron/recompute-scores without secret returns 401 or 503', async ({ request }) => {
    const response = await request.post('/api/cron/recompute-scores', {
      failOnStatusCode: false,
    });
    expect([401, 503]).toContain(response.status());
  });

  test('POST /api/cron/recompute-scores with wrong secret returns 401 or 503', async ({
    request,
  }) => {
    const response = await request.post('/api/cron/recompute-scores', {
      headers: { 'x-cron-secret': 'definitely-wrong-secret' },
      failOnStatusCode: false,
    });
    expect([401, 503]).toContain(response.status());
  });

  test('GET /api/cron/recompute-scores returns 405 method not allowed', async ({ request }) => {
    const response = await request.get('/api/cron/recompute-scores', {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(405);
  });
});
