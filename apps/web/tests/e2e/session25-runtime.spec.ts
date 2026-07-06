import { existsSync } from 'node:fs';

import { chromium, expect, test, type ConsoleMessage } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * S25 runtime verification — the three "guider le membre" surfaces shipped this
 * session, exercised END-TO-END against real Postgres through the real Next.js
 * RSC pages. The pure logic is unit-tested (`derived-goals.test.ts`,
 * `post-loss-reaction.test.ts`) and the hero branch in `north-star-hero.render`;
 * this spec proves the INTEGRATION on populated data:
 *
 *   1. (#2) a member whose data shows a weak hard-rule SEES his DERIVED, evolving
 *      method goal — full card on /objectifs, compact on the hub — a real
 *      "MON objectif issu de MA donnée" with a progress bar, never invented;
 *   2. (#6) a member who re-entered the SAME day after a SL SEES the calm
 *      post-loss-reaction mirror on /progression (never red, never a verdict);
 *   3. (#1) the hero always renders cleanly and tracks the trading clock — during
 *      the live session it carries the method focal, off-hours the admin step.
 *
 * Posture §2 (BLOQUANT) is asserted on every surface: no market call ever.
 * Determinism (canon J-C3): every assertion gates on an auto-waiting
 * `expect(locator)`, `:visible` past the RSC stream buffer, no `networkidle`.
 * Seeds + cleans its own `*.e2e.test@fxmily.local` users.
 */

let goalMember: SeededUser | null = null;
let reactMember: SeededUser | null = null;
let plainMember: SeededUser | null = null;

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

/** Console errors that are dev-server noise, never a real defect. */
function isBenignConsoleError(text: string): boolean {
  return (
    text.includes('Download the React DevTools') ||
    text.includes('favicon') ||
    text.includes('[Fast Refresh]')
  );
}

/** Is the trading session live RIGHT NOW (12h–20h Paris)? Drives the #1 branch. */
function isLiveSessionHourParis(): boolean {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  );
  return h >= 12 && h < 20;
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
    /** Defaults to 3 (the method's target) — only the #2 seed sets it weak (2). */
    plannedRR?: number;
    realizedR?: number;
  },
): Promise<void> {
  const closed = t.closedAt ?? null;
  const plannedRR = t.plannedRR ?? 3;
  await db.trade.create({
    data: {
      userId,
      pair: 'EURUSD',
      direction: 'short',
      session: 'newyork',
      enteredAt: t.enteredAt,
      entryPrice: 1.085,
      lotSize: 0.1,
      stopLossPrice: 1.087,
      plannedRR,
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
            realizedR: t.realizedR ?? (t.outcome === 'loss' ? -1 : 2),
            realizedRSource: 'computed' as const,
            emotionDuring: t.outcome === 'loss' ? ['fear-loss'] : ['focused'],
            emotionAfter: t.outcome === 'loss' ? ['frustrated'] : ['calm'],
            closedAt: closed,
          }
        : {}),
    },
  });
}

/**
 * #2 — 6 trades on 6 distinct Paris days, each entered 14h (in-window), closed
 * 15h same day (cut respected), but planned RR = 2 (< the method's 3). So the
 * mirror is: window 100 % · 1/jour 100 % · coupure 100 % · visée RR3 = 0 % → the
 * weakest hard rule is RR3 ⇒ `deriveMethodGoal` returns a real, evolving goal.
 */
async function seedWeakTargetRR(userId: string): Promise<void> {
  for (const daysAgo of [2, 4, 6, 8, 10, 12]) {
    await seedTrade(userId, {
      enteredAt: parisInstant(daysAgo, 12), // 14h Paris
      closedAt: parisInstant(daysAgo, 13), // 15h Paris, same day
      outcome: 'win',
      plannedRR: 2, // < TARGET_RR (3) → RR3 rule weak
    });
  }
}

/**
 * #6 — 3 closed losses on 3 distinct Paris days; two are followed by a SAME-day
 * re-entry (one within 30 min = "fast", one after 60 min), one is clean. So the
 * mirror reads: 3 pertes · repris 2 fois (dont 1 < 30 min) · médiane 38 min.
 */
async function seedPostLossReentries(userId: string): Promise<void> {
  // Day A — loss closed 15h, re-entry 15h15 (15 min → fast).
  await seedTrade(userId, {
    enteredAt: parisInstant(3, 12),
    closedAt: parisInstant(3, 13),
    outcome: 'loss',
  });
  await seedTrade(userId, {
    enteredAt: parisInstant(3, 13, 15),
    closedAt: parisInstant(3, 14),
    outcome: 'win',
    plannedRR: 3,
  });
  // Day B — loss closed 15h, re-entry 16h (60 min → not fast).
  await seedTrade(userId, {
    enteredAt: parisInstant(5, 12),
    closedAt: parisInstant(5, 13),
    outcome: 'loss',
  });
  await seedTrade(userId, {
    enteredAt: parisInstant(5, 14),
    closedAt: parisInstant(5, 15),
    outcome: 'win',
    plannedRR: 3,
  });
  // Day C — loss closed 15h, NO re-entry.
  await seedTrade(userId, {
    enteredAt: parisInstant(7, 12),
    closedAt: parisInstant(7, 13),
    outcome: 'loss',
  });
}

