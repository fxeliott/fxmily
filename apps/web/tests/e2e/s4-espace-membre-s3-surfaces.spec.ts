/**
 * S4 DoD #3 — « score de constance et écarts au bon endroit » : the S3
 * outputs (ConstancyScore + Discrepancy + ScoreEvent) surface ON the member
 * journey, exercised END TO END against real Postgres through the real UI:
 *
 *   1. DASHBOARD TEASER — the « Vérification » card on /dashboard is enriched
 *      (S4): constancy value « 72/100 » + « 1 écart à regarder » when an open
 *      discrepancy exists (`getLatestConstancyScore` + `countOpenDiscrepancies`).
 *   2. /VERIFICATION — the score card shows « 72/100 » + the 3 axis
 *      percentages from the breakdown JSON ; the new « Pourquoi ton score
 *      bouge » block (S4 DOD3-T3-02) lists the recent ScoreEvents with their
 *      FR labels, the EXCUSED event visibly neutralized (« excusé — motif
 *      donné ou levé par la réalité ») ; the open écart carries the
 *      « Donner un motif » form (DoD §29 — an excused gap is not indiscipline).
 *
 * Seeding is direct Prisma (pattern carbone `today-guidance.spec.ts` — seed
 * via `@/lib/db` + pure helpers, NEVER a `'server-only'` import, scar GG-CI):
 *   - 1 ConstancyScore value=72, breakdown {honesty:45, regularity:80,
 *     discipline:90}, period = current Paris ISO week (constancy.ts:257-265);
 *   - 1 OPEN Discrepancy type `missing_declared` (NOTE: `reality_gap` is a
 *     ScoreEventReason, NOT a DiscrepancyType — schema.prisma:2260-2265),
 *     severity 2, short claudeReasoning;
 *   - 1 acknowledged Discrepancy WITH memberReason (→ its linked event is
 *     excused per the fold rule, constancy.ts:418-425);
 *   - 3 ScoreEvents: filled +1, reality_gap −3 → open écart (NOT excused),
 *     reality_gap −3 → excused écart.
 *
 * Determinism (canon J-C3): no `networkidle`; `goto` awaits `load`,
 * assertions auto-wait. Runs on chromium + mobile-iphone-15 (393px) — the
 * dashboard card is scrolled into view before asserting. Skips cleanly if
 * Chromium is not installed.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const PARIS_TZ = 'Europe/Paris';

let member: SeededUser | null = null;

/** ISO-week Monday (Paris) — mirror of `currentPeriodStart` (constancy.ts:257). */
function currentParisWeekMonday(): string {
  let day = localDateOf(new Date(), PARIS_TZ);
  while (parseLocalDate(day).getUTCDay() !== 1) {
    day = shiftLocalDate(day, -1);
  }
  return day;
}

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

