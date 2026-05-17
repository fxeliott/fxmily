import { test, expect } from '@playwright/test';

/**
 * J-T2 — Public-surface E2E for Mode Entraînement (SPEC §21).
 *
 * Mirror of `journal.spec.ts`: we verify the auth gates and that the
 * `/training/*` surface is not public, without depending on a seeded user.
 * The full member happy-path (login → backtest → list) needs the Postgres
 * seed helper planned for the cross-jalon E2E pass — same boundary as the
 * journal suite.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): `/training/*` must be auth-gated exactly
 * like `/journal` (it is simply absent from the public whitelist in
 * `auth.config.ts`, so the proxy requires a session by default).
 */

test.describe('Training — public surface', () => {
  test('GET /training redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/training');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /training/new redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/training/new');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Uploads API — training kind auth gate', () => {
  test('POST /api/uploads (training-entry) is 401 for unauthenticated requests', async ({
    request,
  }) => {
    const response = await request.post('/api/uploads', {
      multipart: {
        kind: 'training-entry',
        file: {
          name: 'tiny.png',
          mimeType: 'image/png',
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
      },
    });
    expect(response.status()).toBe(401);
  });

  test('GET /api/uploads/<training-key> is 401 for unauthenticated requests', async ({
    request,
  }) => {
    const response = await request.get(
      '/api/uploads/training/clx00000000000000000000000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      { failOnStatusCode: false },
    );
    expect(response.status()).toBe(401);
  });
});
