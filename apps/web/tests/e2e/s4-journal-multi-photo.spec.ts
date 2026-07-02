/**
 * S4 §31 « photos » pluriel (LEGACY DISPLAY) — J1 retired the in-wizard photo
 * uploaders (mandatory capture → TradingView link ; the §31 additional-photo
 * gallery removed with it — one live TradingView link carries richer analysis
 * than N static captures). Trades created BEFORE J1 can still carry
 * `TradeMedia` rows, so the detail page MUST keep rendering them gracefully.
 *
 * This spec seeds a legacy trade + 2 `TradeMedia` rows straight through Prisma
 * (no removed UI to drive) and asserts, END TO END against real Postgres:
 *   1. the detail page shows « Photos d'analyse additionnelles (2) » ;
 *   2. exactly 2 thumbnails render, their src resolving to the upload route
 *      (proves the CodeQL safeUploadUrl guard didn't blank a legit URL) ;
 *   3. the DB still carries the 2 TradeMedia rows under the member's prefix.
 *
 * Determinism (canon J-C3): NO `networkidle`; every assertion gates on an
 * auto-waiting `expect(locator)`.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

async function dismissCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

let member: SeededUser | null = null;

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return { ok: false, reason: `Chromium binary not found at ${exec || '(unresolved)'}` };
  }
  return { ok: true };
}

test.describe('S4 — /journal : les photos §31 LEGACY restent affichées (real DB)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');
    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S4Multi' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('un trade legacy avec 2 TradeMedia rend « Photos d’analyse additionnelles (2) »', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const memberUser = member;

    // Seed a legacy OPEN trade straight through Prisma + 2 entry-kind media
    // rows under the member's own storage prefix (BOLA-shaped keys).
    const trade = await db.trade.create({
      data: {
        userId: memberUser.id,
        pair: 'EURUSD',
        direction: 'long',
        session: 'london',
        enteredAt: new Date(Date.now() - 60 * 60 * 1000),
        entryPrice: 1.085,
        lotSize: 0.1,
        stopLossPrice: 1.08,
        plannedRR: 2,
        emotionBefore: ['calm'],
        planRespected: true,
        media: {
          create: [
            {
              kind: 'entry',
              fileKey: `trades/${memberUser.id}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`,
            },
            {
              kind: 'entry',
              fileKey: `trades/${memberUser.id}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png`,
            },
          ],
        },
      },
      select: { id: true },
    });

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, memberUser.email, memberUser.password);

    await page.goto(`/journal/${trade.id}`, { waitUntil: 'domcontentloaded' });

    // The §31 legacy section renders with its exact count + 2 thumbnails.
    await expect(
      // apostrophe-agnostic (`&apos;` renders U+0027, not the curly U+2019).
      page.getByRole('heading', { name: /Photos d.analyse additionnelles \(2\)/ }),
    ).toBeVisible();
    const thumbs = page.getByAltText(/Photo d'analyse \d du trade EURUSD/);
    await expect(thumbs).toHaveCount(2);
    // The whitelisted thumbnail src still resolves to the upload route — proves
    // the CodeQL safeUploadUrl guard didn't blank a legitimate URL.
    await expect(thumbs.first()).toHaveAttribute('src', /^\/api\/uploads\/trades\//);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

    // Real DB: the 2 TradeMedia rows persist under the member's prefix.
    const persisted = await db.trade.findFirst({
      where: { id: trade.id },
      select: { media: { select: { kind: true, fileKey: true } } },
    });
    expect(persisted!.media).toHaveLength(2);
    for (const m of persisted!.media) {
      expect(m.kind).toBe('entry');
      expect(m.fileKey).toMatch(new RegExp(`^trades/${memberUser.id}/`));
    }
  });
});
