import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedCheckinHistory,
  seedMemberUser,
  seedTradeHistory,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * S7 — Espace Admin happy-path, exercised END TO END against real Postgres
 * through the real UI. Proves the Session-7 deliverables that the audit
 * surfaced as gaps:
 *
 *   A. ADMIN TRADES PAGINATION (DoD#1 — the list used to hard-cap at 100 with
 *      no pagination, hiding the oldest trades from the admin while the member
 *      could page through them). Seed 55 trades → the trades tab shows EXACTLY
 *      50 + « Voir les trades plus anciens » + « 55 au total » ; page 2 shows
 *      the rest + « revenir au début ». An OLD trade (page 2) is reachable and
 *      annotatable — the whole point of DoD#1/#2 (« commenter CHAQUE trade »).
 *
 *   B. ADMIN COMMENT ROUND-TRIP (DoD#2 — « un commentaire admin apparaît
 *      exactement au bon endroit côté membre — testé »). Admin annotates the
 *      page-2 trade → the comment appears under « Corrections envoyées » on the
 *      admin surface → the member opens the SAME trade in /journal/[id] and
 *      sees it under « Corrections reçues ».
 *
 *   C. CHECK-INS TAB (DoD#4 « 0 bug » — the tab was rendered but parseTab
 *      coerced ?tab=checkins to overview, a dead link that never highlighted).
 *      Now it is active + renders the supervision panel.
 *
 *   D. PRE-TRADE TAB (§22-23 supervision completeness) renders.
 *
 * Determinism (canon J-C3): NO `networkidle`; every assertion gates on an
 * auto-waiting `expect(locator)`. Runs on chromium + mobile-iphone-15.
 */

const SEED_TRADE_COUNT = 55;
const ADMIN_COMMENT =
  'Sizing doublé après deux wins — surveille le pattern over-confidence (correction e2e S7).';

let admin: SeededUser | null = null;
let member: SeededUser | null = null;
let trainingTradeId: string | null = null;

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

/** Pre-seed the cookie-banner dismissal BEFORE any document loads (the banner
 *  is fixed-bottom + localStorage-gated; a reactive dismiss races its delayed
 *  mount — canon S2/S4). */
async function dismissCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

