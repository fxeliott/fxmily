/**
 * V1.5.2 E2E — `tradeQuality` + `riskPct` capture / persist / render.
 *
 * Couvre les 3 phases du critère "Done quand" V1.5.2 §4 :
 *
 *   1. **CAPTURE** — un trade créé directement via Prisma avec
 *      `tradeQuality='A'` + `riskPct='1.5'` est accepté par le schéma DB
 *      (le typage Prisma 7 garantit le contrat à la compilation, le test
 *      le re-vérifie au runtime).
 *   2. **PERSIST** — round-trip DB : ce qu'on a écrit est ce qu'on relit
 *      avec les types exacts (`'A' | 'B' | 'C' | null` pour `tradeQuality`,
 *      `Decimal | null` pour `riskPct` — sérialisé en `.toString()`).
 *   3. **RENDER** — la page `/journal/[id]` charge sans crash sur un trade
 *      qui porte les V1.5 fields (preuve de rétro-compatibilité du rendu
 *      existant — la trade-detail-view ne lit pas encore `tradeQuality`
 *      / `riskPct` côté UI, mais ne doit pas casser non plus). La page
 *      `/journal` (liste) est aussi vérifiée.
 *
 * Ce qui n'est PAS couvert ici (déjà testé ailleurs ou hors scope V1.5.2) :
 *   - Le wizard 6-step happy-path (steps 1→6 avec uploads) — les Vitest
 *     unit tests `lib/schemas/trade.test.ts` + `journal/actions.test.ts`
 *     couvrent le formulaire au niveau Zod / Server Action.
 *   - Le rendering UI explicite des badges A/B/C / Risque % dans la
 *     trade-detail-view — reclassé "render premium" V2 (pas un blocker
 *     V1.5.2, le DB round-trip est ce qui débloque le pipeline IA).
 *
 * Skipping policy (carbone J9 visual) :
 *   - Si Playwright Chromium n'est pas installé, la suite skip avec un
 *     message clair plutôt que de planter `pnpm test:e2e`.
 */

import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { chromium } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const SEED_EMAIL = 'v1-5-2.member.e2e.test@fxmily.local';
const SEED_PASSWORD = 'V1_5_2-WizardPwd-2026!';

