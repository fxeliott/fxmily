/**
 * S4 DoD #1 — « le membre ajoute un trade + photo — testé en réel », exercised
 * END TO END against real Postgres through the real UI:
 *
 *   A. EMPTY-STATE CTA + WIZARD + TRADINGVIEW LINK (régression S4 DOD1-01 — the
 *      CTA used to be a dead `<Btn onPrimary>` across the RSC boundary ; J1 —
 *      the mandatory photo proof is now a TradingView link, NO upload):
 *        1. /journal empty → « Ton journal est vide. » + the CTA « Logger mon
 *           premier trade » is a real LINK (`a[href="/journal/new"]`);
 *        2. the 6-step wizard is driven with valid values (pair, direction,
 *           session, prices, R:R, discipline, émotion) ;
 *        3. step 6 gate: submit is DISABLED until a valid TradingView link is
 *           filled (`trade-form-wizard.tsx` — `disabled={!tradingViewEntryUrl}`);
 *        4. the required link is validated server-side (HTTPS + tradingview.com)
 *           → submit → redirect /journal/[id] → the detail page renders the
 *           « Voir l'analyse d'entrée » anchor → the DB row carries the
 *           `tradingViewEntryUrl` and a NULL `screenshotEntryKey` ;
 *        5. /journal lists the new trade card.
 *
 *   B. PAGINATION 50+ (S4 DOD1-02 — the list used to hard-truncate at 50):
 *      60 extra CLOSED trades seeded via Prisma → page 1 shows EXACTLY 50
 *      cards + « Voir les trades plus anciens » ; page 2 shows the rest +
 *      « revenir au début » ; a forged `?cursor=` degrades to page 1
 *      (parseCursor guard — `journal/page.tsx:39-41`), never a 500.
 *
 * Determinism (canon J-C3): NO `networkidle` in the wizard flow — `goto`
 * awaits `load`, every step interaction is gated on an auto-waiting
 * `expect(locator)`. Runs on both projects (chromium + mobile-iphone-15):
 * actions auto-scroll at 393px, the wizard nav is sticky-bottom (always
 * reachable). Skips cleanly if Chromium is not installed.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/** TradeCard renders as `li > a[href="/journal/<id>"]` inside the list `<ul>`. */
const TRADE_CARD_SELECTOR = 'main ul > li > a[href^="/journal/"]';

let member: SeededUser | null = null;

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

