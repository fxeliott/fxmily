/**
 * S8 RE-CHALLENGE — /training landing + detail surfaces that the S8 build added
 * but that had NO end-to-end coverage (the gap an adversarial re-audit surfaced):
 *
 *   - §269 Enrichissement 1 — the "Régularité de la pratique" effort bar
 *     (Séances / Régularité / Série / Journal rempli) renders on the landing.
 *   - §255 — the result filter is not just present but ACTUALLY filters: the
 *     "Gagnants" pill shows only the win, "Perdants" only the loss (proven by
 *     the per-trade link href appearing / disappearing, not a fuzzy text match).
 *   - §254 — a backtest opened from a session echoes its parent session context
 *     (label + "symbole · unité de temps") as sober chips on the detail page.
 *
 * Seeded straight through Prisma (no wizard, no upload) so it stays fast and
 * isolated from the heavy `s8-training-sessions` happy-path. Determinism canon
 * (J-C3): NO `networkidle`; every assertion gates on an auto-waiting
 * `expect(locator)`. Runs on chromium + mobile-iphone-15. 🚨 §21.5: every figure
 * here is TRAINING-ONLY and never leaves this surface.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

let member: SeededUser | null = null;
let winTradeId: string | null = null;
let lossTradeId: string | null = null;

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

test.describe('S8 RE-CHALLENGE — /training landing surfaces (regularity bar, result filter, session echo)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S8Landing' });

    // A session so the §254 echo + the §269 "Séances" count have something to
    // resolve to. The win backtest lives INSIDE it; the loss is standalone.
    const session = await db.trainingSession.create({
      data: {
        memberId: member.id,
        label: 'Range EURUSD — e2e §254',
        symbol: 'EURUSD',
        timeframe: 'M15',
        notes: 'Seed landing-surface e2e.',
      },
      select: { id: true },
    });

    const win = await db.trainingTrade.create({
      data: {
        userId: member.id,
        sessionId: session.id,
        pair: 'EURUSD',
        plannedRR: '2.00',
        outcome: 'win',
        systemRespected: true,
        lessonLearned: 'Seed win (e2e landing).',
        enteredAt: new Date('2026-06-25T09:00:00.000Z'),
      },
      select: { id: true },
    });
    winTradeId = win.id;

    const loss = await db.trainingTrade.create({
      data: {
        userId: member.id,
        pair: 'USDJPY',
        plannedRR: '1.50',
        outcome: 'loss',
        systemRespected: false,
        lessonLearned: 'Seed loss (e2e landing).',
        enteredAt: new Date('2026-06-24T09:00:00.000Z'),
      },
      select: { id: true },
    });
    lossTradeId = loss.id;
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
    winTradeId = null;
    lossTradeId = null;
  });

  test('landing renders the §269 regularity bar, the §255 filter actually filters, and the §254 session echo shows on detail', async ({
    page,
    request,
  }) => {
    if (!member || !winTradeId || !lossTradeId) {
      throw new Error('seed missing — beforeAll did not run');
    }

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // --- /training landing.
    await page.goto('/training');
    await expect(page.getByRole('heading', { level: 1, name: 'Mes backtests' })).toBeVisible();

    // §269 — the regularity bar is its own labelled region with the four EFFORT
    // metrics. Scope `getByText` to the region so "Séances" never collides with
    // the "Séances de backtest" sessions heading above it.
    const regularity = page.getByRole('region', { name: 'Régularité de la pratique' });
    await expect(regularity).toBeVisible();
    await expect(regularity.getByText('Séances')).toBeVisible();
    await expect(regularity.getByText('Série')).toBeVisible();
    await expect(regularity.getByText('Journal rempli')).toBeVisible();

    // Per-trade list links — addressed by href (unambiguous: the session card
    // links to /training/sessions/…, never /training/<tradeId>).
    const winCard = page.locator(`a[href="/training/${winTradeId}"]`);
    const lossCard = page.locator(`a[href="/training/${lossTradeId}"]`);

    // §255 — the result filter nav is present and, with no filter, BOTH show.
    const filters = page.getByRole('navigation', { name: 'Filtres' });
    await expect(filters).toBeVisible();
    await expect(winCard).toBeVisible();
    await expect(lossCard).toBeVisible();

    // → Gagnants: only the win remains (the filter genuinely narrows the list).
    await filters.getByRole('link', { name: /Gagnants/ }).click();
    await expect(page).toHaveURL(/\/training\?outcome=win$/);
    await expect(winCard).toBeVisible();
    await expect(lossCard).toBeHidden();

    // → Perdants: the inverse — only the loss remains.
    await filters.getByRole('link', { name: /Perdants/ }).click();
    await expect(page).toHaveURL(/\/training\?outcome=loss$/);
    await expect(lossCard).toBeVisible();
    await expect(winCard).toBeHidden();

    // --- /training/<winTradeId> detail — §254 session echo chips. The win lives
    // in the session, so both the label chip and the "symbole · TF" chip resolve.
    await page.goto(`/training/${winTradeId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'EURUSD' })).toBeVisible();
    await expect(page.getByText('Range EURUSD — e2e §254')).toBeVisible();
    // Composed chip: `{symbol} · {timeframe}`, both seeded trade data (not source
    // copy). Regex so the copy-sync guard doesn't chase a literal the component
    // assembles from fixture values.
    await expect(page.getByText(/EURUSD\s+·\s+M15/)).toBeVisible();
  });
});
