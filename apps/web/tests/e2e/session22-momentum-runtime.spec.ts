import { existsSync } from 'node:fs';

import { chromium, expect, test, type ConsoleMessage } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * S22 runtime verification — the member-facing MomentumCard (slow-drift signal)
 * exercised END-TO-END against real Postgres through the real Next.js RSC
 * dashboard, not just jsdom. The component LOGIC (healthy→null, insufficient→
 * null, decline→calm card, steepest-only) is exhaustively unit-tested in
 * `momentum-card.test.tsx`; this spec proves the integration:
 *   1. a member with a sustained behavioral decline actually SEES the calm card
 *      on /dashboard (real Server Component render, real `getBehavioralScoreHistory`);
 *   2. a brand-new member sees NOTHING (the card is not a permanent fixture) and
 *      the dashboard still renders cleanly — no crash, no uncaught error.
 *
 * Determinism (canon J-C3): every assertion gates on an auto-waiting
 * `expect(locator)`, no `networkidle`. Seeds + cleans its own users.
 */

let declining: SeededUser | null = null;
let fresh: SeededUser | null = null;

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

/**
 * Seed exactly the shape `detectMomentum` flags: 7 weekly snapshots inside the
 * 6-week window, emotionalStability sliding ~-3 pts/week (well past the -0.5
 * threshold), discipline flat (must NOT be flagged → proves we surface only the
 * steepest). `components`/`sampleSize` are unused by the dashboard read path
 * (verified: NorthStarHero reads only `disciplineScore`; the score cards read
 * the 4 int columns) so `{}` is safe.
 */
async function seedDecliningScores(userId: string): Promise<void> {
  const stability = [82, 79, 76, 73, 70, 67, 64];
  const discipline = [71, 70, 71, 72, 71, 72, 71];
  const today = new Date();
  const rows = stability.map((s, i) => {
    const daysAgo = (stability.length - 1 - i) * 7 + 1; // last point = yesterday
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    d.setUTCHours(0, 0, 0, 0);
    return {
      userId,
      date: d,
      disciplineScore: discipline[i]!,
      emotionalStabilityScore: s,
      consistencyScore: null,
      engagementScore: null,
      components: {},
      sampleSize: {},
      windowDays: 30,
    };
  });
  await db.behavioralScore.createMany({ data: rows });
}

/** Console errors that are dev-server noise, never a real defect. */
function isBenignConsoleError(text: string): boolean {
  return (
    text.includes('Download the React DevTools') ||
    text.includes('favicon') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('S22 — MomentumCard surfacée au membre (runtime, posture §2)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    declining = await seedMemberUser({ firstName: 'Drifter' });
    fresh = await seedMemberUser({ firstName: 'Freshstart' });
    await seedDecliningScores(declining.id);
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    declining = null;
    fresh = null;
  });

  test('un membre en dérive soutenue VOIT la carte calme sur le dashboard', async ({
    page,
    request,
  }) => {
    if (!declining) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, declining.email, declining.password);

    await page.goto('/dashboard');

    const card = page.locator('[data-slot="momentum-card"]');
    await expect(card).toBeVisible();
    // The drifting dimension is named, calmly — and the word-spacing is intact
    // (regression guard: JSX must keep the space between the dimension label and
    // "s'est", not render "stabilités'est").
    await expect(card.getByText(/tassée/i)).toBeVisible();
    await expect(card).toContainText(/stabilité s['’]est tassée/i);
    await expect(card).toContainText(/process/i);
    // NEVER a punitive / alarmist verdict (the sensitive invariant §2/§31.2).
    await expect(card).not.toContainText(/fais mieux|tu baisses|verdict|urgent/i);

    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: 'test-results/s22-momentum-card.png' });

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('un membre tout neuf ne voit RIEN (pas de bruit) et le dashboard rend proprement', async ({
    page,
    request,
  }) => {
    if (!fresh) throw new Error('seed missing — beforeAll did not run');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, fresh.email, fresh.password);

    await page.goto('/dashboard');

    // Dashboard renders (hero present) but the momentum card is ABSENT from the DOM.
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('[data-slot="momentum-card"]')).toHaveCount(0);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
