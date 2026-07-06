/**
 * §26 Calendrier adaptatif — J-C4 display E2E : auth-gate + the 3 member states
 * + admin read-only tab + the EU AI Act disclosure stamp/audit.
 *
 * Covers in phases :
 *
 *   1. AUTH GATE — anon on `/calendrier` is bounced to `/login` (proxy +
 *      page-level `auth()` + `status==='active'` gate).
 *   2. RENDER state (i) — a member with NO questionnaire sees the calm CTA
 *      (`[data-state="no-questionnaire"]`).
 *   3. RENDER state (ii) — a member WITH a questionnaire but NO generated
 *      calendar sees the calm "se prépare" state (`[data-state="preparing"]`).
 *   4. RENDER state (iii) + DISCLOSURE — a member with a generated calendar sees
 *      the week-view + the AI banner; the first view STAMPS
 *      `aiDisclosureShownAt` and emits the PII-free `calendar.disclosure.shown`
 *      audit (EU AI Act 50(1)).
 *   5. ADMIN — `/admin/members/[id]?tab=calendar` renders the read-only panel.
 *
 * Scar GG-CI : NEVER import a `'server-only'` module here (e.g.
 * `lib/calendar/service.ts`). We touch Prisma directly via `@/lib/db` and the
 * pure helpers (`@/lib/checkin/timezone`, `@/lib/calendar/instrument-v1`),
 * which carry no `'server-only'` marker.
 *
 * Determinism (canon J-C3) : NO `waitForLoadState('networkidle')` (Turbopack
 * dev keeps an HMR socket open → never idle → flaky). `goto` awaits `load`;
 * the `toBeVisible` assertions auto-wait. Deterministic in dev AND prod.
 *
 * Skipping policy (carbon J9 visual) : skip with a clear message if Playwright
 * Chromium is not installed, rather than crashing.
 */

import { existsSync } from 'node:fs';

import { expect, test } from './fixtures';
import { chromium } from './fixtures';

import { CURRENT_CALENDAR_INSTRUMENT_VERSION } from '@/lib/calendar/instrument-v1';
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

const NOQ_EMAIL = 'calendar-noq.member.e2e.test@fxmily.local';
const QONLY_EMAIL = 'calendar-qonly.member.e2e.test@fxmily.local';
const CAL_EMAIL = 'calendar-cal.member.e2e.test@fxmily.local';
const ADMIN_EMAIL = 'calendar-disp.admin.e2e.test@fxmily.local';
const PWD = 'CalendarDisp-Pwd-2026!';

let memberNoQ: SeededUser | null = null;
let memberQOnly: SeededUser | null = null;
let memberCal: SeededUser | null = null;
let admin: SeededUser | null = null;

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

