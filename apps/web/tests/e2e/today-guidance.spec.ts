/**
 * Session 5 — Guidage quotidien « Ton aujourd'hui » E2E (DoD §30 #3, the
 * RUNTIME proof). Seeds a member with a generated calendar whose TODAY block
 * carries a unique marker, logs in, and asserts that `/dashboard` mounts the
 * `[data-slot="today-guidance"]` panel showing TODAY's block + the slot-due
 * check-in action — proving "le guidage affiche les bonnes actions au bon
 * moment" against a real Postgres + Chromium (not a mock).
 *
 * Mirrors `calendar-display.spec.ts` (seed via `@/lib/db` + pure helpers, NEVER
 * a `'server-only'` import — scar GG-CI). Determinism (canon J-C3): no
 * `networkidle`; `goto` awaits `load`, assertions auto-wait. Skips cleanly if
 * Chromium is not installed.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { Prisma } from '@/generated/prisma/client';
import { CURRENT_CALENDAR_INSTRUMENT_VERSION } from '@/lib/calendar/instrument-v1';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const PARIS_TZ = 'Europe/Paris';
const GUIDE_EMAIL = 'today-guidance.member.e2e.test@fxmily.local';
const NOCAL_EMAIL = 'today-guidance-nocal.member.e2e.test@fxmily.local';
const PWD = 'TodayGuidance-Pwd-2026!';
const TODAY_MARKER = 'Bloc-du-jour-E2E-2026';

let member: SeededUser | null = null;
let memberNoCal: SeededUser | null = null;

function currentParisWeekMonday(): string {
  const todayParis = localDateOf(new Date(), PARIS_TZ);
  const probe = parseLocalDate(todayParis);
  const sinceMonday = (probe.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return shiftLocalDate(todayParis, -sinceMonday);
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

function fullDay(morning: boolean, afternoon: boolean, evening: boolean) {
  return { morning, afternoon, evening };
}

function fullResponses() {
  return {
    profile: 'etudiant',
    sessionGoal: 3,
    weekdayAvailability: {
      monday: fullDay(true, false, true),
      tuesday: fullDay(true, false, true),
      wednesday: fullDay(true, false, true),
      thursday: fullDay(true, false, true),
      friday: fullDay(true, false, true),
    },
    weekendAvailability: {
      saturday: fullDay(false, false, false),
      sunday: fullDay(false, false, false),
    },
    sleep: 'standard',
    energyPeak: 'morning',
    meetingCommitment: 'occasional',
    practiceFocus: 'balanced',
    constraint: 'none',
  } as const;
}

/**
 * 7-day plan from `weekStart`; the day matching `today` gets an extra block with
 * the unique `TODAY_MARKER` label so the assertion proves TODAY-extraction (not
 * just "some calendar rendered").
 */