test.describe('S4 — /journal happy-path : empty-state CTA + wizard + lien TradingView + pagination', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    // Idempotent: cleanup wipes any previous run (and the OTHER Playwright
    // project's seed — beforeAll runs once per project against the same DB),
    // then a fresh member with a unique-per-run email (nanoid maison pattern)
    // starts from a guaranteed-empty journal.
    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S4Journal' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('A — empty-state CTA réel + wizard 6 étapes + lien TradingView (S4 DOD1-01)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // --- 1. Empty journal → onboarding empty-state with a REAL link CTA.
    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Mes trades' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ton journal est vide.' })).toBeVisible();

    // Régression S4 DOD1-01 : the CTA must be an anchor wired to /journal/new
    // (`EmptyState ctaHref` renders a `<Link>` — a Server Component cannot
    // pass `onPrimary`, so a button here would be dead on click).
    const emptyStateCta = page.locator('[data-slot="empty-state"] a[href="/journal/new"]');
    await expect(emptyStateCta).toBeVisible();
    await expect(emptyStateCta).toContainText('Logger mon premier trade');

    // --- 2. Click the CTA → the 6-step wizard.
    await emptyStateCta.click();
    await expect(page).toHaveURL(/\/journal\/new/);

    const wizardHeading = page.locator('h1#wizard-heading');

    // Step 1/6 — Quand & quelle paire. `enteredAt` is pre-filled to now
    // (valid) ; only the pair needs typing.
    await expect(wizardHeading).toHaveText('Quand & quelle paire');
    await page.getByLabel('Paire', { exact: true }).fill('EURUSD');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 2/6 — Direction & session. Explicit session pick (the auto-detected
    // default depends on wall-clock — « Londres » keeps the run deterministic).
    await expect(wizardHeading).toHaveText('Direction & session');
    await page.getByRole('radio', { name: 'Long', exact: true }).click();
    // ^Londres anchors the name — /Londres/ alone would also match
    // « Overlap (Londres/NY) ».
    await page.getByRole('radio', { name: /^Londres/ }).click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 3/6 — Prix & taille. SL below entry (long) so the Zod superRefine
    // direction check passes.
    await expect(wizardHeading).toHaveText('Prix & taille');
    await page.getByLabel("Prix d'entrée").fill('1.085');
    await page.getByLabel('Taille (lots / contrats)').fill('0.10');
    await page.getByLabel('Stop-loss (optionnel mais recommandé)').fill('1.08');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 4/6 — Plan : R:R prévu. Slider default 1:2.00 is valid as-is.
    await expect(wizardHeading).toHaveText('Plan : R:R prévu');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 5/6 — Discipline & émotion. Plan + hedge are gated (« Réponds
    // avant de continuer ») ; one emotion is mandatory (Zod min 1).
    await expect(wizardHeading).toHaveText('Discipline & émotion');
    await page.getByRole('group', { name: 'Plan respecté ?' }).getByText('Oui').click();
    await page.getByRole('group', { name: 'Hedge respecté ?' }).getByText('N/A').click();
    await page.getByRole('button', { name: 'Calme', exact: true }).click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Step 6/6 — Lien TradingView d'entrée (J1 pivot capture → lien). SUBMIT
    // GATE: the save button stays disabled (native `disabled`) until a valid
    // TradingView link is filled, with the explicit member-facing hint. NO
    // photo is uploaded anywhere in this flow — the whole point of J1.
    await expect(wizardHeading).toHaveText("Lien TradingView d'entrée");
    const submitBtn = page.getByRole('button', { name: 'Sauvegarder le trade' });
    await expect(submitBtn).toBeDisabled();
    await expect(
      page.getByText('Colle ton lien TradingView pour activer la sauvegarde.'),
    ).toBeVisible();

    // --- 3. Fill the required TradingView entry link (https + tradingview.com,
    // re-validated server-side). No POST /api/uploads, no file input.
    const ENTRY_LINK = 'https://www.tradingview.com/x/S4Journal1/';
    // Target the input by its id, NOT getByLabel: the step's <section
    // aria-labelledby="wizard-heading"> carries the SAME accessible name as this
    // field's <label> ("Lien TradingView d'entrée"), so getByLabel is ambiguous
    // and resolves the section first. The id is the unambiguous anchor.
    // Controlled React input → type char-by-char (WebKit-safe, canon F5): a
    // one-shot `fill` sets the DOM value without reliably committing onChange.
    const entryBox = page.locator('#tradingViewEntryUrl');
    await entryBox.click();
    await entryBox.pressSequentially(ENTRY_LINK);
    await expect(entryBox).toHaveValue(ENTRY_LINK);
    await expect(page.getByText('Lien TradingView valide.')).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // --- 4. Submit → Server Action createTradeAction → redirect /journal/[id].
    // 60s: the FIRST submit on a cold `next dev` compiles the createTradeAction
    // route on demand (the heaviest cold-compile hop of the flow) — 30s was
    // tighter than the CI navigationTimeout (45s) and produced a cold-start
    // flake absorbed only by a retry. This aligns it with the cold-compile
    // tolerance the config already grants navigations.
    await submitBtn.click();
    await expect(page).toHaveURL(/\/journal\/[a-z0-9]{20,40}$/, { timeout: 60_000 });

    // Detail page renders the TradingView analysis link (the psychology triad's
    // « Avant » moment carries an accessible « analyse d'entrée » anchor).
    await expect(
      page.getByRole('link', { name: "Voir l'analyse d'entrée sur TradingView" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

    // Real DB row: the trade belongs to the member and carries the TradingView
    // entry link — with NO screenshot key (J1: the photo pipeline is retired).
    const trade = await db.trade.findFirst({
      where: { userId: member.id, pair: 'EURUSD' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        screenshotEntryKey: true,
        tradingViewEntryUrl: true,
        closedAt: true,
      },
    });
    expect(trade).not.toBeNull();
    expect(trade?.tradingViewEntryUrl).toBe(ENTRY_LINK);
    expect(trade?.screenshotEntryKey).toBeNull();
    expect(trade?.closedAt).toBeNull(); // open trade — close flow is separate
    expect(page.url()).toContain(`/journal/${trade!.id}`);

    // --- 5. The card shows up on the /journal list.
    await page.goto('/journal');
    await expect(page.locator(`a[href="/journal/${trade!.id}"]`)).toBeVisible();
  });

  test('B — pagination 50+ : page 1 exacte, page suivante, cursor forgé (S4 DOD1-02)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // --- 1. Seed 60 extra CLOSED trades straight through Prisma. `enteredAt`
    // spread hourly into the past → strictly distinct sort keys, so the
    // `orderBy enteredAt desc` + id-cursor pagination is fully stable.
    // (Minimum required Trade scalars per schema.prisma:519-658 + the closed
    // block ; Decimal columns accept plain numbers.)
    const baseMs = Date.now() - 60 * 60 * 1000; // 1h ago, before test A's trade
    await db.trade.createMany({
      data: Array.from({ length: 60 }, (_, i) => {
        const enteredAt = new Date(baseMs - i * 60 * 60 * 1000);
        return {
          userId: member!.id,
          pair: 'GBPUSD',
          direction: i % 2 === 0 ? ('long' as const) : ('short' as const),
          session: 'london' as const,
          enteredAt,
          entryPrice: 1.265,
          lotSize: 0.1,
          plannedRR: 2,
          emotionBefore: ['calm'],
          planRespected: true,
          // Closed block — `closedAt` non-null is THE “clôturé” marker.
          exitedAt: new Date(enteredAt.getTime() + 30 * 60 * 1000),
          exitPrice: 1.27,
          outcome: 'win' as const,
          realizedR: 1,
          realizedRSource: 'computed' as const,
          emotionAfter: ['calm'],
          emotionDuring: ['calm'],
          closedAt: new Date(enteredAt.getTime() + 30 * 60 * 1000),
        };
      }),
    });

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // --- 2. Page 1: EXACTLY 50 cards + the « plus anciens » pagination link.
    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Mes trades' })).toBeVisible();
    const cards = page.locator(TRADE_CARD_SELECTOR);
    await expect(cards).toHaveCount(50);
    const olderLink = page.getByRole('link', { name: 'Voir les trades plus anciens' });
    await expect(olderLink).toBeVisible();

    // --- 3. Next page: the remaining trades (≥ 10 — 11 when test A's trade
    // is present, 10 if this test ever runs standalone) + « revenir au début ».
    await olderLink.click();
    await expect(page).toHaveURL(/\/journal\?cursor=/);
    await expect(page.getByRole('link', { name: 'revenir au début' })).toBeVisible();
    const page2Count = await cards.count();
    expect(page2Count).toBeGreaterThanOrEqual(10);

    // --- 4. Forged cursor → parseCursor rejects it (hyphen + too short),
    // the page degrades to page 1 — NEVER a 500 (journal/page.tsx:39-41).
    await page.goto('/journal?cursor=zzz-invalide');
    await expect(page.getByRole('heading', { name: 'Mes trades' })).toBeVisible();
    await expect(cards).toHaveCount(50); // degraded to page 1, list intact
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
