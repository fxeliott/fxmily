import { test, expect } from '@playwright/test';

/**
 * J4 — Public-surface E2E for the admin annotation flow.
 *
 * Same posture as `admin-members.spec.ts`: covers what's testable without a
 * seeded Postgres + admin-session cookie. The full happy-path (admin logs in
 * → opens trade → annotates → member badge appears → member opens → seen
 * timestamp set) lands in the cross-jalon E2E pass once the seed helper
 * lands. Public surface today:
 *
 *   - The admin trade-detail URL still 302s unauthenticated traffic.
 *   - POST /api/uploads with `kind=annotation-image` is auth-gated (401).
 *   - POST /api/uploads with `kind=annotation-image` AND a non-admin session
 *     would 403; we can't observe that without a seeded member cookie, so
 *     we leave it to the cross-jalon E2E pass.
 */

test.describe('Admin annotation — auth gate', () => {
  test('GET /admin/members/<id>/trades/<tradeId> redirects unauthenticated users to /login', async ({
    page,
  }) => {
    await page.goto('/admin/members/cmoswi3g10000t0pndvv49u98/trades/clxxxxxxxxxxxxxxxxxxxxxx00');
    await expect(page).toHaveURL(/\/login/);
  });

  test('POST /api/uploads kind=annotation-image returns 401 without auth', async ({ request }) => {
    const formData = new FormData();
    formData.append('kind', 'annotation-image');
    formData.append('tradeId', 'clxxxxxxxxxxxxxxxxxxxxxx00');
    // Deliberately no `file` — we want to assert the auth gate fires before
    // body parsing, not the missing-file branch.
    const response = await request.post('/api/uploads', {
      multipart: {
        kind: 'annotation-image',
        tradeId: 'clxxxxxxxxxxxxxxxxxxxxxx00',
      },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(401);
  });

  test('POST /api/uploads with an unknown kind still returns 401 without auth', async ({
    request,
  }) => {
    const response = await request.post('/api/uploads', {
      multipart: { kind: 'bogus' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(401);
  });

  test('GET /api/uploads/<annotation-key> returns 401 without auth', async ({ request }) => {
    const response = await request.get(
      '/api/uploads/annotations/clxxxxxxxxxxxxxxxxxxxxxx00/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
      { failOnStatusCode: false },
    );
    expect(response.status()).toBe(401);
  });
});