function buildScheduleWithTodayMarker(weekStart: string, today: string) {
  const days = DAY_NAMES.map((dayLabel, i) => {
    const date = shiftLocalDate(weekStart, i);
    const blocks: Array<Record<string, unknown>> = [
      {
        slot: 'morning',
        category: 'live_trading',
        durationMin: 90,
        label: 'Session de Londres',
        priority: 'high',
      },
    ];
    if (date === today) {
      blocks.push({
        slot: 'evening',
        category: 'mark_douglas_review',
        durationMin: 30,
        label: TODAY_MARKER,
        priority: 'medium',
      });
    }
    return { date, dayLabel, blocks };
  });
  return {
    weekStart,
    overview:
      "Une semaine équilibrée entre sessions le matin et travail de fond le soir, en respectant ta disponibilité déclarée d'étudiant et ton pic d'énergie matinal.",
    days,
    weeklyFocus:
      'Accepte que chaque trade soit une probabilité, pas une certitude — ton edge se joue sur la série.',
    warnings: [],
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

test.describe('Session 5 — Ton aujourd’hui (guidage quotidien) on /dashboard', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();

    [member, memberNoCal] = await Promise.all([
      seedMemberUser({ email: GUIDE_EMAIL, password: PWD, firstName: 'Guide', lastName: 'Member' }),
      seedMemberUser({
        email: NOCAL_EMAIL,
        password: PWD,
        firstName: 'NoCal',
        lastName: 'Member',
      }),
    ]);

    const monday = currentParisWeekMonday();
    const today = localDateOf(new Date(), PARIS_TZ);
    const weekStartDate = parseLocalDate(monday);

    await db.weeklyScheduleQuestionnaire.create({
      data: {
        userId: member.id,
        weekStart: weekStartDate,
        instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: 'morning',
        responses: fullResponses(),
      },
    });
    await db.adaptiveCalendar.create({
      data: {
        userId: member.id,
        weekStart: weekStartDate,
        schedule: buildScheduleWithTodayMarker(monday, today) as unknown as Prisma.InputJsonValue,
        primaryCategory: 'live_trading',
        claudeModel: 'claude-code-local',
        inputTokens: 0,
        outputTokens: 0,
        costEur: '0.000000',
        calendarInstrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
      },
    });

    // §30 meeting today (platform-wide, admin-generated) so the panel's
    // "réunion aujourd'hui" row renders at runtime. 10:00 UTC = 12:00 Paris (CEST).
    // createMany + skipDuplicates: beforeAll runs once per Playwright project
    // (chromium + mobile) against the SAME DB, and a meeting is platform-wide (no
    // userId → NOT removed by cleanupTestUsers), so a plain create would hit the
    // @@unique([date, slot]) on the 2nd project. Idempotent here = CI-safe.
    await db.meeting.createMany({
      data: [
        {
          date: parseLocalDate(today),
          slot: 'midday',
          scheduledAt: new Date(`${today}T10:00:00.000Z`),
        },
      ],
      skipDuplicates: true,
    });
  });

  test.afterAll(async () => {
    // The platform-wide meeting isn't tied to a test user — clean it explicitly
    // so it can't leak into other specs querying meetings on the same DB.
    await db.meeting.deleteMany({
      where: { date: parseLocalDate(localDateOf(new Date(), PARIS_TZ)), slot: 'midday' },
    });
    await cleanupTestUsers();
    member = memberNoCal = null;
  });

  test('panel shows TODAY’s block + a check-in action (calendar generated)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    const panel = page.locator('[data-slot="today-guidance"]');
    await expect(panel).toBeVisible();

    // TODAY-extraction proof: the unique marker block is surfaced in the panel.
    await expect(panel.getByText(TODAY_MARKER)).toBeVisible();
    // "Ton plan du jour" sub-header present (today has blocks).
    await expect(panel.getByText('Ton plan du jour')).toBeVisible();
    // EU AI Act 50(1): `block.label` is AI prose, so the disclosure banner MUST
    // render with the blocks — same as the twin `/calendrier` surface.
    await expect(
      panel.getByRole('note', { name: 'Avis sur le contenu généré par IA' }),
    ).toBeVisible();
    await expect(panel.getByRole('link', { name: /En savoir plus/ })).toHaveAttribute(
      'href',
      '/legal/ai-disclosure',
    );
    // A time-aware check-in action is rendered inside the panel.
    await expect(
      panel.locator('[data-slot="guidance-action"][data-kind="checkin"]').first(),
    ).toBeVisible();
    // Meeting-today row (§30, platform-wide) renders at runtime.
    await expect(panel.locator('[data-slot="guidance-action"][data-kind="meeting"]')).toBeVisible();
    // Weekly mindset QCM row renders (this member has no mindset check this week).
    await expect(panel.locator('[data-slot="guidance-action"][data-kind="mindset"]')).toBeVisible();

    // No Next.js runtime error overlay + no console errors (frontend gate).
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('panel shows the calm "not organised yet" state when the week has no calendar', async ({
    page,
    request,
  }) => {
    if (!memberNoCal) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, memberNoCal.email, memberNoCal.password);

    await page.goto('/dashboard');
    const panel = page.locator('[data-slot="today-guidance"]');
    await expect(panel).toBeVisible();
    // No calendar yet → the calm "pas encore organisée" framing (the questionnaire
    // CTA lives in CalendarStatusWidget below, not duplicated in the panel).
    await expect(panel.getByText(/pas encore organis/i)).toBeVisible();
    // No AI prose is shown in this state, so the disclosure banner must be ABSENT
    // (it gates strictly on the AI `block.label` list, never on the calm framing).
    await expect(
      panel.getByRole('note', { name: 'Avis sur le contenu généré par IA' }),
    ).toHaveCount(0);
  });
});
