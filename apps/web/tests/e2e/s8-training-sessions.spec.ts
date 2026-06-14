/**
 * S8 — Mode Entraînement : backtest SESSION container, exercised END TO END
 * against real Postgres through the real UI. Proves the Session-8 DoD (§31):
 *
 *   A. DoD#1 — « un membre crée une SESSION DE BACKTEST et journalise un trade
 *      d'entraînement — testé » + DoD#3 isolation:
 *        1. /training → « Nouvelle session » → the session form (label /
 *           instrument / timeframe / notes) → « Ouvrir la session » →
 *           redirect to /training/sessions/[id] (the page EXISTS, no 404);
 *        2. the open session shows « En cours » + an empty backtests list +
 *           « Ajouter un backtest » → /training/new?sessionId=… with the
 *           « Dans la session : … » banner;
 *        3. the 6-step backtest wizard is driven (pair → real PNG upload →
 *           R:R → résultat → système → leçon) → submit → redirect BACK to the
 *           session → the backtest is now grouped under it (« 1 backtest »);
 *        4. DB: the TrainingTrade carries `sessionId` = the session + an
 *           `entryScreenshotKey` under `training/{userId}/`;
 *        5. /training landing shows the session card « 1 backtest dans cette
 *           séance »;
 *        6. DoD#3 — the backtest NEVER leaks into the real journal (/journal
 *           stays empty).
 *
 *   B. DoD#2 — « l'admin corrige/commente une analyse d'entraînement ; le
 *      membre la voit » + admin sees the SESSION (§27 → Session 7):
 *        admin /admin/members/[id]?tab=training → « Séances de backtest » lists
 *        the session → admin session detail (label/instrument/TF/notes + the
 *        grouped backtest) → annotate the backtest → member opens it and sees
 *        the correction under « Corrections reçues ».
 *
 * Determinism (canon J-C3): NO `networkidle`; every assertion gates on an
 * auto-waiting `expect(locator)`. Runs on chromium + mobile-iphone-15
 * (DoD#4 responsive 375px). Skips cleanly if Chromium is not installed.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const FIXTURE_PNG = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'fixtures',
  'mt5-history-account-a.png',
);

let admin: SeededUser | null = null;
let member: SeededUser | null = null;
let seededSessionId: string | null = null;
let seededTradeId: string | null = null;

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

async function dismissCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

test.describe('S8 — Mode Entraînement : session de backtest (create + group + admin)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    admin = await seedAdminUser({ firstName: 'S8Admin' });
    member = await seedMemberUser({ firstName: 'S8Member' });

    // A pre-seeded session + a backtest inside it for the admin path (test B),
    // decoupled from the UI-created one in test A.
    const session = await db.trainingSession.create({
      data: {
        memberId: member.id,
        label: 'Backtest XAUUSD — décembre',
        symbol: 'XAUUSD',
        timeframe: 'H4',
        notes: 'Replay du range de décembre (seed e2e S8).',
      },
      select: { id: true },
    });
    seededSessionId = session.id;
    const trade = await db.trainingTrade.create({
      data: {
        userId: member.id,
        sessionId: session.id,
        pair: 'XAUUSD',
        plannedRR: '2.00',
        lessonLearned: 'Entrée anticipée — attendre la confirmation (seed e2e S8).',
        enteredAt: new Date('2026-06-01T09:00:00.000Z'),
      },
      select: { id: true },
    });
    seededTradeId = trade.id;
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    admin = null;
    member = null;
    seededSessionId = null;
    seededTradeId = null;
  });

  test('A — membre crée une session, y journalise un backtest, le voit groupé (DoD#1) + isolation (DoD#3)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // --- 1. /training → « Nouvelle session » CTA (the feature is discoverable).
    await page.goto('/training');
    const newSessionCta = page.getByRole('link', { name: 'Nouvelle session' });
    await expect(newSessionCta).toBeVisible();
    await newSessionCta.click();
    await expect(page).toHaveURL(/\/training\/sessions\/new$/);

    // --- 2. Fill + submit the session form.
    const label = 'Range GBPUSD — janvier (e2e)';
    await page.getByLabel(/Nom de la séance/).fill(label);
    await page.getByLabel('Paire', { exact: true }).fill('GBPUSD');
    await page.getByLabel(/Unité de temps/).fill('H1');
    await page.getByLabel(/Notes de séance/).fill('Replay du range de janvier.');
    await page.getByRole('button', { name: 'Ouvrir la session' }).click();

    // --- 3. Redirect to the session detail (route EXISTS — no 404).
    await expect(page).toHaveURL(/\/training\/sessions\/[a-z0-9]{20,40}$/, { timeout: 30_000 });
    const sessionUrl = page.url();
    const sessionId = sessionUrl.split('/training/sessions/')[1]!;
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
    await expect(page.getByText('En cours')).toBeVisible();
    await expect(page.getByText('Aucun backtest dans cette séance.')).toBeVisible();

    // --- 4. « Ajouter un backtest » → wizard carrying the session.
    await page
      .getByRole('link', { name: /Ajouter un backtest/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/training/new\\?sessionId=${sessionId}`));
    await expect(page.getByText('Dans la session :')).toBeVisible();
    await expect(page.getByText(label)).toBeVisible();

    const wizardHeading = page.locator('h1#training-wizard-heading');

    // Step 1/6 — Quand & quelle paire (enteredAt pre-filled).
    await expect(wizardHeading).toHaveText('Quand & quelle paire');
    await page.getByLabel('Paire', { exact: true }).fill('GBPUSD');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 2/6 — Capture: real PNG through POST /api/uploads (training-entry).
    await expect(wizardHeading).toHaveText('Capture de ton analyse');
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);
    await expect(page.getByAltText("Capture de l'analyse du backtest")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 3/6 — R:R prévu (default 1:2.00 valid).
    await expect(wizardHeading).toHaveText('Plan : R:R prévu');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 4/6 — Résultat (optional — pick « Gagnant » to exercise the radiogroup).
    await expect(wizardHeading).toHaveText('Résultat du backtest');
    await page.getByRole('radio', { name: 'Gagnant' }).click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 5/6 — Respect du système (gated — must answer).
    await expect(wizardHeading).toHaveText('Respect du système');
    await page.getByRole('group', { name: 'Système respecté ?' }).getByText('Oui').click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 6/6 — Leçon tirée → submit.
    await expect(wizardHeading).toHaveText('Leçon tirée');
    // `#lessonLearned` not getByLabel — the step heading is ALSO "Leçon tirée"
    // (it labels the <section> via aria-labelledby), so the accessible-name
    // lookup is ambiguous.
    await page
      .locator('#lessonLearned')
      .fill("J'ai attendu la confirmation au lieu d'anticiper (e2e S8).");
    const submitBtn = page.getByRole('button', { name: 'Enregistrer le backtest' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // --- 5. Redirect BACK to the session → the backtest is grouped under it.
    await expect(page).toHaveURL(new RegExp(`/training/sessions/${sessionId}$`), {
      timeout: 30_000,
    });
    // The backtest is now grouped under the session: the empty-state is gone
    // and the GBPUSD card (linking to its detail) is rendered inside the session.
    await expect(page.getByText('Aucun backtest dans cette séance.')).toBeHidden();
    await expect(page.locator('a[href^="/training/"]').filter({ hasText: 'GBPUSD' })).toBeVisible();

    // --- 6. DB: the trade carries the sessionId + a training-prefixed capture.
    const tt = await db.trainingTrade.findFirst({
      where: { userId: member.id, sessionId },
      select: { id: true, sessionId: true, entryScreenshotKey: true, pair: true },
    });
    expect(tt).not.toBeNull();
    expect(tt?.sessionId).toBe(sessionId);
    expect(tt?.pair).toBe('GBPUSD');
    expect(tt?.entryScreenshotKey).toMatch(new RegExp(`^training/${member.id}/`));

    // --- 7. /training landing shows THIS session's card with its backtest
    // count (scoped by href — the member also has the seeded session from
    // beforeAll, so an unscoped text match would hit 2 cards).
    await page.goto('/training');
    await expect(page.getByRole('heading', { name: 'Séances de backtest' })).toBeVisible();
    const createdCard = page.locator(`a[href="/training/sessions/${sessionId}"]`);
    await expect(createdCard).toBeVisible();
    await expect(createdCard).toContainText('1 backtest dans cette séance');

    // --- 8. DoD#3 isolation: the backtest NEVER leaks into the real journal.
    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Ton journal est vide.' })).toBeVisible();
  });

  test('B — admin voit la session + corrige un backtest, le membre voit la correction (DoD#2 + §27→S7)', async ({
    page,
    request,
  }) => {
    if (!admin || !member || !seededSessionId || !seededTradeId) {
      throw new Error('seed missing — beforeAll did not run');
    }
    const TRAINING_COMMENT = 'Backtest propre, mais entrée 2 bougies trop tôt (correction e2e S8).';

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    // --- 1. Admin training tab → « Séances de backtest » lists the session.
    await page.goto(`/admin/members/${member.id}?tab=training`);
    await expect(page.getByRole('heading', { name: 'Séances de backtest' })).toBeVisible();
    // Scope the count to THIS session's card — the member may have other
    // sessions (test A creates one in the same DB), so an unscoped text match
    // would hit multiple cards.
    const sessionLink = page.getByRole('link', { name: /Voir la session Backtest XAUUSD/ });
    await expect(sessionLink).toBeVisible();
    await expect(sessionLink).toContainText('1 backtest dans cette séance');

    // --- 2. Admin session detail: context + the grouped backtest.
    await page.goto(`/admin/members/${member.id}/training/sessions/${seededSessionId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Backtest XAUUSD — décembre' }),
    ).toBeVisible();
    await expect(page.getByText('Replay du range de décembre (seed e2e S8).')).toBeVisible();
    const backtestLink = page.getByRole('link', { name: /Corriger le backtest XAUUSD/ });
    await expect(backtestLink).toBeVisible();

    // --- 3. Annotate the backtest (admin side, DoD#2).
    await page.goto(`/admin/members/${member.id}/training/${seededTradeId}`);
    await page.getByRole('button', { name: 'Corriger ce backtest' }).click();
    const box = page.getByLabel('Correction');
    await expect(box).toBeVisible();
    await box.fill(TRAINING_COMMENT);
    await page.getByRole('button', { name: /Envoyer correction/ }).click();
    // Wait for the Sheet to close (Server Action success) before asserting.
    await expect(page.getByLabel('Correction')).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText(TRAINING_COMMENT)).toBeVisible();

    // §21.5: the correction is a TrainingAnnotation, never a real one.
    const annotation = await db.trainingAnnotation.findFirst({
      where: { trainingTradeId: seededTradeId, adminId: admin.id },
      select: { comment: true },
    });
    expect(annotation?.comment).toBe(TRAINING_COMMENT);

    // --- 4. Member opens the backtest → sees the correction.
    await page.context().clearCookies();
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto(`/training/${seededTradeId}`);
    await expect(page.getByText('Corrections reçues')).toBeVisible();
    await expect(page.getByText(TRAINING_COMMENT)).toBeVisible();
  });
});
