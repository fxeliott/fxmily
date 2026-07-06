/**
 * S4 DoD §34 — preuve RUNTIME des nouvelles surfaces membre de la Session 4,
 * exercées de bout en bout contre le vrai Postgres à travers l'UI réelle :
 *
 *   A. LE PARCOURS DU TRADE (enrichissement §33 #2) — sur la fiche détail d'un
 *      trade clôturé, l'arc avant → pendant → après assemble en UN bloc l'émotion,
 *      la capture ET le débrief : libellés FR des émotions + l'écrit scindé/étiqueté
 *      « Avant le trade » / « Débrief » (avant, ces dimensions étaient dispersées).
 *
 *   B. ALERTES DE DÉRIVE (DoD §34 « les alertes de dérive s'affichent ») — sur
 *      /verification, les alertes du membre s'affichent en lecture seule via
 *      `DriftAlertsCard`, avec un statut calme (jamais de rouge punitif, §33.2) :
 *      `delivered` → « Fiche envoyée », `open` → « En préparation ».
 *
 *   C. FRISE TRACK RECORD (enrichissement §33 #1) — sur /progression, la frise relie
 *      chaque trade clôturé à sa fiche.
 *
 *   D. SIGNAL DE DÉRIVE AU HUB (§32/§33 « sans qu'il ait à les chercher ») — sur
 *      /dashboard, une alerte active surface un strip calme deep-linkant /verification.
 *
 *   E. SCORE → OBJECTIF (CONTEXTE « Scoring ») — sur /verification, les 2-3 signaux
 *      dominants mènent le feed, et le score de constance ponte vers /objectifs.
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

import { chromium, expect, test } from './fixtures';

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

test.describe('S4 — surfaces membre : parcours du trade, dérive, score → objectif', () => {
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
        // S4 §33 #2 — merged notes (delimiter present) → the arc splits them into
        // « Avant le trade » + « Débrief », proving the written moments are
        // rapprochés in the parcours (was a single « Notes » block at the bottom).
        notes:
          'Range Londres, attente du retest propre.\n\n--- Sortie ---\nTP touché, plan tenu, je reste process.',
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

    // S4 (CONTEXTE « Scoring ») — score events feeding « Pourquoi ton score bouge »
    // AND the « 2-3 signaux dominants » fold (ESE-2). Non-excused (no related
    // discrepancy) so they count. Weighted: reality_gap ×2 (6) > false ×1 (4) >
    // filled ×3 (3) → the dominant chip leads with « Écarts déclaré ↔ réel ».
    await db.scoreEvent.createMany({
      data: [
        {
          memberId: member.id,
          delta: 1,
          reason: 'filled',
          createdAt: new Date(now - 5 * 86_400_000),
        },
        {
          memberId: member.id,
          delta: 1,
          reason: 'filled',
          createdAt: new Date(now - 4 * 86_400_000),
        },
        {
          memberId: member.id,
          delta: 1,
          reason: 'filled',
          createdAt: new Date(now - 3 * 86_400_000),
        },
        {
          memberId: member.id,
          delta: -3,
          reason: 'reality_gap',
          createdAt: new Date(now - 2 * 86_400_000),
        },
        {
          memberId: member.id,
          delta: -3,
          reason: 'reality_gap',
          createdAt: new Date(now - 1.5 * 86_400_000),
        },
        {
          memberId: member.id,
          delta: -8,
          reason: 'false_declaration',
          createdAt: new Date(now - 86_400_000),
        },
      ],
    });

    // A constancy score (ESE-4 bridge requires a real score — honesty §33.5, no
    // fabricated 100) + a behavioral snapshot whose weakest dimension (discipline)
    // becomes the « levier du moment » the bridge points at.
    await db.constancyScore.create({
      data: {
        memberId: member.id,
        value: 72,
        breakdown: { honesty: 70, regularity: 74, discipline: 72 },
        periodStart: new Date('2026-06-15'),
        periodEnd: new Date('2026-06-21'),
      },
    });
    await db.behavioralScore.create({
      data: {
        userId: member.id,
        date: new Date('2026-06-21'),
        disciplineScore: 42,
        emotionalStabilityScore: 78,
        consistencyScore: 80,
        engagementScore: 85,
        components: {},
        sampleSize: {},
      },
    });

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

  test('A — fiche trade : « Le parcours de ce trade » (émotion + capture + débrief)', async ({
    page,
    request,
  }) => {
    if (!member || !closedTradeId) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto(`/journal/${closedTradeId}`);

    // The consolidated arc block (single heading, was three dispersed cards +
    // a separate notes block). Now unifies émotion + capture + débrief (§33 #2).
    await expect(page.getByRole('heading', { name: 'Le parcours de ce trade' })).toBeVisible();
    await expect(page.getByText('Avant', { exact: true })).toBeVisible();
    await expect(page.getByText('Pendant', { exact: true })).toBeVisible();
    await expect(page.getByText('Après', { exact: true })).toBeVisible();

    // The three declared moments render their FR emotion labels, in order.
    await expect(page.getByText('Calme', { exact: true })).toBeVisible();
    await expect(page.getByText('Anxiété', { exact: true })).toBeVisible();
    await expect(page.getByText('Frustration', { exact: true })).toBeVisible();

    // The written moments are now split + labelled INSIDE the arc (E2-2), no
    // longer fused in one bottom « Notes » block.
    await expect(page.getByText('Avant le trade', { exact: true })).toBeVisible();
    await expect(page.getByText('Débrief', { exact: true })).toBeVisible();
    await expect(page.getByText('TP touché, plan tenu, je reste process.')).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('B — /verification : « Tes alertes de dérive » s’affichent, statut calme', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

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

  test('D — /dashboard : le signal de dérive est surfacé au point d’entrée', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/dashboard');

    // §32/§33 « sans qu'il ait à les chercher » : the two seeded active alerts
    // surface a calm strip ON the hub, deep-linking to /verification (before, the
    // member had to navigate there to see any drift signal).
    const signal = page.locator('[data-slot="hub-drift-signal"]');
    await expect(signal).toBeVisible();
    await expect(signal).toHaveAttribute('href', '/verification');
    await expect(page.getByText('Signal de dérive', { exact: true })).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('E — /verification : signaux dominants + lien score → objectif', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/verification');

    // ESE-2 — the « 2-3 signaux dominants » fold leads the score-events surface,
    // strongest first (reality_gap ×2 weighs above the rest).
    await expect(page.getByText('Ce qui a le plus compté', { exact: true })).toBeVisible();
    await expect(page.getByText('Écarts déclaré ↔ réel')).toBeVisible();

    // ESE-4 — the constancy score is no longer a dead-end : it bridges to the
    // member's objective (cause → effet → prochain pas), pointing at /objectifs.
    const bridge = page.locator('[data-slot="constancy-objective-bridge"]');
    await expect(bridge).toBeVisible();
    await expect(bridge).toHaveAttribute('href', '/objectifs');
    await expect(page.getByText('Ce que ta constance change', { exact: true })).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