test.describe('S7 — Espace Admin : pagination + comment round-trip + tabs', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    admin = await seedAdminUser({ firstName: 'S7Admin' });
    member = await seedMemberUser({ firstName: 'S7Member' });
    // 55 trades > the old 100 cap is not needed to prove pagination — the page
    // size is 50, so 55 already forces a second page. Deterministic PRNG seed.
    await seedTradeHistory(member.id, { count: SEED_TRADE_COUNT, seed: 7 });
    // Real check-ins so the admin Check-ins panel renders WITH data (not just
    // the empty state) — proves the tri-state / day-grouping render at runtime.
    await seedCheckinHistory(member.id, { days: 10, seed: 7 });
    // A backtest so the training correction round-trip (DoD#3) is exercised
    // end-to-end, at parity with the real-trade flow.
    const tt = await db.trainingTrade.create({
      data: {
        userId: member.id,
        pair: 'GBPUSD',
        plannedRR: '2.00',
        lessonLearned: 'Entrée anticipée — attendre la confirmation (seed e2e S7).',
        enteredAt: new Date('2026-06-01T09:00:00.000Z'),
      },
      select: { id: true },
    });
    trainingTradeId = tt.id;
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    admin = null;
    member = null;
    trainingTradeId = null;
  });

  test('A+B — pagination réelle + commentaire admin visible côté membre au bon endroit', async ({
    page,
    request,
  }) => {
    if (!admin || !member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);

    // --- ADMIN: log in + open the member's Trades tab.
    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto(`/admin/members/${member.id}?tab=trades`);

    // Page 1 — pagination footer kills the truncation illusion (DoD#1).
    await expect(page.getByText(`${SEED_TRADE_COUNT} au total`)).toBeVisible();
    const olderLink = page.getByRole('link', { name: 'Voir les trades plus anciens' });
    await expect(olderLink).toBeVisible();

    const tradeRowSelector = 'main a[href*="/trades/"]';
    // Exactly 50 rows on page 1 (the page size).
    await expect(page.locator(tradeRowSelector)).toHaveCount(50);

    // --- Page 2 — the oldest trades, previously UNREACHABLE for the admin.
    await olderLink.click();
    await expect(page).toHaveURL(/[?&]cursor=/);
    await expect(page.getByText('revenir au début')).toBeVisible();
    const page2Rows = page.locator(tradeRowSelector);
    await expect(page2Rows.first()).toBeVisible();

    // Open an old (page-2) trade — proves trade #51+ is navigable + annotatable.
    // Navigate via the row's real href with a hard `goto` rather than a Link
    // click: a soft RSC navigation off a cursor page is racy in dev (the
    // prefetch can resolve a stale 404 before the real render), and DoD#2 only
    // needs us to LAND on a page-2 trade detail, not to exercise the router.
    const oldTradeHref = await page2Rows.first().getAttribute('href');
    expect(oldTradeHref).toMatch(/\/admin\/members\/[a-z0-9]+\/trades\/[a-z0-9]{20,40}$/);
    await page.goto(oldTradeHref!);
    const tradeId = oldTradeHref!.split('/trades/')[1]!;

    // --- ANNOTATE this old trade (DoD#2 admin side).
    await page.getByRole('button', { name: 'Annoter ce trade' }).click();
    const commentBox = page.getByLabel('Correction');
    await expect(commentBox).toBeVisible();
    await commentBox.fill(ADMIN_COMMENT);
    await page.getByRole('button', { name: /Envoyer correction/ }).click();

    // Wait for the Sheet to CLOSE (AnnotateTradeButton closes on the Server
    // Action's success). Asserting the rendered comment before the close races
    // two false positives: the still-open textarea holds the same text, and the
    // empty-state heading « Corrections envoyées (0) » sits behind the Sheet.
    // A long timeout absorbs the first-hit Server Action compile in dev.
    await expect(page.getByLabel('Correction')).toBeHidden({ timeout: 60_000 });

    // Now the comment shows inline in the annotations list (textarea is gone).
    await expect(page.getByText(ADMIN_COMMENT)).toBeVisible();

    // Real DB row: the annotation belongs to this trade, authored by the admin.
    const annotation = await db.tradeAnnotation.findFirst({
      where: { tradeId, adminId: admin.id },
      select: { id: true, comment: true },
    });
    expect(annotation).not.toBeNull();
    expect(annotation?.comment).toBe(ADMIN_COMMENT);

    // --- MEMBER: switch session, open the SAME trade, see the correction at the
    // right spot (« Corrections reçues »). DoD#2 round-trip closed.
    await page.context().clearCookies();
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto(`/journal/${tradeId}`);
    await expect(page.getByText('Corrections reçues')).toBeVisible();
    await expect(page.getByText(ADMIN_COMMENT)).toBeVisible();
  });

  test('C+D — onglet Check-ins actif (plus de lien mort) + onglet Pré-trade rendu', async ({
    page,
    request,
  }) => {
    if (!admin || !member) throw new Error('seed missing — beforeAll did not run');

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    // --- C. Check-ins: tab active (aria-current, was a dead link) AND the panel
    // renders WITH data — the member has seeded check-ins, so the day summary
    // appears (proves the parseTab fix + the day-grouping render at runtime).
    await page.goto(`/admin/members/${member.id}?tab=checkins`);
    const checkinsTab = page.getByRole('link', { name: 'Check-ins' });
    await expect(checkinsTab).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(/jour.* avec check-in/)).toBeVisible();
    await expect(page.getByText("n'a encore rempli aucun check-in")).toBeHidden();

    // --- D. Pré-trade: the new supervision tab is active + renders.
    await page.goto(`/admin/members/${member.id}?tab=pretrade`);
    const pretradeTab = page.getByRole('link', { name: 'Pré-trade' });
    await expect(pretradeTab).toHaveAttribute('aria-current', 'page');
  });

  test('E — round-trip correction entraînement admin → membre (DoD#3 parité)', async ({
    page,
    request,
  }) => {
    if (!admin || !member || !trainingTradeId) {
      throw new Error('seed missing — beforeAll did not run');
    }
    const ttId = trainingTradeId;
    const TRAINING_COMMENT = 'Backtest propre, mais entrée 2 bougies trop tôt (correction e2e S7).';

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    // --- ADMIN corrects the backtest (mirror of the real-trade flow).
    await page.goto(`/admin/members/${member.id}/training/${ttId}`);
    await page.getByRole('button', { name: 'Corriger ce backtest' }).click();
    const box = page.getByLabel('Correction');
    await expect(box).toBeVisible();
    await box.fill(TRAINING_COMMENT);
    await page.getByRole('button', { name: /Envoyer correction/ }).click();
    // Wait for the Sheet to close (Server Action success), then assert the
    // rendered correction (same racy-textarea guard as the real flow).
    await expect(page.getByLabel('Correction')).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText(TRAINING_COMMENT)).toBeVisible();

    // §21.5 isolation: the correction is a TrainingAnnotation, never a real one.
    const annotation = await db.trainingAnnotation.findFirst({
      where: { trainingTradeId: ttId, adminId: admin.id },
      select: { comment: true },
    });
    expect(annotation?.comment).toBe(TRAINING_COMMENT);

    // --- MEMBER sees it at /training/[id] under « Corrections reçues ».
    await page.context().clearCookies();
    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto(`/training/${ttId}`);
    await expect(page.getByText('Corrections reçues')).toBeVisible();
    await expect(page.getByText(TRAINING_COMMENT)).toBeVisible();
  });
});
