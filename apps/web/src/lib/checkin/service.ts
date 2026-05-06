import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { CheckinSlot } from '@/generated/prisma/enums';
import type { DailyCheckinModel } from '@/generated/prisma/models/DailyCheckin';

import { db } from '@/lib/db';
import type { EveningCheckinInput, MorningCheckinInput } from '@/lib/schemas/checkin';

import { computeStreak, type CheckinDay } from './streak';
import { localDateOf, parseLocalDate, type LocalDateString } from './timezone';

/**
 * Daily check-in service layer (J5, SPEC §6.4 + §7.4).
 *
 * All exported functions are user-scoped: they take a `userId` and never
 * touch another member's rows. Defence-in-depth on top of the proxy + the
 * Server Action's `auth()` re-check.
 *
 * The DB column for `date` is Postgres `DATE` (no time). We always pass /
 * read it as the user's local-day, anchored to the User.timezone field. The
 * Server Action computes "today" upstream and feeds it here.
 */

// ----- Public API types -------------------------------------------------------

/**
 * JSON-safe view of a `DailyCheckin` for client components and the dashboard.
 * Prisma `Decimal` → `string`, `Date`/`@db.Date` → `YYYY-MM-DD`.
 */
export interface SerializedCheckin {
  id: string;
  userId: string;
  date: LocalDateString;
  slot: CheckinSlot;

  sleepHours: string | null;
  sleepQuality: number | null;
  morningRoutineCompleted: boolean | null;
  meditationMin: number | null;
  sportType: string | null;
  sportDurationMin: number | null;
  intention: string | null;

  planRespectedToday: boolean | null;
  hedgeRespectedToday: boolean | null;
  caffeineMl: number | null;
  waterLiters: string | null;
  stressScore: number | null;
  gratitudeItems: string[];