test.describe('S25 — guider le membre (objectif dérivé, réaction post-perte, fil horaire) · §2', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    goalMember = await seedMemberUser({ firstName: 'Goaltarget' });
    await seedWeakTargetRR(goalMember.id);
    reactMember = await seedMemberUser({ firstName: 'Reentry' });
    await seedPostLossReentries(reactMember.id);
    plainMember = await seedMemberUser({ firstName: 'Plainhub' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    goalMember = null;
    reactMember = null;
    plainMember = null;
  });

  test('#2 — le membre voit son OBJECTIF de méthode dérivé (full /objectifs + compact /hub)', async ({
    page,
    request,
  }) => {
    if (!goalMember) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/login');
    await loginAs(page, request, goalMember.email, goalMember.password);

    // --- /objectifs : full card ---
    await page.goto('/objectifs');
    const full = page.locator('[data-slot="method-goal-card"]:visible');
    await expect(full).toBeVisible();
    await expect(full).toContainText(/Ton objectif du moment/i);
    // The weakest hard rule (RR3) is the one surfaced — derived, not invented.
    await expect(full).toHaveAttribute('data-rule', 'targetRR');
    await expect(full).toContainText(/Visée RR 3/i);
    await expect(full).toContainText(/cible \d+%/i);
    await expect(full).toContainText(/Dérivé de tes \d+ derniers jours/i);
    // The progress bar is exposed to assistive tech.
    await expect(full.getByRole('progressbar')).toBeVisible();
    // POSTURE §2 — a process goal, never a market call.
    await expect(full).not.toContainText(/ach[èe]te|vends?|achat|vente/i);

    // --- /dashboard : compact card (same derived goal, hub surface) ---
    await page.goto('/dashboard');
    const compact = page.locator('[data-slot="method-goal-card"]:visible');
    await expect(compact).toBeVisible();
    await expect(compact).toHaveAttribute('data-rule', 'targetRR');
    await expect(compact).toContainText(/Ton objectif du moment/i);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('#6 — le membre qui a repris après un SL voit le miroir CALME (jamais rouge/verdict)', async ({
    page,
    request,
  }) => {
    if (!reactMember) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/login');
    await loginAs(page, request, reactMember.email, reactMember.password);

    await page.goto('/progression');
    const card = page.locator('[data-slot="post-loss-reaction-card"]:visible');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-state', 'reentries');
    await expect(card).toContainText(/Reprendre après un SL/i);
    // Factual mirror of the real seeded data: 3 losses, re-entered same day.
    await expect(card).toContainText(/3/);
    await expect(card).toContainText(/repris le même jour/i);
    await expect(card).toContainText(/moins de 30/i); // 1 fast re-entry surfaced
    // The method's discipline rule is referenced (process, not a market call).
    await expect(card).toContainText(/un SL, et la journée s['’]arrête/i);
    // §31.2 (BLOQUANT) — never red-punitive, never a verdict.
    await expect(card).not.toContainText(/tu as fauté|fais mieux|échou[ée]|verdict|honteux/i);
    // POSTURE §2 — never a market call.
    await expect(card).not.toContainText(/ach[èe]te|vends?|achat|vente/i);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('#1 — le hero rend proprement et suit l’horloge (focal séance ou étape admin), §2', async ({
    page,
    request,
  }) => {
    if (!plainMember) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/login');
    await loginAs(page, request, plainMember.email, plainMember.password);

    await page.goto('/dashboard');

    // The hero greeting always renders (no crash from the new prop/branch).
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Plainhub/);

    if (isLiveSessionHourParis()) {
      // Live session → the method moment owns the hero focal.
      const focal = page.locator('[data-slot="hero-session-focus"]:visible');
      await expect(focal).toBeVisible();
      await expect(page.getByText('En ce moment').first()).toBeVisible();
      await expect(focal).not.toContainText(/ach[èe]te|vends?|achat|vente/i);
    } else {
      // Off-hours → unchanged behaviour: no session focal on the hero.
      await expect(page.locator('[data-slot="hero-session-focus"]')).toHaveCount(0);
      await expect(page.getByText('Prochaine étape').first()).toBeVisible();
    }

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