/** A complete, schema-valid questionnaire responses payload (closed instrument). */
function fullResponses() {
  return {
    profile: 'salarie',
    sessionGoal: 4,
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

const DAY_NAMES = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

/** A `adaptiveCalendarOutputSchema`-shaped weekly plan (7 days, calm blocks). */
function buildSchedule(weekStart: string) {
  const days = DAY_NAMES.map((dayLabel, i) => ({
    date: shiftLocalDate(weekStart, i),
    dayLabel,
    blocks: [
      {
        slot: 'morning',
        category: 'live_trading',
        durationMin: 90,
        label: 'Session de Londres',
        priority: 'high',
      },
      {
        slot: 'evening',
        category: 'mark_douglas_review',
        durationMin: 30,
        label: 'Révision psychologie',
        priority: 'medium',
      },
    ],
  }));
  return {
    weekStart,
    overview:
      "Une semaine équilibrée entre sessions en direct le matin et travail de fond le soir, en respectant ta disponibilité déclarée et ton pic d'énergie matinal.",
    days,
    weeklyFocus:
      'Accepte que chaque trade soit une probabilité, pas une certitude — ton edge se joue sur la série, pas sur un seul résultat.',
    warnings: [
      'Tu as visé 4 sessions mais peu de créneaux le soir : garde de la marge pour le repos.',
    ],
  };
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

test.describe('§26 Calendar display — auth-gate + 3 states + admin + disclosure', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();

    [memberNoQ, memberQOnly, memberCal, admin] = await Promise.all([
      seedMemberUser({ email: NOQ_EMAIL, password: PWD, firstName: 'NoQ', lastName: 'Member' }),
      seedMemberUser({ email: QONLY_EMAIL, password: PWD, firstName: 'QOnly', lastName: 'Member' }),
      seedMemberUser({ email: CAL_EMAIL, password: PWD, firstName: 'Cal', lastName: 'Member' }),
      seedAdminUser({
        email: ADMIN_EMAIL,
        password: PWD,
        firstName: 'Calendar',
        lastName: 'Admin',
      }),
    ]);

    const monday = currentParisWeekMonday();
    const weekStartDate = parseLocalDate(monday);

    // State (ii) member — questionnaire only, NO calendar.
    await db.weeklyScheduleQuestionnaire.create({
      data: {
        userId: memberQOnly.id,
        weekStart: weekStartDate,
        instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: 'morning',
        responses: fullResponses(),
      },
    });

    // State (iii) member — questionnaire + a generated calendar (disclosure NOT
    // yet shown → first /calendrier view will stamp it).
    await db.weeklyScheduleQuestionnaire.create({
      data: {
        userId: memberCal.id,
        weekStart: weekStartDate,
        instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: 'morning',
        responses: fullResponses(),
      },
    });
    await db.adaptiveCalendar.create({
      data: {
        userId: memberCal.id,
        weekStart: weekStartDate,
        schedule: buildSchedule(monday),
        primaryCategory: 'live_trading',
        claudeModel: 'claude-code-local',
        inputTokens: 0,
        outputTokens: 0,
        costEur: '0.000000',
        calendarInstrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
        // aiDisclosureShownAt left null on purpose.
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    memberNoQ = memberQOnly = memberCal = admin = null;
  });

  test('anon is bounced to /login on /calendrier', async ({ page }) => {
    await page.goto('/calendrier');
    await expect(page).toHaveURL(/\/login/);
  });

  test('RENDER (i): a member with no questionnaire sees the CTA', async ({ page, request }) => {
    if (!memberNoQ) throw new Error('seed missing');
    await page.goto('/login');
    await loginAs(page, request, memberNoQ.email, memberNoQ.password);

    await page.goto('/calendrier');
    await expect(page).toHaveURL(/\/calendrier/);
    await expect(page.locator('[data-state="no-questionnaire"]')).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER (ii): questionnaire but no calendar shows the calm "se prépare"', async ({
    page,
    request,
  }) => {
    if (!memberQOnly) throw new Error('seed missing');
    await page.goto('/login');
    await loginAs(page, request, memberQOnly.email, memberQOnly.password);

    await page.goto('/calendrier');
    await expect(page).toHaveURL(/\/calendrier/);
    await expect(page.locator('[data-state="preparing"]')).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('RENDER (iii) + DISCLOSURE: generated calendar shows the week-view + stamps the banner', async ({
    page,
    request,
  }) => {
    if (!memberCal) throw new Error('seed missing');
    await page.goto('/login');
    await loginAs(page, request, memberCal.email, memberCal.password);

    await page.goto('/calendrier');
    await expect(page).toHaveURL(/\/calendrier/);
    await expect(page.locator('[data-slot="calendar-week-view"]')).toBeVisible();
    await expect(page.locator('[data-slot="calendar-overview"]')).toBeVisible();
    // EU AI Act 50(1) banner BEFORE the blocks.
    await expect(
      page.getByRole('note', { name: 'Avis sur le contenu généré par IA' }),
    ).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);

    // First view stamped the disclosure + emitted the PII-free audit.
    const monday = currentParisWeekMonday();
    const row = await db.adaptiveCalendar.findUnique({
      where: { userId_weekStart: { userId: memberCal.id, weekStart: parseLocalDate(monday) } },
      select: { aiDisclosureShownAt: true },
    });
    expect(row?.aiDisclosureShownAt).not.toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { userId: memberCal.id, action: 'calendar.disclosure.shown' },
    });
    expect(audit).not.toBeNull();
  });

  test('ADMIN: ?tab=calendar renders the read-only calendar panel', async ({ page, request }) => {
    if (!admin || !memberCal) throw new Error('seed missing');
    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto(`/admin/members/${memberCal.id}?tab=calendar`);
    await expect(page).toHaveURL(/tab=calendar/);
    await expect(page.locator('[data-slot="member-calendar-panel"]')).toBeVisible();
    await expect(page.locator('[data-slot="calendar-week-view"]')).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
