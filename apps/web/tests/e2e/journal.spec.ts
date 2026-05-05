import { test, expect } from '@playwright/test';

/**
 * J2 — Public-surface E2E for the trading journal.
 *
 * Like the J1 invitation test, this stays narrow: we verify the auth gates
 * and the basic page renders without depending on a seeded user. The full
 * member happy-path (login → create → close → list) needs a Postgres seed
 * helper that's planned for the cross-jalon E2E pass.
 */

test.describe('Journal — public surface', () => {
  test('GET /journal redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /journal/new redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/journal/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /journal/some-id redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/journal/clx00000000000000000000000');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /journal/some-id/close redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/journal/clx00000000000000000000000/close');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Uploads API — auth gate', () => {
  test('POST /api/uploads is 401 for unauthenticated requests', async ({ request }) => {
    const response = await request.post('/api/uploads', {
      multipart: {
        kind: 'trade-entry',
        // Minimal "file" — server rejects on auth before reading bytes.
        file: {
          name: 'tiny.png',
          mimeType: 'image/png',
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
      },
    });
    expect(response.status()).toBe(401);
  });

  test('GET /api/uploads/<key> is 401 for unauthenticated requests', async ({ request }) => {
    const response = await request.get(
      '/api/uploads/trades/clx00000000000000000000000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      { failOnStatusCode: false },
    );
    expect(response.status()).toBe(401);
  });
});
