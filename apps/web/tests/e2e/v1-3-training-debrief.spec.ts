/**
 * V1.3 TrainingDebrief E2E — auth-gates + happy-path (capture/persist/render).
 *
 * SPEC §23. Covers the "Done quand" criterion in 3 phases :
 *
 *   1. CAPTURE — a `TrainingDebrief` (+ an in-week `TrainingTrade` feeding the
 *      stats panel) created directly via Prisma is accepted by the V1.3 DB
 *      schema (Prisma 7 typing guarantees the contract at compile time; this
 *      re-verifies at runtime).
 *   2. PERSIST — DB round-trip. The `@db.Date` `week_start` is anchored to the
 *      member's Europe/Paris civil Monday — `localDateOf`/`parseLocalDate`
 *      exactly like `v1-8-reflect-happy-path.spec.ts:82-88` (else deterministic
 *      nocturnal flake 22:00–00:00 UTC, invariant §23.7 / PR#96).
 *   3. RENDER — `/training/debrief`, `/training/debrief/new` (member) and
 *      `/admin/members/[id]?tab=training` (admin) load without bouncing to
 *      `/login` and show the seeded data, no Next error-overlay.
 *
 * NOT covered here (canon `wizard-v1-5-fields.spec.ts:19-26`) : driving the
 * wizard UI (hidden inputs + localStorage → fragile selectors). The capture
 * layer is covered by the Vitest Zod/Server-Action/aggregator unit tests.
 * Crisis routing (`?crisis=` redirect + persist-anyway) is covered by the
 * Vitest action mirror `app/training/debrief/actions.test.ts` (S8 verif-layer)
 * and the §21.5 projection by `lib/training-debrief/service.test.ts`; the anon
 * auth-bounce is asserted below.
 *
 * Cleanup : `TrainingDebrief` declares `onDelete: Cascade` AND
 * `cleanupTestUsers` now wipes it explicitly (`db-helpers.ts`,
 * `db.trainingDebrief.deleteMany` — added with this jalon, FK-correct before
 * `db.user.deleteMany`). Belt-and-suspenders, mirror REFLECT canon.
 *
 * Skipping policy (carbon J9 visual) : skip with a clear message if Playwright
 * Chromium is not installed, rather than crashing.
 */

import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { chromium } from '@playwright/test';

import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const PARIS_TZ = 'Europe/Paris';

const MEMBER_EMAIL = 'v1-3-debrief.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'V1_3-DebriefPwd-2026!';
const ADMIN_EMAIL = 'v1-3-debrief.admin.e2e.test@fxmily.local';
const ADMIN_PASSWORD = 'V1_3-DebriefAdminPwd-2026!';

// ASCII (accent-free) sentinel at the START of transversalLesson so it stays
// in the 1st `line-clamp` line (timeline) and renders verbatim (admin panel),
// assertable without encoding fragility. Posture §2 : process language only.
const TD_MARKER = 'Marqueur E2E DEBRIEF transversal';

let member: SeededUser | null = null;
let admin: SeededUser | null = null;

/** Monday (UTC) of the Europe/Paris civil week containing `now`, YYYY-MM-DD. */
function currentParisWeekMonday(): string {
  const todayParis = localDateOf(new Date(), PARIS_TZ);
  const probe = parseLocalDate(todayParis);
  const sinceMonday = (probe.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return shiftLocalDate(todayParis, -sinceMonday);
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

test.describe('V1.3 TrainingDebrief — auth-gates + happy-path persist/render', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'V1_3',
      lastName: 'Debrief',
    });
    admin = await seedAdminUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      firstName: 'V1_3',
      lastName: 'DebriefAdmin',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
    admin = null;
  });

  test('anon is bounced to /login on /training/debrief and /training/debrief/new', async ({
    page,
  }) => {
    await page.goto('/training/debrief');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/training/debrief/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('CAPTURE + PERSIST: a TrainingDebrief + an in-week backtest round-trip through Prisma', async () => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    const mondayStr = currentParisWeekMonday();
    const weekStartDate = parseLocalDate(mondayStr);
    // The app only ever writes a Monday-UTC weekStart (Zod
    // `trainingDebriefWeekStartSchema`) — assert the fixture math is faithful.
    expect(weekStartDate.getUTCDay()).toBe(1);

    // An in-week backtest so the stats panel renders its charts (not the
    // pedagogical "0 backtest" block). enteredAt = Wednesday 10:00Z → Paris
    // mid-day Wednesday, unambiguously inside the Paris civil week.
    await db.trainingTrade.create({
      data: {
        userId: member.id,
        pair: 'EURUSD',
        entryScreenshotKey: null,
        plannedRR: 2,
        outcome: null,
        resultR: null,
        systemRespected: true,
        lessonLearned: 'E2E backtest — patience sur le setup, pas de forçage.',
        enteredAt: new Date(`${shiftLocalDate(mondayStr, 2)}T10:00:00.000Z`),
      },
      select: { id: true },
    });

    const debrief = await db.trainingDebrief.create({
      data: {
        userId: member.id,
        weekStart: weekStartDate,
        processStrengthOne:
          "J'ai attendu la confirmation de mon systeme au lieu d'anticiper l'entree.",
        processStrengthTwo: "J'ai journalise chaque backtest sans en sauter un seul.",
        microAdjustment: 'Preparer la watchlist la veille au soir, 10 minutes max.',
        transversalLesson: `${TD_MARKER} : la regularite de la pratique bat l'intensite ponctuelle.`,
      },
      select: {
        id: true,
        weekStart: true,
        processStrengthOne: true,
        processStrengthTwo: true,
        microAdjustment: true,
        transversalLesson: true,
      },
    });

    // @db.Date round-trips as UTC-midnight Date — serialized like the service
    // (`training-debrief/service.ts` `toSerialized`).
    expect(debrief.weekStart.toISOString().slice(0, 10)).toBe(mondayStr);
    expect(debrief.transversalLesson).toContain(TD_MARKER);
    expect(debrief.processStrengthOne.length).toBeGreaterThanOrEqual(10);
    expect(debrief.processStrengthTwo.length).toBeGreaterThanOrEqual(10);
    expect(debrief.microAdjustment.length).toBeGreaterThanOrEqual(10);
  });

  test('RENDER: /training/debrief loads for the active member and shows the seeded debrief', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/training/debrief');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/training\/debrief/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/débrief/i);
    await expect(page.getByRole('heading', { level: 2 })).toContainText(/débriefs récents/i);
    await expect(page.locator('[data-slot="training-debrief-timeline"]')).toBeVisible();
    await expect(page.getByText(new RegExp(TD_MARKER))).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: /training/debrief/new shows the read-only stats panel + the wizard', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/training/debrief/new');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/training\/debrief\/new/);
    await expect(page.locator('[data-slot="training-debrief-stats"]')).toBeVisible();
    await expect(page.locator('[data-slot="training-debrief-wizard"]')).toBeVisible();
    // An in-week backtest exists → the panel must NOT show the empty block.
    await expect(page.locator('[data-slot="training-debrief-stats-empty"]')).toHaveCount(0);

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: admin sees the read-only debrief section in ?tab=training', async ({
    page,
    request,
  }) => {
    if (!member || !admin) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto(`/admin/members/${member.id}?tab=training`);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(new RegExp(`/admin/members/${member.id}`));
    await expect(page.locator('[data-slot="member-training-debriefs"]')).toBeVisible();
    await expect(page.getByText(new RegExp(TD_MARKER))).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