let seeded: SeededUser | null = null;

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run this suite.`,
    };
  }
  return { ok: true };
}

test.describe('V1.5.2 — wizard tradeQuality + riskPct capture/persist/render', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    // Idempotent cleanup before seeding.
    await cleanupTestUsers();
    seeded = await seedMemberUser({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      firstName: 'V1_5_2',
      lastName: 'Wizard',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('CAPTURE + PERSIST: a trade with tradeQuality=A + riskPct=1.5 round-trips through Prisma', async () => {
    if (!seeded) throw new Error('seed missing — beforeAll did not run');

    const trade = await db.trade.create({
      data: {
        userId: seeded.id,
        pair: 'EURUSD',
        direction: 'long',
        session: 'london',
        enteredAt: new Date('2026-05-09T08:30:00.000Z'),
        entryPrice: 1.085,
        lotSize: 0.1,
        stopLossPrice: 1.08,
        plannedRR: 2,
        // V1.5 — Steenbarger setup quality.
        tradeQuality: 'A',
        // V1.5 — Tharp risk %. Decimal(4, 2) — Prisma 7 accepts string.
        riskPct: '1.5',
        emotionBefore: ['focused'],
        planRespected: true,
        hedgeRespected: null,
      },
      select: {
        id: true,
        tradeQuality: true,
        riskPct: true,
      },
    });

    // Persist round-trip — value type-narrowed to the V1.5 contract.
    expect(trade.tradeQuality).toBe('A');
    expect(trade.riskPct).not.toBeNull();
    // Decimal serialization — V1.5.2 still uses Decimal(4, 2) (audit fix #6).
    expect(trade.riskPct?.toString()).toBe('1.5');
  });

  test('CAPTURE + PERSIST: tradeQuality=C + riskPct=2.5 (Tharp ceiling violation row)', async () => {
    if (!seeded) throw new Error('seed missing');

    const trade = await db.trade.create({
      data: {
        userId: seeded.id,
        pair: 'XAUUSD',
        direction: 'short',
        session: 'newyork',
        enteredAt: new Date('2026-05-09T14:00:00.000Z'),
        entryPrice: 2050,
        lotSize: 0.01,
        plannedRR: 1.5,
        tradeQuality: 'C',
        // > 2 % = above Tharp ceiling, kept as a fixture for Tharp
        // riskPctOverTwoCount counter assertion in the builder.
        riskPct: '2.5',
        emotionBefore: ['fomo'],
        planRespected: false,
        hedgeRespected: null,
      },
      select: { id: true, tradeQuality: true, riskPct: true },
    });

    expect(trade.tradeQuality).toBe('C');
    expect(trade.riskPct?.toString()).toBe('2.5');
  });

  test('CAPTURE + PERSIST: tradeQuality=null + riskPct=null (V1 backward-compat row)', async () => {
    if (!seeded) throw new Error('seed missing');

    const trade = await db.trade.create({
      data: {
        userId: seeded.id,
        pair: 'GBPUSD',
        direction: 'long',
        session: 'london',
        enteredAt: new Date('2026-05-09T09:00:00.000Z'),
        entryPrice: 1.27,
        lotSize: 0.1,
        plannedRR: 2,
        // V1 trades created BEFORE V1.5 rollout have NULL on both fields.
        // The schema must keep accepting them without breakage.
        emotionBefore: [],
        planRespected: true,
        hedgeRespected: null,
      },
      select: { id: true, tradeQuality: true, riskPct: true },
    });

    expect(trade.tradeQuality).toBeNull();
    expect(trade.riskPct).toBeNull();
  });

  test('RENDER: /journal/[id] loads without crash on a V1.5 trade row', async ({
    page,
    request,
  }) => {
    if (!seeded) throw new Error('seed missing');

    const trade = await db.trade.create({
      data: {
        userId: seeded.id,
        pair: 'NAS100',
        direction: 'long',
        session: 'overlap',
        enteredAt: new Date('2026-05-09T13:00:00.000Z'),
        entryPrice: 18250,
        lotSize: 0.01,
        plannedRR: 3,
        tradeQuality: 'B',
        riskPct: '1.0',
        emotionBefore: ['confident'],
        planRespected: true,
        hedgeRespected: null,
      },
      select: { id: true },
    });

    // The shared loginAs helper resolves baseURL from the first page's URL.
    // Navigate to /login first to seat a real origin.
    await page.goto('/login');
    await loginAs(page, request, seeded.email, seeded.password);

    await page.goto(`/journal/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // The trade detail page renders the pair as the heading (J2 contract).
    await expect(page.getByText(/NAS100/i).first()).toBeVisible();

    // Smoke check: no client-side error overlay rendered (the V1.5 fields
    // are present on the row even if the UI does not surface them yet —
    // backwards compat with the J2 detail view).
    const errorOverlay = page.locator('[data-nextjs-dialog-overlay]');
    await expect(errorOverlay).toHaveCount(0);
  });

  test('RENDER: /journal list page loads when V1.5 trades coexist with V1 trades', async ({
    page,
    request,
  }) => {
    if (!seeded) throw new Error('seed missing');

    // We rely on the rows seeded by the previous tests in this file (the same
    // user, no afterEach cleanup in between — afterAll is the only cleanup).
    await page.goto('/login');
    await loginAs(page, request, seeded.email, seeded.password);

    await page.goto('/journal');
    await page.waitForLoadState('networkidle');

    // The list shows trades for the seeded user. Three pairs were seeded:
    // EURUSD (V1.5 row), XAUUSD (V1.5 row), GBPUSD (V1 row), NAS100 (V1.5 row).
    await expect(page.getByText(/EURUSD/i).first()).toBeVisible();

    // The list page must not crash when V1.5 columns coexist with V1 NULL rows.
    const errorOverlay = page.locator('[data-nextjs-dialog-overlay]');
    await expect(errorOverlay).toHaveCount(0);
  });
});
