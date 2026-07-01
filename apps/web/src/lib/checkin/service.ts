import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { CheckinSlot } from '@/generated/prisma/enums';
import type { DailyCheckinModel } from '@/generated/prisma/models/DailyCheckin';

import { db } from '@/lib/db';
import type { EveningCheckinInput, MorningCheckinInput } from '@/lib/schemas/checkin';

import { computeStreak, type CheckinDay } from './streak';
import { localDateOf, parseLocalDate, shiftLocalDate, type LocalDateString } from './timezone';
import { buildYearHeatmap, type HeatLevel, type YearHeatmap } from './year-heatmap';

/**
 * Domain error: the submitted check-in date is outside the allowed window
 * for the user's local timezone. The Zod schema does a UTC-based first
 * pass; this is the TZ-aware second pass (J5 audit Security MEDIUM M2).
 */
export class CheckinDateOutOfWindowError extends Error {
  constructor(
    public readonly submitted: LocalDateString,
    public readonly today: LocalDateString,
  ) {
    super(`Check-in date ${submitted} outside the window around ${today}.`);
    this.name = 'CheckinDateOutOfWindowError';
  }
}

/**
 * Domain error (F7): a check-in filled for a PAST local day (a "rattrapage")
 * without the required free-text justification (brief §F7 "avec justification
 * si exceptionnel"). TZ-aware second pass, same as
 * {@link assertCheckinDateInLocalWindow} — the Server Action maps this to an
 * inline field error on `lateJustification`.
 */
export class CheckinBackfillJustificationRequiredError extends Error {
  constructor(
    public readonly submitted: LocalDateString,
    public readonly today: LocalDateString,
  ) {
    super(`Late check-in for ${submitted} (today ${today}) requires a justification.`);
    this.name = 'CheckinBackfillJustificationRequiredError';
  }
}

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
  marketAnalysisDone: boolean | null;
  meditationMin: number | null;
  sportType: string | null;
  sportDurationMin: number | null;
  intention: string | null;

  planRespectedToday: boolean | null;
  hedgeRespectedToday: boolean | null;
  /** #13 — evening: did the member keep this morning's intention? Tri-state. */
  intentionKept: boolean | null;
  /** SPEC §28/§22 — evening "bilan": did the member study the course today? */
  formationFollowed: boolean | null;
  caffeineMl: number | null;
  waterLiters: string | null;
  stressScore: number | null;
  gratitudeItems: string[];

  moodScore: number | null;
  emotionTags: string[];
  journalNote: string | null;

  /** F7 — rattrapage reason when filled for a past local day; null on-time. */
  lateJustification: string | null;
  /** F7 — ISO instant of a late (past-day) fill; null when filled on its day. */
  backfilledAt: string | null;

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
    marketAnalysisDone: row.marketAnalysisDone,
    meditationMin: row.meditationMin,
    sportType: row.sportType,
    sportDurationMin: row.sportDurationMin,
    intention: row.intention,
    planRespectedToday: row.planRespectedToday,
    hedgeRespectedToday: row.hedgeRespectedToday,
    intentionKept: row.intentionKept,
    formationFollowed: row.formationFollowed,
    caffeineMl: row.caffeineMl,
    waterLiters: row.waterLiters == null ? null : row.waterLiters.toString(),
    stressScore: row.stressScore,
    gratitudeItems: [...row.gratitudeItems],
    moodScore: row.moodScore,
    emotionTags: [...row.emotionTags],
    journalNote: row.journalNote,
    lateJustification: row.lateJustification,
    backfilledAt: row.backfilledAt == null ? null : row.backfilledAt.toISOString(),
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resolve "today" in the user's local TZ (defaults Europe/Paris per schema). */
export function todayFor(timezone: string, now: Date = new Date()): LocalDateString {
  return localDateOf(now, timezone);
}

/**
 * TZ-aware bound on the submitted check-in date (J5 audit Security M2 fix).
 *
 * The Zod schema bounds the date with TODAY+1 *UTC* — works for V1 single-TZ
 * Europe/Paris but lets a user in Auckland (UTC+13) submit a check-in for
 * "tomorrow local" while the server still thinks it's today, polluting the
 * streak counter. The service performs a second pass keyed on the user's TZ
 * (sourced from `User.timezone`) and throws if the submitted date is more
 * than one local-day ahead of `today_local`.
 *
 * Past dates are bounded by Zod (60-day backfill) — we don't re-check here.
 */
export function assertCheckinDateInLocalWindow(
  submitted: LocalDateString,
  timezone: string,
  now: Date = new Date(),
): void {
  const today = todayFor(timezone, now);
  // Allow today + 1 (covers DST drift and a user who anticipates by a few
  // hours into "tomorrow"). Past dates are already bounded by Zod.
  const upper = shiftLocalDate(today, 1);
  if (submitted > upper) {
    throw new CheckinDateOutOfWindowError(submitted, today);
  }
}