test.describe('S4 — surfaces S3 espace membre : teaser dashboard + /verification (real DB)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    // Idempotent: cleanup wipes any previous run / the other project's seed
    // (ConstancyScore / Discrepancy / ScoreEvent all cascade on User delete —
    // schema.prisma:2454, 2502, 2532), then a fresh unique-per-run member.
    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S4Verif' });

    const monday = currentParisWeekMonday();

    // --- Constancy score for the CURRENT week (the dashboard teaser reads
    // the latest row by periodStart — constancy.ts:428-434).
    await db.constancyScore.create({
      data: {
        memberId: member.id,
        value: 72,
        breakdown: { honesty: 45, regularity: 80, discipline: 90 },
        periodStart: parseLocalDate(monday),
        periodEnd: parseLocalDate(shiftLocalDate(monday, 6)),
      },
    });

    // --- One OPEN écart (drives « 1 écart à regarder » + the motif form).
    const openDiscrepancy = await db.discrepancy.create({
      data: {
        memberId: member.id,
        type: 'missing_declared',
        severity: 2,
        claudeReasoning:
          'Une position EURUSD de ton historique MT5 fourni n’apparaît pas dans ton journal déclaré.',
      },
      select: { id: true },
    });

    // --- One acknowledged écart WITH memberReason → its linked ScoreEvent
    // renders struck-through + « excusé » (excusal rule constancy.ts:418-425).
    const excusedDiscrepancy = await db.discrepancy.create({
      data: {
        memberId: member.id,
        type: 'unfilled_no_reason',
        severity: 1,
        status: 'acknowledged',
        claudeReasoning: 'Journée sans aucun check-in, sans motif déclaré pour le moment.',
        memberReason: 'Coupure internet — semaine off déclarée.',
        memberReasonAt: new Date(),
      },
      select: { id: true },
    });

    // --- 3 ScoreEvents feeding « Pourquoi ton score bouge » (newest first,
    // staggered createdAt for a stable order — listRecentScoreEvents takes 8).
    const now = Date.now();
    await db.scoreEvent.create({
      data: {
        memberId: member.id,
        delta: 1,
        reason: 'filled',
        createdAt: new Date(now - 3 * 60_000),
      },
    });
    await db.scoreEvent.create({
      data: {
        memberId: member.id,
        delta: -3,
        reason: 'reality_gap',
        relatedDiscrepancyId: openDiscrepancy.id,
        createdAt: new Date(now - 2 * 60_000),
      },
    });
    await db.scoreEvent.create({
      data: {
        memberId: member.id,
        delta: -3,
        reason: 'reality_gap',
        relatedDiscrepancyId: excusedDiscrepancy.id,
        createdAt: new Date(now - 1 * 60_000),
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('dashboard — la carte « Vérification » teaser affiche 72/100 + 1 écart à regarder', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // `<section aria-label="Vérification">` → role=region. Scrolled into view
    // for the 393px project (the card sits deep in the hub page).
    const verifCard = page.getByRole('region', { name: 'Vérification', exact: true });
    await verifCard.scrollIntoViewIfNeeded();
    await expect(verifCard).toBeVisible();

    // S4 — constancy teaser: rounded value + « /100 » in one mono span
    // (dashboard/page.tsx:618-622) + its « constance » caption.
    await expect(verifCard.getByText('72/100', { exact: true })).toBeVisible();
    await expect(verifCard.getByText('constance', { exact: true })).toBeVisible();

    // S4 — open écarts count (singular: exactly 1 open, the acknowledged one
    // is NOT counted — countOpenDiscrepancies filters status=open).
    await expect(verifCard.getByText('1 écart à regarder')).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('/verification — score 72 + « Pourquoi ton score bouge » + form motif sur l’écart open', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/verification');
    await expect(page.getByRole('heading', { name: 'Ta réalité de trading' })).toBeVisible();

    // --- Score card: rounded « 72/100 » + the 3 breakdown axes verbatim.
    const constancySection = page.getByRole('region', { name: 'Ta constance' });
    await expect(constancySection.getByText('Score de constance')).toBeVisible();
    await expect(constancySection.getByText('72/100', { exact: true })).toBeVisible();
    await expect(constancySection.getByText('45%', { exact: true })).toBeVisible(); // honesty
    await expect(constancySection.getByText('80%', { exact: true })).toBeVisible(); // regularity
    await expect(constancySection.getByText('90%', { exact: true })).toBeVisible(); // discipline

    // --- « Pourquoi ton score bouge » (S4 DOD3-T3-02): the 3 seeded events
    // with their FR labels (score-events-history.tsx:15-20).
    await expect(constancySection.getByText('Pourquoi ton score bouge')).toBeVisible();
    await expect(constancySection.getByText('Suivi rempli')).toBeVisible();
    await expect(
      constancySection.getByText('Écart entre ton déclaré et ton historique réel'),
    ).toHaveCount(2);
    // Honest impact column (audit 2026-06-17): direction + relative weight,
    // NOT a raw signed delta that would misstate the real score impact.
    await expect(constancySection.getByText('Compte pour toi', { exact: true })).toBeVisible(); // filled
    await expect(constancySection.getByText('Pèse', { exact: true })).toHaveCount(1); // the open reality_gap
    await expect(constancySection.getByText('Neutralisé', { exact: true })).toHaveCount(1); // the excused one

    // EXACTLY ONE event is excused (the one linked to the écart with a
    // memberReason) — visibly neutralized, never silently dropped (« l'histoire
    // ne se réécrit pas, seul le score pardonne »).
    await expect(
      constancySection.getByText(/excusé, motif donné ou levé par la réalité/),
    ).toHaveCount(1);

    // --- Écarts: both cards render, factual labels (§33.2 — calm, no shaming).
    const discrepanciesSection = page.getByRole('region', { name: 'Tes écarts' });
    await expect(discrepanciesSection.getByText('Position réelle non déclarée')).toBeVisible();
    await expect(discrepanciesSection.getByText('À regarder')).toBeVisible(); // open pill
    await expect(discrepanciesSection.getByText('Motif donné')).toBeVisible(); // excused pill
    await expect(
      discrepanciesSection.getByText('Ton motif : Coupure internet — semaine off déclarée.'),
    ).toBeVisible();

    // --- « Donner un motif » form: present on the OPEN écart only (the
    // acknowledged one already carries its reason). Native <details> — open
    // it and prove the real form fields are wired.
    const reasonSummary = discrepanciesSection.getByText('Donner un motif');
    await expect(reasonSummary).toHaveCount(1);
    await reasonSummary.click();
    await expect(discrepanciesSection.locator('textarea[name="reason"]')).toBeVisible();
    await expect(
      discrepanciesSection.getByRole('button', { name: 'Envoyer le motif' }),
    ).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
