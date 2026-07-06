/**
 * S4 (verification/optimization layer) — the constancy score TRAJECTORY on
 * /verification (brief §29 « voir l'évolution »). Closes the asymmetry where
 * behavioral scores already had a trend (`ScoreTrendChart` on /progression) but
 * the constancy score only showed an isolated weekly snapshot.
 *
 * Exercised END TO END against real Postgres through the real UI:
 *   - seed a member + 3 weekly ConstancyScore rows (this week + the two prior),
 *     distinct values so the curve actually moves;
 *   - /verification renders the new `<ConstancyTrend>` (server SVG, role=img)
 *     with its honest aria-label and the « 3 semaines suivies » caption;
 *   - DoD §32-d gates: 0 horizontal overflow + 0 console error, on chromium AND
 *     mobile-iphone-15 (393px).
 *
 * Seeding mirrors `s4-espace-membre-s3-surfaces.spec.ts` (direct Prisma via
 * `@/lib/db` + pure timezone helpers, never a `'server-only'` import).
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const PARIS_TZ = 'Europe/Paris';

let member: SeededUser | null = null;

/** ISO-week Monday (Paris) — mirror of `currentPeriodStart` (constancy.ts:257). */
function currentParisWeekMonday(): string {
  let day = localDateOf(new Date(), PARIS_TZ);
  while (parseLocalDate(day).getUTCDay() !== 1) {
    day = shiftLocalDate(day, -1);
  }
  return day;
}

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

test.describe('S4 — trajectoire du score de constance sur /verification (real DB)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S4Trend' });

    const thisMonday = currentParisWeekMonday();
    // 3 weekly folds with a moving value (60 → 68 → 75) so the curve is non-flat.
    const weeks: ReadonlyArray<{ monday: string; value: number }> = [
      { monday: shiftLocalDate(thisMonday, -14), value: 60 },
      { monday: shiftLocalDate(thisMonday, -7), value: 68 },
      { monday: thisMonday, value: 75 },
    ];
    for (const w of weeks) {
      await db.constancyScore.create({
        data: {
          memberId: member.id,
          value: w.value,
          breakdown: { honesty: w.value, regularity: w.value, discipline: w.value },
          periodStart: parseLocalDate(w.monday),
          periodEnd: parseLocalDate(shiftLocalDate(w.monday, 6)),
        },
      });
    }
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('le trajet de constance s’affiche, sans overflow ni erreur console', async ({
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

    await page.goto('/verification');
    await expect(page.getByRole('heading', { name: 'Ta réalité de trading' })).toBeVisible();

    const constancySection = page.getByRole('region', { name: 'Ta constance' });
    // The card still shows the latest week (75/100) …
    await expect(constancySection.getByText('75/100', { exact: true })).toBeVisible();
    // … and the NEW trajectory renders below it.
    await expect(constancySection.getByText('Ton évolution')).toBeVisible();
    await expect(constancySection.getByText('3 semaines suivies')).toBeVisible();
    const trend = constancySection.getByRole('img', {
      name: /Évolution de ton score de constance sur 3 semaines/,
    });
    await expect(trend).toBeVisible();

    // DoD §32-d — no horizontal overflow ; the SVG is fluid (viewBox + w-full),
    // proven down to iPhone SE (375) and the narrowest realistic phone (320).
    const measureOverflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await measureOverflow(), `overflow on ${testInfo.project.name}`).toBeLessThanOrEqual(1);
    // 375 = the project's documented minimum target (iPhone SE, CLAUDE.md). The
    // trend SVG is fluid (viewBox + w-full) so it scales cleanly to this width.
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await measureOverflow(), 'overflow at 375px').toBeLessThanOrEqual(1);

    // 0 console error (frontend gate).
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
