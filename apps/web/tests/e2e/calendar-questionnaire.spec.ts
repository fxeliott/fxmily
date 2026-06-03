/**
 * §26 Calendrier adaptatif — J-C3 questionnaire E2E : auth-gate + happy-path
 * (capture/persist/render).
 *
 * Covers in phases :
 *
 *   1. AUTH GATE — anon on `/calendar/questionnaire/new` is bounced to `/login`
 *      (proxy + page-level `auth()` + `status==='active'` gate).
 *   2. CAPTURE + PERSIST — a `WeeklyScheduleQuestionnaire` created directly via
 *      Prisma round-trips the J-C1 schema (Prisma 7 guarantees the contract at
 *      compile time; this re-verifies at runtime + the nested responses shape).
 *      The `@db.Date` `week_start` is anchored to the member's Europe/Paris
 *      civil Monday (`localDateOf`/`parseLocalDate`) — else a deterministic
 *      nocturnal flake 22:00–00:00 UTC (invariant PR#96 / §26).
 *   3. RENDER — `/calendar/questionnaire/new` (the wizard) and `/dashboard`
 *      (the status widget) load without bouncing + without a Next error overlay.
 *
 * NOT covered (canon `v1-5-mindset-check.spec.ts`) : driving the wizard UI
 * (hidden inputs + localStorage → fragile selectors). The capture layer is
 * covered by the Vitest Zod / Server-Action unit tests.
 *
 * Scar GG-CI : NEVER import a `'server-only'` module here (e.g.
 * `lib/calendar/service.ts`). We touch Prisma directly via `@/lib/db` and the
 * pure helpers (`@/lib/checkin/timezone`, `@/lib/calendar/instrument-v1`),
 * which carry no `'server-only'` marker.
 *
 * Cleanup : `WeeklyScheduleQuestionnaire` declares `onDelete: Cascade` AND
 * `cleanupTestUsers` wipes it explicitly (`db-helpers.ts`, FK-correct before
 * `db.user`).
 *
 * Skipping policy (carbon J9 visual) : skip with a clear message if Playwright
 * Chromium is not installed, rather than crashing.
 */

import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { chromium } from '@playwright/test';

import { CURRENT_CALENDAR_INSTRUMENT_VERSION } from '@/lib/calendar/instrument-v1';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const PARIS_TZ = 'Europe/Paris';

const MEMBER_EMAIL = 'calendar-q.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'CalendarQ-Pwd-2026!';

let member: SeededUser | null = null;

/** Monday (UTC) of the Europe/Paris civil week containing `now`, YYYY-MM-DD. */
function currentParisWeekMonday(): string {
  const todayParis = localDateOf(new Date(), PARIS_TZ);
  const probe = parseLocalDate(todayParis);
  const sinceMonday = (probe.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return shiftLocalDate(todayParis, -sinceMonday);
}

function fullDay(morning: boolean, afternoon: boolean, evening: boolean) {
  return { morning, afternoon, evening };
}

/** A complete, schema-valid responses payload (closed instrument). */
function fullResponses() {
  return {
    profile: 'salarie',
    sessionGoal: 3,
    weekdayAvailability: {
      monday: fullDay(true, false, true),
      tuesday: fullDay(false, false, true),
      wednesday: fullDay(true, false, true),
      thursday: fullDay(false, false, true),
      friday: fullDay(true, true, false),
    },
    weekendAvailability: {
      saturday: fullDay(true, true, false),
      sunday: fullDay(false, false, false),
    },
    sleep: 'standard',
    energyPeak: 'morning',
    meetingCommitment: 'occasional',
    practiceFocus: 'balanced',
    constraint: 'none',
  } as const;
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

test.describe('§26 Calendar questionnaire — auth-gate + happy-path persist/render', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'Calendar',
      lastName: 'Member',
    });

    // Seed the member's current-week questionnaire UP-FRONT so the RENDER
    // tests are self-contained + deterministic (no fragile inter-test data
    // dependency — scar from V1.5 mindset flake).
    await db.weeklyScheduleQuestionnaire.create({
      data: {
        userId: member.id,
        weekStart: parseLocalDate(currentParisWeekMonday()),
        instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: 'morning',
        responses: fullResponses(),
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('anon is bounced to /login on /calendar/questionnaire/new', async ({ page }) => {
    await page.goto('/calendar/questionnaire/new');
    await expect(page).toHaveURL(/\/login/);
  });

  test('CAPTURE + PERSIST: a WeeklyScheduleQuestionnaire round-trips through Prisma', async () => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    const mondayStr = currentParisWeekMonday();
    const weekStartDate = parseLocalDate(mondayStr);
    // The app only ever writes a Monday-UTC weekStart — assert the fixture math.
    expect(weekStartDate.getUTCDay()).toBe(1);

    // Idempotent upsert: `beforeAll` already seeded this week's row, so a bare
    // `create` would hit the `(userId, weekStart)` unique constraint. The
    // round-trip contract (Monday weekStart, frozen version, nested responses)
    // is still fully exercised on the persisted row.
    const row = await db.weeklyScheduleQuestionnaire.upsert({
      where: { userId_weekStart: { userId: member.id, weekStart: weekStartDate } },
      create: {
        userId: member.id,
        weekStart: weekStartDate,
        instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: 'afternoon',
        responses: fullResponses(),
      },
      update: {
        instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: 'afternoon',
        responses: fullResponses(),
      },
      select: {
        weekStart: true,
        instrumentVersion: true,
        energyPeakSlot: true,
        responses: true,
      },
    });

    // @db.Date round-trips as UTC-midnight Date — serialized like the service.
    expect(row.weekStart.toISOString().slice(0, 10)).toBe(mondayStr);
    expect(row.instrumentVersion).toBe(CURRENT_CALENDAR_INSTRUMENT_VERSION);
    expect(row.energyPeakSlot).toBe('afternoon');
    const responses = row.responses as ReturnType<typeof fullResponses>;
    expect(responses.profile).toBe('salarie');
    expect(responses.sessionGoal).toBe(3);
    expect(responses.weekdayAvailability.monday.morning).toBe(true);
    expect(responses.weekendAvailability.sunday.morning).toBe(false);
    expect(responses.constraint).toBe('none');
  });

  test('RENDER: /calendar/questionnaire/new shows the wizard', async ({ page, request }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/calendar/questionnaire/new');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/calendar\/questionnaire\/new/);
    await expect(page.locator('[data-slot="calendar-questionnaire-wizard"]')).toBeVisible();
    await expect(page.locator('[data-slot="calendar-step-progress"]')).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER: /dashboard shows the calendar status widget', async ({ page, request }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('[data-slot="calendar-status-widget"]')).toBeVisible();

    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
