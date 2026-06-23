import { existsSync } from 'node:fs';

import { chromium, expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedMemberUser,
  seedTradeHistory,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * S24 runtime verification — the member-facing SessionTimeline ("Ta journée de
 * trader") exercised END-TO-END against real Postgres through the real Next.js
 * RSC dashboard. The phase LOGIC (boundaries, §2-safe copy) is unit-tested in
 * `phase.test.ts`; this spec proves the INTEGRATION:
 *   1. the timeline always renders on /dashboard (real Server Component render,
 *      real `getSessionRoutine` two-read derivation), desktop AND mobile, with no
 *      horizontal overflow and zero console/page errors;
 *   2. a member who took their SL today actually SEES the calm Mark-Douglas note
 *      ("un SL → la journée s'arrête") — the method's discipline rule surfaced;
 *   3. posture §2 is never violated (no "achète"/"vends" market call).
 *
 * Determinism (canon J-C3): every assertion gates on an auto-waiting
 * `expect(locator)`, no `networkidle`. Seeds + cleans its own users.
 */

let fresh: SeededUser | null = null;
let stopped: SeededUser | null = null;
let profiled: SeededUser | null = null;
let traded: SeededUser | null = null;

/** The two onboarding axes seeded for the `profiled` member (weekly-rotated). */
const SEEDED_AXES = ['Tenir mon plan sans dévier', 'Réduire le FOMO'] as const;

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

/** Seed exactly one trade ENTERED + CLOSED today with a loss (= the method's SL). */
async function seedLossToday(userId: string): Promise<void> {
  const now = new Date();
  await db.trade.create({
    data: {
      userId,
      pair: 'EURUSD',
      direction: 'short',
      session: 'newyork',
      enteredAt: now,
      entryPrice: 1.085,
      lotSize: 0.1,
      stopLossPrice: 1.087,
      plannedRR: 3,
      emotionBefore: ['calm'],
      planRespected: true,
      hedgeRespected: null,
      notes: null,
      screenshotEntryKey: null,
      exitedAt: now,
      exitPrice: 1.087,
      outcome: 'loss',
      realizedR: -1,
      realizedRSource: 'computed',
      emotionDuring: ['fear-loss'],
      emotionAfter: ['frustrated'],
      closedAt: now,
    },
  });
}

/**
 * Seed an onboarding interview + MemberProfile carrying `axes` so the
 * dashboard's CoachingAxisCard has a real, AI-derived axis to surface. The
 * interview is upserted (its `userId` is @unique) to stay idempotent.
 */
async function seedProfileWithAxes(userId: string, axes: readonly string[]): Promise<void> {
  const interview = await db.onboardingInterview.upsert({
    where: { userId },
    create: { userId, status: 'completed', instrumentVersion: 'v1' },
    update: { status: 'completed' },
  });
  await db.memberProfile.upsert({
    where: { userId },
    create: {
      userId,
      interviewId: interview.id,
      summary: 'Profil de test e2e S24.',
      highlights: [],
      axesPrioritaires: [...axes],
      claudeModelVersion: 'claude-opus-4-8',
      instrumentVersion: 'v1',
    },
    update: { axesPrioritaires: [...axes] },
  });
}

/** Assert the timeline renders cleanly with NO horizontal overflow at `width`. */
async function expectNoOverflow(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const timeline = page.locator('[data-slot="session-timeline"]');
  await expect(timeline).toBeVisible();
  // The 4-step grid must never push the card wider than its container.
  const overflow = await timeline.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, `horizontal overflow of ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
}

test.describe('S24 — SessionTimeline (journée-type trader, runtime, posture §2)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    fresh = await seedMemberUser({ firstName: 'Freshstart' });
    stopped = await seedMemberUser({ firstName: 'Stopped' });
    await seedLossToday(stopped.id);
    profiled = await seedMemberUser({ firstName: 'Profiled' });
    await seedProfileWithAxes(profiled.id, SEEDED_AXES);
    traded = await seedMemberUser({ firstName: 'Traded' });
    // 12 trades across the last 12 days → ≥ MIN_ENTERED, all inside the 30-day
    // mirror window → the method-fidelity card renders its rules (not the empty state).
    await seedTradeHistory(traded.id, { count: 12 });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    fresh = null;
    stopped = null;
    profiled = null;
    traded = null;
  });

  test('la timeline rend toujours, desktop + mobile, sans overflow ni erreur', async ({
    page,
    request,
  }) => {
    if (!fresh) throw new Error('seed missing — beforeAll did not run');

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
    await loginAs(page, request, fresh.email, fresh.password);

    await page.goto('/dashboard');

    const timeline = page.locator('[data-slot="session-timeline"]');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText(/Ta journée de trader/i);
    // The four routine steps are always present (the day's anchor).
    await expect(timeline).toContainText(/Analyse/);
    await expect(timeline).toContainText(/Exécution/);
    await expect(timeline).toContainText(/Gestion/);
    await expect(timeline).toContainText(/Coupure/);
    // A brand-new member has no trade today.
    await expect(timeline).toContainText(/Aucun trade aujourd’hui/);
    // POSTURE §2 — never a market call.
    await expect(timeline).not.toContainText(/ach[èe]te|vends?/i);

    // Desktop + mobile, no horizontal overflow.
    await expectNoOverflow(page, 1280);
    await expectNoOverflow(page, 375);

    await timeline.scrollIntoViewIfNeeded();
    await timeline.screenshot({ path: 'test-results/s24-session-timeline.png' });

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('un membre qui a pris son SL du jour voit la note calme Mark Douglas', async ({
    page,
    request,
  }) => {
    if (!stopped) throw new Error('seed missing — beforeAll did not run');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, stopped.email, stopped.password);

    await page.goto('/dashboard');

    const timeline = page.locator('[data-slot="session-timeline"]');
    await expect(timeline).toBeVisible();
    // The day's single trade is counted…
    await expect(timeline).toContainText(/1 trade aujourd’hui/);
    // …and the SL ends the day, surfaced calmly (Mark Douglas, never punitive).
    await expect(timeline).toContainText(/un SL, et la journée de trading s’arrête/i);
    await expect(timeline).toContainText(/repart à zéro/i);
    await expect(timeline).not.toContainText(/fais mieux|tu as échoué|verdict/i);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });

  test('le membre profilé voit son axe de coaching personnel sur le hub', async ({
    page,
    request,
  }) => {
    if (!profiled) throw new Error('seed missing — beforeAll did not run');

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
    await loginAs(page, request, profiled.email, profiled.password);

    await page.goto('/dashboard');

    // `:visible` scopes to the live node only: during RSC streaming the card can
    // momentarily exist twice (the hidden Suspense-stream buffer copy + the placed
    // node), which trips strict mode. The app mounts it exactly once — the filter
    // makes the assertion robust to the streaming window, not lenient about a dup.
    const card = page.locator('[data-slot="coaching-axis-card"]:visible');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Ton axe de coaching cette semaine/i);
    // The weekly-rotated axis is ONE of the two seeded — never empty, never invented.
    await expect(card).toContainText(new RegExp(SEEDED_AXES.join('|')));
    // AI Act §50 — the AI-derived axis carries the disclosure note.
    await expect(card.getByRole('note')).toBeVisible();
    // POSTURE §2 — an axis is a process focus, never a market call.
    await expect(card).not.toContainText(/ach[èe]te|vends?/i);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('le membre actif voit le miroir de fidélité à la méthode sur /progression', async ({
    page,
    request,
  }) => {
    if (!traded) throw new Error('seed missing — beforeAll did not run');

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
    await loginAs(page, request, traded.email, traded.password);

    await page.goto('/progression');

    // Streamed via Suspense → :visible scopes past the stream buffer (strict mode).
    const card = page.locator('[data-slot="method-mirror-card"]:visible');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Ta fidélité à la méthode/i);
    // The four hard rules of the method are each mirrored.
    await expect(card).toContainText(/Fenêtre 13h–16h/);
    await expect(card).toContainText(/Un trade par jour/);
    await expect(card).toContainText(/Coupure 20h/);
    await expect(card).toContainText(/Visée RR 3/);
    // At least one rule shows a percentage (real data, not the empty state).
    await expect(card).toContainText(/%/);
    // POSTURE §2 — a fidelity mirror, never a market call.
    await expect(card).not.toContainText(/ach[èe]te|vends?/i);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
