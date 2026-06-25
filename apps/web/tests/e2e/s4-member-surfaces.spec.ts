/**
 * S4 DoD §34 — preuve RUNTIME des nouvelles surfaces membre de la Session 4,
 * exercées de bout en bout contre le vrai Postgres à travers l'UI réelle :
 *
 *   A. PARCOURS ÉMOTIONNEL (enrichissement §33 #2) — sur la fiche détail d'un
 *      trade clôturé, l'arc avant → pendant → après est assemblé en UN bloc
 *      (`TradePsychologyTriad`), avec les libellés FR des émotions déclarées.
 *      (Les trois moments étaient auparavant dispersés dans la fiche.)
 *
 *   B. ALERTES DE DÉRIVE (DoD §34 « les alertes de dérive s'affichent ») — sur
 *      /verification, les alertes du membre s'affichent en lecture seule via
 *      `DriftAlertsCard`, avec un statut calme (jamais de rouge punitif, §33.2) :
 *      `delivered` → « Fiche envoyée », `open` → « En préparation ».
 *
 * Le parcours « ajouter un trade + photo » (DoD §34 #1) est couvert de bout en
 * bout par `s4-journal-happy-path.spec.ts` (empty-state → wizard → upload PNG
 * réel → redirect → DB row) ; ce spec se concentre sur les surfaces AJOUTÉES en
 * S4 pour ne pas dupliquer.
 *
 * Déterminisme (canon J-C3) : pas de `networkidle` ; chaque assertion est gatée
 * sur un `expect(locator)` auto-attendant. Tourne sur chromium + mobile-iphone-15.
 * Skip propre si Chromium n'est pas installé.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let member: SeededUser | null = null;
let closedTradeId: string | null = null;

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

/**
 * Cookie banner is fixed-bottom + localStorage-gated → pre-seed the dismissal
 * flag BEFORE any document loads so it never obstructs a target (canon S2 e2e).
 */
async function dismissCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

/**
 * DoD §34 #4 — « 0 débordement » aux deux formats. The track-record frise is
 * the only intentionally scroll-x element added in S4 (`overflow-x-auto` on its
 * inner list) ; this proves it stays contained and never widens the page.
 * Runs on both projects (desktop 1280 + mobile-iphone-15 393).
 */
async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, 'no horizontal page overflow').toBeLessThanOrEqual(1);
}

test.describe('S4 — surfaces membre : parcours émotionnel + alertes de dérive', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S4Surfaces' });

    // A closed trade carrying the full emotional arc (before/during/after). No
    // screenshot key → the detail page hides the capture sections (avoids a 404
    // image network error) while still rendering the triad from the arrays.
    const now = Date.now();
    const trade = await db.trade.create({
      data: {
        userId: member.id,
        pair: 'EURUSD',
        direction: 'long',
        session: 'london',
        enteredAt: new Date(now - 2 * 60 * 60 * 1000),
        entryPrice: 1.085,
        lotSize: 0.1,
        plannedRR: 2,
        planRespected: true,
        emotionBefore: ['calm'],
        emotionDuring: ['anxious'],
        emotionAfter: ['frustrated'],
        exitedAt: new Date(now - 60 * 60 * 1000),
        exitPrice: 1.09,
        outcome: 'win',
        realizedR: 1.5,
        realizedRSource: 'computed',
        closedAt: new Date(now - 60 * 60 * 1000),
      },
      select: { id: true },
    });
    closedTradeId = trade.id;

    // Two member-facing alerts — one delivered (a Douglas card went out), one
    // still open (preparing). Recent createdAt so the 30-day feed window picks
    // them up.
    await db.alert.createMany({
      data: [
        {
          memberId: member.id,
          triggerType: 'false_declaration_repeat',
          repeatCount: 2,
          threshold: 2,
          status: 'delivered',
          createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        },
        {
          memberId: member.id,
          triggerType: 'forgot_no_reason_repeat',
          repeatCount: 3,
          threshold: 3,
          status: 'open',
          createdAt: new Date(now - 24 * 60 * 60 * 1000),
        },
      ],
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
    closedTradeId = null;
  });

  test('A — fiche trade : « Parcours émotionnel » avant/pendant/après assemblé', async ({
    page,
    request,
  }) => {
    if (!member || !closedTradeId) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto(`/journal/${closedTradeId}`);

    // The consolidated arc block (single heading, was three dispersed cards).
    await expect(page.getByRole('heading', { name: 'Parcours émotionnel' })).toBeVisible();
    await expect(page.getByText('Avant', { exact: true })).toBeVisible();
    await expect(page.getByText('Pendant', { exact: true })).toBeVisible();
    await expect(page.getByText('Après', { exact: true })).toBeVisible();

    // The three declared moments render their FR emotion labels, in order.
    await expect(page.getByText('Calme', { exact: true })).toBeVisible();
    await expect(page.getByText('Anxiété', { exact: true })).toBeVisible();
    await expect(page.getByText('Frustration', { exact: true })).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('B — /verification : « Tes alertes de dérive » s’affichent, statut calme', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/verification');

    await expect(page.getByRole('heading', { name: 'Tes alertes de dérive' })).toBeVisible();

    // Delivered alert → calm « Fiche envoyée » + its canonical label.
    await expect(page.getByText('Fausses déclarations répétées')).toBeVisible();
    await expect(page.getByText('Fiche envoyée')).toBeVisible();

    // Open alert → « En préparation » (never a punitive red status).
    await expect(page.getByText('Journées sans suivi répétées')).toBeVisible();
    await expect(page.getByText('En préparation')).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('C — /progression : la frise « Tes dernières séries » relie le trade à sa fiche', async ({
    page,
    request,
  }) => {
    if (!member || !closedTradeId) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/progression');

    // The track-record frise (enrichissement §33 #1) streams via Suspense.
    await expect(page.getByRole('heading', { name: 'Tes dernières séries' })).toBeVisible();

    // The seeded closed trade is a node whose accessible label describes the
    // series, and whose link points back to the trade detail (photo + plan).
    const node = page.getByRole('link', { name: /Trade EURUSD long clôturé/ });
    await expect(node).toBeVisible();
    await expect(node).toHaveAttribute('href', `/journal/${closedTradeId}`);

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
