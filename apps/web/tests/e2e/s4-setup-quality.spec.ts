/**
 * S4 (verification/optimization layer) — member-facing setup-quality (A/B/C,
 * Steenbarger) + risk-ceiling discipline (Tharp ≤ 2 %) card on /patterns. The
 * data was already collected on Trade.tradeQuality + Trade.riskPct and fed to
 * the AI reports, but never shown to the member (brief §22/§23 "tracker le
 * maximum + voir où il en est").
 *
 * Exercised END TO END against real Postgres through the real UI:
 *   - seed a member + 6 closed trades with explicit tradeQuality + riskPct
 *     (own isolated seed — does NOT touch the shared seedTradeHistory PRNG);
 *   - /patterns renders the bar chart + the risk discipline numbers;
 *   - empty-state copy is absent (data present);
 *   - DoD §32-d: 0 horizontal overflow + 0 console error on chromium + iPhone 15.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const H = 3_600_000;

let member: SeededUser | null = null;

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return { ok: false, reason: `Chromium binary not found at ${exec || '(unresolved)'}` };
  }
  return { ok: true };
}

test.describe('S4 — qualité de setup & plafond de risque sur /patterns (real DB)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S4Setup' });

    const now = Date.now();
    // 6 closed trades — quality A,A,B,C,A,B (captured 6) ; riskPct mix with two
    // breaches (>2 %) so the discipline card is non-trivial.
    const seeds: ReadonlyArray<{ q: 'A' | 'B' | 'C'; risk: number }> = [
      { q: 'A', risk: 1.0 },
      { q: 'A', risk: 1.5 },
      { q: 'B', risk: 2.5 },
      { q: 'C', risk: 0.8 },
      { q: 'A', risk: 3.0 },
      { q: 'B', risk: 1.2 },
    ];
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i]!;
      const closedAt = new Date(now - (i + 1) * 6 * H);
      await db.trade.create({
        data: {
          userId: member.id,
          pair: 'EURUSD',
          direction: 'long',
          session: 'london',
          enteredAt: new Date(closedAt.getTime() - H),
          entryPrice: 1.085,
          lotSize: 0.1,
          plannedRR: 2,
          emotionBefore: [],
          planRespected: true,
          outcome: i % 3 === 0 ? 'win' : 'loss',
          tradeQuality: s.q,
          riskPct: s.risk,
          exitedAt: closedAt,
          exitPrice: 1.09,
          realizedR: i % 3 === 0 ? 1.5 : -1,
          realizedRSource: 'computed',
          closedAt,
        },
      });
    }
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('la carte qualité de setup + risque s’affiche, sans overflow ni erreur console', async ({
    page,
    request,
  }, testInfo) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/patterns');
    await expect(page.getByRole('heading', { name: /Qualité de setup & risque/ })).toBeVisible();

    // The two cards render (lazy Recharts chunk loaded).
    await expect(page.getByText('Qualité de setup', { exact: true })).toBeVisible();
    await expect(page.getByText('Plafond de risque', { exact: true })).toBeVisible();
    await expect(page.getByText('Respect ≤ 2 %', { exact: true })).toBeVisible();
    // The honest sr-only chart description proves the bar chart rendered with data.
    await expect(page.locator('#setup-quality-desc')).toBeAttached();

    // Empty states must be ABSENT (we seeded 6 graded + risk-tagged trades).
    await expect(page.getByText('Grade tes setups (A / B / C)')).toHaveCount(0);
    await expect(page.getByText('Saisis le % de capital')).toHaveCount(0);

    // DoD §32-d — no horizontal overflow at this viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${testInfo.project.name}`).toBeLessThanOrEqual(1);
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
