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
 *        3. the 6-step backtest wizard is driven (pair → lien TradingView →
 *           R:R → résultat → système → leçon) → submit → redirect BACK to the
 *           session → the backtest is now grouped under it (« 1 backtest »);
 *        4. DB: the TrainingTrade carries `sessionId` = the session + the pasted
 *           `tradingViewUrl` (J1 pivot capture → lien) and a NULL
 *           `entryScreenshotKey`;
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

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

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
    // Long flow (~10 route compiles: /training, /sessions/new, the session
    // form submit, /training/new, the 6-step wizard submit, the session detail,
    // the backtest detail, /journal). On a cold `next dev` the CUMULATIVE
    // compile time brushes the CI 60s per-test budget → `test.slow()` (×3)
    // gives deterministic headroom on the dev server. Passing assertions still
    // resolve instantly; only a genuine hang would consume the larger budget.
    test.slow();

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // --- 1. /training → « Nouvelle session » CTA (the feature is discoverable).
    await page.goto('/training');
    const newSessionCta = page.getByRole('link', { name: 'Nouvelle session' });
    await expect(newSessionCta).toBeVisible();
    await newSessionCta.click();
    // 30s (like every sibling navigation below): the FIRST hit on
    // /training/sessions/new compiles the route on a cold `next dev`; the 10s
    // default expect-timeout was tighter than that cold-compile budget and
    // produced a false failure on a slow dev server.
    await expect(page).toHaveURL(/\/training\/sessions\/new$/, { timeout: 30_000 });

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

    // Step 2/6 — Lien TradingView requis (J1 pivot capture → lien).
    // Controlled input → type char-by-char (WebKit-safe, canon F5): a one-shot
    // `fill` sets the DOM value without reliably committing React's onChange on
    // WebKit (mobile-iphone-15 project), which would drop the link before submit.
    await expect(wizardHeading).toHaveText('Lien de ton analyse');
    const s8Link = page.getByLabel('Lien TradingView');
    await s8Link.click();
    await s8Link.pressSequentially('https://www.tradingview.com/x/S8Sess01/');
    await expect(s8Link).toHaveValue('https://www.tradingview.com/x/S8Sess01/');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 3/6 — R:R prévu (default 1:2.00 valid).
    await expect(wizardHeading).toHaveText('Plan : R:R prévu');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 4/6 — Résultat (optional — pick « Gagnant » to exercise the radiogroup).
    await expect(wizardHeading).toHaveText('Résultat du backtest');
    await page.getByRole('radio', { name: 'Gagnant' }).click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 5/7 — Respect du système (gated — must answer).
    await expect(wizardHeading).toHaveText('Respect du système');
    await page.getByRole('group', { name: 'Système respecté ?' }).getByText('Oui').click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 6/7 — Checklist process (S8 V2 §33-2). Optional discipline mirror;
    // answer a deliberate MIX so the tri-state round-trips to the DB
    // (Oui→true / Oui→true / N/A→null / Oui→true).
    //
    // This is the only TALL wizard step. Each option is an `sr-only` <input>
    // wrapped in a styled <label>: targeting the VISIBLE label forces a scroll
    // under the `position: sticky` footer, and the per-step heading auto-focus
    // (training-form-wizard.tsx) re-scrolls to the top — the two fight and
    // Playwright's "stable" gate never settles on the emulated mobile viewport
    // (the controls are provably interactable: chromium drives them fine). So we
    // drive the real <input> directly with `check({force})`, which dispatches
    // the change with NO actionability/scroll dance. The DB tri-state assertions
    // below prove every check registered — a no-op would fail them.
    await expect(wizardHeading).toHaveText('Checklist process');
    const pickChecklist = (name: string, value: 'true' | 'false' | 'na') =>
      page.locator(`input[name="${name}"][value="${value}"]`).check({ force: true });
    await pickChecklist('planFollowed', 'true');
    await pickChecklist('riskDefinedBefore', 'true');
    await pickChecklist('emotionalStateNoted', 'na');
    await pickChecklist('noImpulsiveDeviation', 'true');
    await page.getByRole('button', { name: /Suivant/ }).click({ force: true });

    // Step 7/7 — Leçon tirée → submit.
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
      select: {
        id: true,
        sessionId: true,
        entryScreenshotKey: true,
        tradingViewUrl: true,
        pair: true,
        planFollowed: true,
        riskDefinedBefore: true,
        emotionalStateNoted: true,
        noImpulsiveDeviation: true,
      },
    });
    expect(tt).not.toBeNull();
    expect(tt?.sessionId).toBe(sessionId);
    expect(tt?.pair).toBe('GBPUSD');
    // J1 pivot capture → lien : the backtest carries the pasted TradingView link
    // and NO screenshot key (the upload pipeline is retired for training too).
    expect(tt?.tradingViewUrl).toBe('https://www.tradingview.com/x/S8Sess01/');
    expect(tt?.entryScreenshotKey).toBeNull();
    // S8 V2 §33-2 — the checklist tri-state round-tripped from the wizard.
    expect(tt?.planFollowed).toBe(true);
    expect(tt?.riskDefinedBefore).toBe(true);
    expect(tt?.emotionalStateNoted).toBeNull();
    expect(tt?.noImpulsiveDeviation).toBe(true);

    // --- 7. /training landing shows THIS session's card with its backtest
    // count (scoped by href — the member also has the seeded session from
    // beforeAll, so an unscoped text match would hit 2 cards).
    await page.goto('/training');
    await expect(page.getByRole('heading', { name: 'Séances de backtest' })).toBeVisible();
    const createdCard = page.locator(`a[href="/training/sessions/${sessionId}"]`);
    await expect(createdCard).toBeVisible();
    await expect(createdCard).toContainText('1 backtest dans cette séance');

    // --- 8. The backtest DETAIL surfaces the checklist (§33-2) + a calm
    // « En attente de correction » review pill (§33-3): no correction exists
    // yet on this UI-created trade.
    // `domcontentloaded`, NOT the default `load`: this `force-dynamic` detail
    // route compiles + server-renders on first cold hit, and the `load` event
    // can stall past the budget on the slow dev filesystem. The assertions below
    // auto-wait, so readiness is still gated — this matches the file's "no
    // networkidle, expect-gated" determinism canon.
    await page.goto(`/training/${tt!.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'GBPUSD' })).toBeVisible();
    await expect(page.getByText('En attente de correction')).toBeVisible();
    await expect(page.getByText('Checklist process')).toBeVisible();
    await expect(page.getByText("Plan d'exécution suivi")).toBeVisible();

    // --- 9. DoD#3 isolation: the backtest NEVER leaks into the real journal.
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
    // Long admin↔member loop (login×3 + ~6 route/Server-Action cold compiles:
    // admin training tab, session detail, correct-backtest action, member
    // detail, member reply action, admin re-view). The CUMULATIVE cold-compile
    // time brushes the CI 60s per-test budget → `test.slow()` (×3) for
    // deterministic headroom; a genuine hang would still fail at the larger cap.
    test.slow();
    const TRAINING_COMMENT = 'Backtest propre, mais entrée 2 bougies trop tôt (correction e2e S8).';

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

    // --- 4. Member opens the backtest → sees the correction; the review status
    // flips to « Correction vue » (the page marks corrections seen on read).
    await page.context().clearCookies();
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    // `domcontentloaded` (canon, mirrors test A): the `force-dynamic` member
    // detail route compiles cold on first hit; the default `load` wait timed out
    // (net::ERR_ABORTED). The auto-waiting expects below still gate readiness.
    await page.goto(`/training/${seededTradeId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Corrections reçues')).toBeVisible();
    await expect(page.getByText(TRAINING_COMMENT)).toBeVisible();
    await expect(page.getByText('Correction vue')).toBeVisible();

    // --- 5. §32-4 — the member REPLIES to the correction; it persists + shows.
    const MEMBER_REPLY = 'Compris — je travaille ma patience d’exécution (réponse e2e S8).';
    // The reply island is collapsed by default; « Répondre à Eliott » reveals
    // the textarea through a client onClick (setOpen). On a cold first paint the
    // click can land BEFORE the island hydrates → it no-ops and the textarea
    // never appears — a genuine hydration race (retries + test.slow don't help,
    // the click is simply lost). Retry the reveal until the textarea shows; once
    // open the toggle unmounts, so guard the re-click on its visibility.
    const revealReply = page.getByRole('button', { name: 'Répondre à Eliott' });
    const replyBox = page.getByLabel('Ta réponse');
    await expect(async () => {
      if (await revealReply.isVisible()) await revealReply.click();
      await expect(replyBox).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await replyBox.fill(MEMBER_REPLY);
    await page.getByRole('button', { name: 'Envoyer ma réponse' }).click();
    // Deterministic POST-WRITE signal: on success the island collapses AND the
    // server re-render (revalidatePath) flips the CTA to « Modifier ta réponse »
    // (existingReply now set). Gating on this — NOT on the reply text, which is
    // ALSO the still-open textarea's value pre-submit and would match instantly
    // (a race that lets the DB read below run before the write commits).
    await expect(page.getByRole('button', { name: 'Modifier ta réponse' })).toBeVisible({
      timeout: 30_000,
    });
    // The persisted reply now renders in the read-block (textarea is gone).
    await expect(page.getByText(MEMBER_REPLY)).toBeVisible();

    // §21.5: the reply lands on the TrainingAnnotation, never a real one.
    const replied = await db.trainingAnnotation.findFirst({
      where: { trainingTradeId: seededTradeId, adminId: admin.id },
      select: { memberReply: true },
    });
    expect(replied?.memberReply).toBe(MEMBER_REPLY);

    // --- 6. The admin re-opens the backtest → sees the member's reply
    // (loop closes, §32 admin↔membre).
    await page.context().clearCookies();
    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);
    await page.goto(`/admin/members/${member.id}/training/${seededTradeId}`);
    await expect(page.getByText('Réponse du membre')).toBeVisible();
    await expect(page.getByText(MEMBER_REPLY)).toBeVisible();
  });
});
