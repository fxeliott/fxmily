import { existsSync } from 'node:fs';

import { chromium, expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * S26 runtime verification — « Fidélité à ta gestion ». The session captures the
 * THREE management hard-rules of Eliott's method at trade close (stop placed per
 * the member's own rule, break-even at RR 1, 90/10 partial at the TP), as tri-state
 * self-declared ACTS, and surfaces them as three new rows in the MethodMirror.
 *
 * The pure logic is unit-tested (`compute.test.ts`, `service.test.ts`,
 * `schemas/trade.test.ts`, `derived-goals.test.ts`); THIS proves the INTEGRATION
 * against real Postgres through the real Next.js RSC pages:
 *
 *   1. (capture) the close form renders the 3 management radiogroups, calm and
 *      OPTIONAL — never a submit gate, never red, never a market call;
 *   2. (mirror)  a member whose closed trades carry the management acts SEES the
 *      3 new fidelity rows on /progression, with honest rates derived from his
 *      own data — and the empty-state copy mentions the management dimension.
 *
 * Posture §2 (BLOQUANT) is asserted on every surface: the app mirrors that the
 * member followed HIS OWN execution rule, never where/what to trade. §31.2
 * (anti-Black-Hat): calm bands, never red-punitive, never a verdict.
 * Determinism (canon J-C3): every assertion gates on an auto-waiting
 * `expect(locator)`, `:visible` past the RSC stream buffer, no `networkidle`.
 * Seeds + cleans its own `*.e2e.test@fxmily.local` users.
 */

let closeMember: SeededUser | null = null;
let mirrorMember: SeededUser | null = null;
let openTradeId: string | null = null;

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run.`,
    };
  }
  return { ok: true };
}

async function dismissCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

/** Console errors that are dev-server noise, never a real defect. */
function isBenignConsoleError(text: string): boolean {
  return (
    text.includes('Download the React DevTools') ||
    text.includes('favicon') ||
    text.includes('[Fast Refresh]')
  );
}

/**
 * A UTC instant whose Europe/Paris wall-clock is `utcHour:utcMin`, `daysAgo`
 * days back. The seeds run in June (CEST = UTC+2) so 12:00Z = 14h Paris (inside
 * the 13h–16h window) and 13:00Z = 15h Paris — deterministic for this suite.
 */
function parisInstant(daysAgo: number, utcHour: number, utcMin = 0): Date {
  const base = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), utcHour, utcMin, 0, 0),
  );
}

/** Seed one fully-formed trade (all required columns), open or closed. */
async function seedTrade(
  userId: string,
  t: {
    enteredAt: Date;
    closedAt?: Date | null;
    outcome?: 'win' | 'loss' | 'break_even';
    /** S26 — management-fidelity acts, answered at close (tri-state). */
    slPerRule?: boolean | null;
    movedToBe?: boolean | null;
    partialAtTarget?: boolean | null;
  },
): Promise<string> {
  const closed = t.closedAt ?? null;
  const row = await db.trade.create({
    data: {
      userId,
      pair: 'EURUSD',
      direction: 'short',
      session: 'newyork',
      enteredAt: t.enteredAt,
      entryPrice: 1.085,
      lotSize: 0.1,
      stopLossPrice: 1.087,
      plannedRR: 3,
      emotionBefore: ['calm'],
      planRespected: true,
      hedgeRespected: null,
      notes: null,
      screenshotEntryKey: null,
      ...(closed
        ? {
            exitedAt: closed,
            exitPrice: t.outcome === 'loss' ? 1.087 : 1.08,
            outcome: t.outcome ?? 'win',
            realizedR: t.outcome === 'loss' ? -1 : 2,
            realizedRSource: 'computed' as const,
            emotionDuring: t.outcome === 'loss' ? ['fear-loss'] : ['focused'],
            emotionAfter: t.outcome === 'loss' ? ['frustrated'] : ['calm'],
            closedAt: closed,
            // S26 — the captured management acts (null when omitted).
            slPerRule: t.slPerRule ?? null,
            movedToBe: t.movedToBe ?? null,
            partialAtTarget: t.partialAtTarget ?? null,
          }
        : {}),
    },
  });
  return row.id;
}

/**
 * 6 closed trades on 6 distinct Paris days, each carrying the management acts.
 * Mixed true/false so the 3 new mirror rates are real (non-null) and span the
 * calm bands: slPerRule mostly kept (solid), movedToBe half (en bonne voie),
 * partialAtTarget weak (à renforcer — amber, NEVER red).
 */
async function seedManagementActs(userId: string): Promise<void> {
  const days = [2, 4, 6, 8, 10, 12];
  for (const [i, daysAgo] of days.entries()) {
    await seedTrade(userId, {
      enteredAt: parisInstant(daysAgo, 12), // 14h Paris (in-window)
      closedAt: parisInstant(daysAgo, 13), // 15h Paris, same day (cut respected)
      outcome: 'win',
      slPerRule: i < 5, // 5/6 kept → ~83% (solid)
      movedToBe: i % 2 === 0, // 3/6 → 50% (en bonne voie)
      partialAtTarget: i < 2, // 2/6 → ~33% (à renforcer, amber)
    });
  }
}

test.describe('S26 — Fidélité à ta gestion (capture au close + miroir /progression) · §2', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();

    // Member #1 — one OPEN trade to render the close form on.
    closeMember = await seedMemberUser({ firstName: 'Closeform' });
    openTradeId = await seedTrade(closeMember.id, {
      enteredAt: parisInstant(0, 12), // entered today, still open
      closedAt: null,
    });

    // Member #2 — 6 closed trades carrying the management acts for the mirror.
    mirrorMember = await seedMemberUser({ firstName: 'Mirrorgest' });
    await seedManagementActs(mirrorMember.id);
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    closeMember = null;
    mirrorMember = null;
    openTradeId = null;
  });

  test('capture — la form de clôture rend les 3 radiogroups de gestion, calmes et optionnels (§2/§31.2)', async ({
    page,
    request,
  }) => {
    if (!closeMember || !openTradeId) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, closeMember.email, closeMember.password);

    await page.goto(`/journal/${openTradeId}/close`);

    // The form renders (no crash from the new section).
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Clôturer/i);

    // The 3 management radiogroups render with the calm, §2-safe copy.
    const sl = page.getByRole('radiogroup', { name: 'Stop placé selon ta règle' });
    const be = page.getByRole('radiogroup', { name: 'Break-even à RR 1' });
    const partial = page.getByRole('radiogroup', { name: 'Sécurisation partielle au TP' });
    await expect(sl).toBeVisible();
    await expect(be).toBeVisible();
    await expect(partial).toBeVisible();

    // The section frames it as a mirror, never a judgement (§31.2).
    await expect(page.getByText(/Un miroir, pas un jugement/i)).toBeVisible();
    await expect(page.getByText('Fidélité à ta gestion').first()).toBeVisible();

    // It is OPTIONAL — the submit gate is the TradingView exit link + emotions
    // only (J1), never the management acts (CANON: a new required field at close
    // breaks the wizard e2e). None of the management radios are checked by
    // default, yet the page is valid.
    await expect(sl.getByRole('radio', { checked: true })).toHaveCount(0);

    // POSTURE §2 (BLOQUANT) — the section is about the member's OWN rule, never a
    // market call. Scoped to the close form (the only `noValidate` form on the
    // page — the nav search form is a separate, distinct element).
    const formBody = page.locator('form[novalidate]');
    await expect(formBody).not.toContainText(
      /ach[èe]te maintenant|signal d'achat|niveau d'entrée conseillé/i,
    );

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('miroir — les 3 règles de gestion remontent sur /progression avec des taux réels (§2/§31.2)', async ({
    page,
    request,
  }) => {
    if (!mirrorMember) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, mirrorMember.email, mirrorMember.password);

    await page.goto('/progression');
    const mirror = page.locator('[data-slot="method-mirror-card"]:visible');
    await expect(mirror).toBeVisible();

    // The 3 new management rows render with their calm §2-safe labels.
    await expect(mirror).toContainText(/Stop selon ta règle/i);
    await expect(mirror).toContainText(/Break-even à RR 1/i);
    await expect(mirror).toContainText(/Sécurisation au TP/i);

    // Honest rates derived from the seeded data are shown (meters expose them to
    // assistive tech). The slPerRule meter (5/6 kept) reflects the real numerator.
    const slMeter = mirror.getByRole('meter', { name: /Stop selon ta règle/i });
    await expect(slMeter).toBeVisible();
    await expect(slMeter).toHaveAttribute('aria-label', /5 sur 6/);

    // §31.2 (BLOQUANT) — the framing is a mirror, never a verdict/sanction.
    await expect(mirror).toContainText(/Un miroir, pas un verdict/i);
    await expect(mirror).not.toContainText(/tu as fauté|honteux|sanction|verdict d[ée]favorable/i);

    // POSTURE §2 (BLOQUANT) — never a market call anywhere on the card.
    await expect(mirror).not.toContainText(/ach[èe]te|vends?|signal d'achat|niveau d'entrée/i);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