/**
 * F7 — a check-in is a "rattrapage" (backfill) when its date is strictly before
 * the member's local today. Uses the same TZ source as
 * {@link assertCheckinDateInLocalWindow}. Pure — a same-day (or the tolerated
 * today+1 drift) fill is never a backfill, so no justification is asked.
 */
export function isBackfillCheckin(
  submitted: LocalDateString,
  timezone: string,
  now: Date = new Date(),
): boolean {
  return submitted < todayFor(timezone, now);
}

/**
 * F7 — enforce the rattrapage rule: a PAST-day fill MUST carry a non-empty
 * justification. Returns the resolved backfill flag so the submit path can
 * stamp `backfilledAt` / persist the reason without recomputing it. Throws
 * {@link CheckinBackfillJustificationRequiredError} when the reason is missing.
 */
function resolveBackfill(
  date: LocalDateString,
  justification: string | null,
  timezone: string,
  now: Date | undefined,
): boolean {
  const backfill = isBackfillCheckin(date, timezone, now);
  if (backfill && (justification == null || justification.trim() === '')) {
    throw new CheckinBackfillJustificationRequiredError(date, todayFor(timezone, now));
  }
  return backfill;
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
  options: { timezone?: string; now?: Date } = {},
): Promise<SerializedCheckin> {
  // Audit J5 M2 — TZ-aware second pass. Defaults to Europe/Paris (V1 reality);
  // when J5.5 propagates per-user TZ, the Server Action will pass it explicitly.
  const timezone = options.timezone ?? 'Europe/Paris';
  assertCheckinDateInLocalWindow(input.date, timezone, options.now);
  // F7 — a past-day fill is a rattrapage: require + persist the justification.
  const backfill = resolveBackfill(input.date, input.lateJustification, timezone, options.now);
  const date = parseLocalDate(input.date);
  const updateData = {
    sleepHours: new Prisma.Decimal(input.sleepHours),
    sleepQuality: input.sleepQuality,
    morningRoutineCompleted: input.morningRoutineCompleted,
    marketAnalysisDone: input.marketAnalysisDone,
    meditationMin: input.meditationMin,
    sportType: input.sportType,
    sportDurationMin: input.sportDurationMin,
    intention: input.intention,
    moodScore: input.moodScore,
    emotionTags: input.emotionTags,
    // F7 — persist the reason + stamp only on a real backfill; a same-day (or
    // tolerated today+1) fill clears both so an edit can't leave a stale stamp.
    lateJustification: backfill ? input.lateJustification : null,
    backfilledAt: backfill ? new Date() : null,
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
  options: { timezone?: string; now?: Date } = {},
): Promise<SerializedCheckin> {
  const timezone = options.timezone ?? 'Europe/Paris';
  assertCheckinDateInLocalWindow(input.date, timezone, options.now);
  // F7 — a past-day fill is a rattrapage: require + persist the justification.
  const backfill = resolveBackfill(input.date, input.lateJustification, timezone, options.now);
  const date = parseLocalDate(input.date);
  const updateData = {
    planRespectedToday: input.planRespectedToday,
    hedgeRespectedToday: input.hedgeRespectedToday,
    intentionKept: input.intentionKept,
    formationFollowed: input.formationFollowed,
    caffeineMl: input.caffeineMl,
    waterLiters: input.waterLiters == null ? null : new Prisma.Decimal(input.waterLiters),
    stressScore: input.stressScore,
    moodScore: input.moodScore,
    emotionTags: input.emotionTags,
    journalNote: input.journalNote,
    gratitudeItems: input.gratitudeItems,
    // F7 — persist the reason + stamp only on a real backfill (see morning).
    lateJustification: backfill ? input.lateJustification : null,
    backfilledAt: backfill ? new Date() : null,
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

/**
 * List a member's recent check-ins for the admin supervision panel (S7
 * §22-23 « TOUT tracker pour l'admin »). Read-only, newest day first, both
 * slots (morning before evening within a day — enum order). The caller MUST
 * gate the admin role; this function is userId-scoped only (no auth inside),
 * same contract as the other admin read services.
 *
 * Capped by DAYS, not raw rows: a raw-row cap could return a day's morning but
 * drop its evening (the next row), making the panel render a false « Soir : non
 * rempli » on the oldest visible day. We take the most recent `days` distinct
 * dates, then every slot for those dates — admin-only, 30-member scale, not a
 * hot path.
 *
 * SPEC §2 posture: check-ins carry NO market content (intention is a one-line
 * mindset note, `marketAnalysisDone`/`planRespectedToday`/`formationFollowed`
 * are declarative discipline booleans — the act, never the content).
 */
export async function listMemberCheckinsAsAdmin(
  memberId: string,
  days = 30,
): Promise<SerializedCheckin[]> {
  const recentDates = await db.dailyCheckin.findMany({
    where: { userId: memberId },
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
    take: days,
  });
  const cutoff = recentDates.at(-1)?.date;
  if (!cutoff) return [];

  const rows = await db.dailyCheckin.findMany({
    where: { userId: memberId, date: { gte: cutoff } },
    orderBy: [{ date: 'desc' }, { slot: 'asc' }],
  });
  return rows.map(toSerialized);
}

/**
 * F7 — a member's OWN check-in history for the `/checkin/history` tracking page
 * (« page regroupant TOUS les check-in/out »). Same userId-scoped read as the
 * admin panel — the page gates the member via `auth()` — but a distinct name so
 * a member surface never imports an `AsAdmin` function (semantic honesty).
 *
 * Windowed to a year of distinct days: paired with the year heatmap above the
 * list, this surfaces effectively all of a member's tracking (30-member scale,
 * ≤2 rows/day) while staying bounded — never an unbounded query.
 */
export async function listMemberCheckins(userId: string, days = 365): Promise<SerializedCheckin[]> {
  return listMemberCheckinsAsAdmin(userId, days);
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

/**
 * Lifetime count of check-in rows for a member (any slot, any day).
 *
 * Used by the celebration surface (S9.1) to detect the member's *very first*
 * check-in (count === 1 right after their first submit) so we can show a calm,
 * one-time "you posted your routine" moment — never a recurring fanfare. Cheap
 * single indexed COUNT (`userId`).
 */
export async function countCheckins(userId: string): Promise<number> {
  return db.dailyCheckin.count({ where: { userId } });
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

/**
 * Year "régularité" heatmap (S11) — daily check-in activity over the last 53
 * weeks, GitHub-contributions style. Level = number of slots filed that day
 * (0/1/2). Anti-Black-Hat (§31.2): a calm mirror of constancy, empty days muted
 * never red. One windowed query (380 days), then the pure grid builder.
 */
export async function getDisciplineYearHeatmap(
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<YearHeatmap> {
  const today = todayFor(timezone, now);
  const days = await listRecentCheckinDays(userId, today, 380);
  const levelByDate = new Map<LocalDateString, HeatLevel>();
  for (const d of days) {
    const level = Math.min(d.slots.length, 2) as HeatLevel;
    if (level > 0) levelByDate.set(d.date, level);
  }
  return buildYearHeatmap(levelByDate, today);
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

/**
 * Last-7-days check-in summary for the dashboard sparkline + sleep-zones
 * diagram (J5 audit UI N2 polish).
 *
 * One value per local-day (matching `today`). Missing days are returned as
 * `null` so the consumer can render gaps explicitly. Sleep hours are
 * Number'd (Decimal → number, lossy past 15 sig figs but irrelevant for a
 * 0–24 range with 0.5 granularity). Mood is averaged across morning + evening
 * if both slots are present; null otherwise.
 *
 * Read-side: 1 indexed query (`(userId, date DESC)`), bounded by 14 rows
 * (7 days × 2 slots). Cheap.
 */
export interface DayPoint {
  date: LocalDateString;
  /** Hours of sleep last night (morning slot). Null if no morning checkin. */
  sleepHours: number | null;
  /** Average mood across slots filed that day (null if no slot filled). */
  moodScore: number | null;
  /** Stress score (evening slot). Null if no evening checkin. */
  stressScore: number | null;
  /** True if at least one slot was filled (morning OR evening). */
  filled: boolean;
}

export async function getLast7Days(
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<DayPoint[]> {
  const today = todayFor(timezone, now);
  const startDate = parseLocalDate(today);
  startDate.setUTCDate(startDate.getUTCDate() - 6);

  const rows = await db.dailyCheckin.findMany({
    where: { userId, date: { gte: startDate } },
    select: {
      date: true,
      slot: true,
      sleepHours: true,
      moodScore: true,
      stressScore: true,
    },
    orderBy: { date: 'desc' },
  });

  // Bucket by date.
  const byDate = new Map<LocalDateString, typeof rows>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    const list = byDate.get(key) ?? [];
    list.push(r);
    byDate.set(key, list);
  }

  // Build the 7-day window in chronological order (oldest → newest), so
  // the sparkline reads left-to-right.
  const out: DayPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const cursor = new Date(startDate);
    cursor.setUTCDate(cursor.getUTCDate() + (6 - i));
    const dateKey = cursor.toISOString().slice(0, 10);
    const dayRows = byDate.get(dateKey) ?? [];

    const morning = dayRows.find((r) => r.slot === 'morning');
    const evening = dayRows.find((r) => r.slot === 'evening');

    const moods: number[] = [];
    if (morning?.moodScore != null) moods.push(morning.moodScore);
    if (evening?.moodScore != null) moods.push(evening.moodScore);
    const moodAvg = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;

    out.push({
      date: dateKey,
      sleepHours: morning?.sleepHours ? Number(morning.sleepHours.toString()) : null,
      moodScore: moodAvg,
      stressScore: evening?.stressScore ?? null,
      filled: dayRows.length > 0,
    });
  }
  return out;
}