  moodScore: number | null;
  emotionTags: string[];
  journalNote: string | null;

  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodayCheckinStatus {
  /** The user's local-day used to compute this status. */
  today: LocalDateString;
  morningSubmitted: boolean;
  eveningSubmitted: boolean;
}

export interface CheckinStreakSummary {
  current: number;
  /** True iff a check-in has been filed for today (any slot). */
  todayFilled: boolean;
  /** The user's local-day used to compute the streak. */
  today: LocalDateString;
}

// ----- Helpers ----------------------------------------------------------------

function toSerialized(row: DailyCheckinModel): SerializedCheckin {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString().slice(0, 10),
    slot: row.slot,
    sleepHours: row.sleepHours == null ? null : row.sleepHours.toString(),
    sleepQuality: row.sleepQuality,
    morningRoutineCompleted: row.morningRoutineCompleted,
    meditationMin: row.meditationMin,
    sportType: row.sportType,
    sportDurationMin: row.sportDurationMin,
    intention: row.intention,
    planRespectedToday: row.planRespectedToday,
    hedgeRespectedToday: row.hedgeRespectedToday,
    caffeineMl: row.caffeineMl,
    waterLiters: row.waterLiters == null ? null : row.waterLiters.toString(),
    stressScore: row.stressScore,
    gratitudeItems: [...row.gratitudeItems],
    moodScore: row.moodScore,
    emotionTags: [...row.emotionTags],
    journalNote: row.journalNote,
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resolve "today" in the user's local TZ (defaults Europe/Paris per schema). */
export function todayFor(timezone: string, now: Date = new Date()): LocalDateString {
  return localDateOf(now, timezone);
}

// ----- Submit (upsert) --------------------------------------------------------

/**
 * Idempotent insert/update keyed by (userId, date, slot). A user filling the
 * morning twice updates the existing row — we don't stack duplicates.
 *
 * Returns the row in `SerializedCheckin` form so callers can pass it straight
 * to a client component.
 */
export async function submitMorningCheckin(
  userId: string,
  input: MorningCheckinInput,
): Promise<SerializedCheckin> {
  const date = parseLocalDate(input.date);
  const updateData = {
    sleepHours: new Prisma.Decimal(input.sleepHours),
    sleepQuality: input.sleepQuality,
    morningRoutineCompleted: input.morningRoutineCompleted,
    meditationMin: input.meditationMin,
    sportType: input.sportType,
    sportDurationMin: input.sportDurationMin,
    intention: input.intention ?? null,
    moodScore: input.moodScore,
    emotionTags: input.emotionTags,
    submittedAt: new Date(),
  };

  const row = await db.dailyCheckin.upsert({
    where: { userId_date_slot: { userId, date, slot: 'morning' } },
    create: {
      userId,
      date,
      slot: 'morning',
      ...updateData,
    },
    update: updateData,
  });

  return toSerialized(row);
}

export async function submitEveningCheckin(
  userId: string,
  input: EveningCheckinInput,
): Promise<SerializedCheckin> {
  const date = parseLocalDate(input.date);
  const updateData = {
    planRespectedToday: input.planRespectedToday,
    hedgeRespectedToday: input.hedgeRespectedToday,
    caffeineMl: input.caffeineMl,
    waterLiters: input.waterLiters == null ? null : new Prisma.Decimal(input.waterLiters),
    stressScore: input.stressScore,
    moodScore: input.moodScore,
    emotionTags: input.emotionTags,
    journalNote: input.journalNote ?? null,
    gratitudeItems: input.gratitudeItems,
    submittedAt: new Date(),
  };

  const row = await db.dailyCheckin.upsert({
    where: { userId_date_slot: { userId, date, slot: 'evening' } },
    create: {
      userId,
      date,
      slot: 'evening',
      ...updateData,
    },
    update: updateData,
  });

  return toSerialized(row);
}

// ----- Reads ------------------------------------------------------------------

/**
 * Returns the (date, slots) tuples for the user's last `windowDays` (default
 * 60). Used by the streak walker and the dashboard sparkline (J6).
 */
export async function listRecentCheckinDays(
  userId: string,
  today: LocalDateString,
  windowDays = 60,
): Promise<CheckinDay[]> {
  const lower = parseLocalDate(today);
  lower.setUTCDate(lower.getUTCDate() - (windowDays - 1));

  const rows = await db.dailyCheckin.findMany({
    where: { userId, date: { gte: lower } },
    select: { date: true, slot: true },
    orderBy: { date: 'desc' },
  });

  // Collapse to one entry per date — service consumer (`computeStreak`)
  // accepts duplicates but it's cheaper to merge here.
  const byDate = new Map<LocalDateString, Set<'morning' | 'evening'>>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    let set = byDate.get(key);
    if (!set) {
      set = new Set();
      byDate.set(key, set);
    }
    set.add(r.slot);
  }
  return Array.from(byDate.entries())
    .map(([date, slots]) => ({ date, slots: Array.from(slots) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getCheckinStatus(
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<TodayCheckinStatus> {
  const today = todayFor(timezone, now);
  const rows = await db.dailyCheckin.findMany({
    where: { userId, date: parseLocalDate(today) },
    select: { slot: true },
  });
  const slots = new Set(rows.map((r) => r.slot));
  return {
    today,
    morningSubmitted: slots.has('morning'),
    eveningSubmitted: slots.has('evening'),
  };
}

export async function getStreak(
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<CheckinStreakSummary> {
  const today = todayFor(timezone, now);
  const days = await listRecentCheckinDays(userId, today, 60);
  const current = computeStreak(days, today);
  const todayFilled = days.some((d) => d.date === today && d.slots.length > 0);
  return { current, todayFilled, today };
}

export async function getCheckin(
  userId: string,
  date: LocalDateString,
  slot: CheckinSlot,
): Promise<SerializedCheckin | null> {
  const row = await db.dailyCheckin.findUnique({
    where: { userId_date_slot: { userId, date: parseLocalDate(date), slot } },
  });
  return row ? toSerialized(row) : null;
}
