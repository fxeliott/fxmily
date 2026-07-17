import 'server-only';

import { cache } from 'react';

import { Prisma } from '@/generated/prisma/client';
import type { CheckinSlot } from '@/generated/prisma/enums';
import type { DailyCheckinModel } from '@/generated/prisma/models/DailyCheckin';

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { projectHabitLogFromCheckin } from '@/lib/habit/service';
import { reportWarning } from '@/lib/observability';
import {
  MAX_BACKFILL_SUGGESTIONS,
  PAST_HORIZON_DAYS,
  type EveningCheckinInput,
  type MorningCheckinInput,
} from '@/lib/schemas/checkin';
import { isHabitDateWithinLocalWindow } from '@/lib/schemas/habit-log';

import { mapCheckinToHabitLogs } from './habit-projection';
import { getOffDaySet, isOffDay } from './off-days';
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
 * F7 — validate a `?date=YYYY-MM-DD` param (from the hub's « Rattraper hier »
 * cue) into a usable backfill day, or `null`. Pure — no DB, never throws: a
 * malformed, future, today, or out-of-window value silently degrades to the
 * normal on-time flow. The submit path stays the authority (Zod window +
 * {@link resolveBackfill}); this only decides whether the slot page opens in
 * rattrapage mode, and refuses to offer a day the submit would then reject.
 */
export function resolveBackfillDateParam(
  rawDate: string | undefined,
  timezone: string,
  now: Date = new Date(),
): LocalDateString | null {
  if (!rawDate) return null;
  // Strict calendar-valid parse (rejects malformed strings + e.g. month 13).
  try {
    parseLocalDate(rawDate);
  } catch {
    return null;
  }
  // A same-day (or future) fill is the normal flow, never a rattrapage.
  if (!isBackfillCheckin(rawDate, timezone, now)) return null;
  // Bounded to the backfill horizon — mirrors the Zod `dateInWindow` lower bound.
  const lower = shiftLocalDate(todayFor(timezone, now), -PAST_HORIZON_DAYS);
  if (rawDate < lower) return null;
  return rawDate;
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

  // Option A — write-through : projette les piliers sommeil / méditation / sport
  // du check-in matin dans TRACK (HabitLog) pour que le membre ne les saisisse
  // qu'UNE fois. Provenance-aware (projectHabitLogFromCheckin rafraîchit SA
  // propre projection sur édition mais n'écrase JAMAIS une saisie membre TRACK),
  // best-effort (un échec côté habit ne doit jamais casser le
  // check-in), et borné à la fenêtre civile HabitLog [-14j, +1j] — plus étroite
  // que le backfill 60 jours du check-in : un check-in rétro-rempli au-delà de 14
  // jours saute la projection au lieu de lever. Idempotent + race-safe par
  // construction (@@unique(userId, date, kind) + create + catch P2002).
  const now = options.now ?? new Date();
  // Best-effort STRUCTUREL : tout le bloc de projection est isolé dans un
  // try/catch externe pour que même un throw hors de la boucle interne
  // (isHabitDateWithinLocalWindow / mapCheckinToHabitLogs — aujourd'hui
  // non-throwants) ne puisse jamais faire échouer la soumission du check-in.
  // Le try/catch interne conserve l'isolation par-pilier : une projection
  // ratée n'interrompt pas les suivantes.
  try {
    if (isHabitDateWithinLocalWindow(input.date, now, timezone)) {
      for (const habitLog of mapCheckinToHabitLogs(input)) {
        try {
          const { outcome } = await projectHabitLogFromCheckin(userId, habitLog);
          // Audit every actual write (created OR refreshed). A skipped
          // member-owned slot is a no-op, nothing to record; `wasNew`
          // distinguishes a fresh projection from an in-place refresh.
          if (outcome !== 'skipped') {
            await logAudit({
              action: 'habit_log.upserted',
              userId,
              metadata: {
                kind: habitLog.kind,
                date: input.date,
                source: 'checkin_morning',
                wasNew: outcome === 'created',
              },
            });
          }
        } catch {
          // Best-effort : un échec de projection ne doit jamais faire échouer la
          // soumission du check-in. On le remonte en warning (pas error) pour
          // qu'une panne durable du write-through reste visible sans page-out.
          reportWarning('checkin.habit_projection', 'write_through_failed', {
            kind: habitLog.kind,
          });
        }
      }
    }
  } catch {
    // Filet externe : couvre un throw inattendu du gate de fenêtre ou du mapper.
    // Garantit que la promesse "1 saisie" ne peut jamais casser le check-in.
    reportWarning('checkin.habit_projection', 'write_through_failed', {
      kind: 'projection',
    });
  }

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

/** F7 — yesterday's per-slot gap, for the hub's calm « Rattraper hier » cue. */
export interface YesterdayBackfill {
  /** Yesterday's local date (YYYY-MM-DD) — the value to pass as `?date=`. */
  date: LocalDateString;
  morningMissing: boolean;
  eveningMissing: boolean;
}

/**
 * F7 — yesterday's per-slot fill state, so the hub can gently offer to catch up
 * a missed slot « le lendemain avec justification » (brief §F7). Returns `null`
 * when yesterday is fully covered (no cue, no pressure — anti-Black-Hat §31.2).
 * One indexed query on `(userId, date)`. TZ-aware (yesterday = local today − 1).
 */
export async function getYesterdayBackfill(
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<YesterdayBackfill | null> {
  const yesterday = shiftLocalDate(todayFor(timezone, now), -1);
  // Tour 14 — never offer to "rattraper hier" when yesterday was an off day:
  // the member took the day off, there is nothing to catch up (no pressure,
  // §31.2). Checked first so no cue is built for a neutral day.
  const offCtx = await getOffDaySet(userId, yesterday, yesterday);
  if (isOffDay(yesterday, offCtx)) return null;
  const rows = await db.dailyCheckin.findMany({
    where: { userId, date: parseLocalDate(yesterday) },
    select: { slot: true },
  });
  const slots = new Set(rows.map((r) => r.slot));
  const morningMissing = !slots.has('morning');
  const eveningMissing = !slots.has('evening');
  if (!morningMissing && !eveningMissing) return null;
  return { date: yesterday, morningMissing, eveningMissing };
}

/**
 * Tour 15 — one recent expected (non-off) day the member never fully filled, so
 * the hub's multi-day rattrapage cue can list it as a clickable catch-up row.
 * A day appears iff at least ONE slot is missing (mirrors {@link YesterdayBackfill}).
 */
export interface RecentBackfillDay {
  /** The local date (YYYY-MM-DD) — the value to pass as `?date=`. */
  date: LocalDateString;
  morningMissing: boolean;
  eveningMissing: boolean;
}

/**
 * Tour 15 — the last few EXPECTED (non-off) local days the member never fully
 * filled, newest first, capped at {@link MAX_BACKFILL_SUGGESTIONS}. Extends the
 * yesterday-only cue ({@link getYesterdayBackfill}) so a member who missed two
 * or three days sees each one as its own clickable rattrapage row.
 *
 * Off-aware (Tour 14): weekends kept off + explicit `MemberOffDay` declarations
 * are stepped over — an off day was chosen rest, never something "to catch up"
 * (§31.2, no pressure). Bounded to the backfill horizon
 * ({@link PAST_HORIZON_DAYS}) so we never offer a day the submit would reject.
 *
 * Walk: from local yesterday backwards, skip off days, and for each expected day
 * collect the missing slots — stop once we have {@link MAX_BACKFILL_SUGGESTIONS}
 * incomplete days OR we reach the horizon. TODAY is excluded on purpose: it is
 * the normal same-day flow (the hub surfaces it separately), never a rattrapage.
 *
 * One indexed range query on the check-ins + one cached off-day context query.
 * Returns `[]` when everything recent is covered or off (no cue, no pressure).
 */
export async function getRecentBackfillDays(
  userId: string,
  timezone: string,
  now: Date = new Date(),
  maxDays: number = MAX_BACKFILL_SUGGESTIONS,
): Promise<RecentBackfillDay[]> {
  const today = todayFor(timezone, now);
  const yesterday = shiftLocalDate(today, -1);
  // The oldest local day we would ever offer — the backfill horizon lower bound
  // (same window the Zod submit + `resolveBackfillDateParam` enforce), so a
  // listed day is always a day the member could actually catch up.
  const horizonStart = shiftLocalDate(today, -PAST_HORIZON_DAYS);

  // Off-day context + filled slots over the whole horizon, resolved once. The
  // check-in query is bounded by the same lower pin the walk uses.
  const [offCtx, rows] = await Promise.all([
    getOffDaySet(userId, horizonStart, yesterday),
    db.dailyCheckin.findMany({
      where: {
        userId,
        date: { gte: parseLocalDate(horizonStart), lte: parseLocalDate(yesterday) },
      },
      select: { date: true, slot: true },
    }),
  ]);

  // Bucket filled slots by local-date string for O(1) per-day lookup.
  const slotsByDate = new Map<LocalDateString, Set<CheckinSlot>>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    let set = slotsByDate.get(key);
    if (!set) {
      set = new Set();
      slotsByDate.set(key, set);
    }
    set.add(r.slot);
  }

  const out: RecentBackfillDay[] = [];
  let cursor = yesterday;
  while (out.length < maxDays && cursor >= horizonStart) {
    // Step over off days (weekend kept off / explicit declaration): a rest is
    // never something to catch up. Filled or not, an off day yields no cue.
    if (!isOffDay(cursor, offCtx)) {
      const slots = slotsByDate.get(cursor);
      const morningMissing = !slots?.has('morning');
      const eveningMissing = !slots?.has('evening');
      if (morningMissing || eveningMissing) {
        out.push({ date: cursor, morningMissing, eveningMissing });
      }
    }
    cursor = shiftLocalDate(cursor, -1);
  }

  return out;
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

/**
 * React `cache()` (carbone getMethodMirror): the dashboard render asks for the
 * streak from more than one section — per-request memoisation collapses the
 * duplicate `(userId, timezone)` calls into one query chain. Callers that
 * inject an explicit `now` (tests) key on that Date's identity and simply
 * bypass the dedup; the default is resolved INSIDE the memoised function, so
 * argument-less production calls share one cache key.
 */
export const getStreak = cache(
  async (
    userId: string,
    timezone: string,
    now: Date = new Date(),
  ): Promise<CheckinStreakSummary> => {
    const today = todayFor(timezone, now);
    const windowStart = shiftLocalDate(today, -(60 - 1));
    // Tour 14 — load the member's off-day context over the SAME 60-day window as
    // the check-in rows so `computeStreak` can step over unfilled off days (an
    // off weekend never breaks a Friday→Monday streak). One cached range query.
    const [days, offCtx] = await Promise.all([
      listRecentCheckinDays(userId, today, 60),
      getOffDaySet(userId, windowStart, today),
    ]);
    const current = computeStreak(days, today, (d) => isOffDay(d, offCtx));
    const todayFilled = days.some((d) => d.date === today && d.slots.length > 0);
    return { current, todayFilled, today };
  },
);

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
  const windowStart = shiftLocalDate(today, -(380 - 1));
  // Tour 14 — resolve the member's off-day context over the SAME window the
  // heatmap covers, so an off day (weekend kept off, or an explicit
  // declaration) is a distinct muted tint, never read as a blank level-0 gap
  // (§31.2). One indexed range query + the `weekendsOff` flag, memoised.
  const [days, offCtx] = await Promise.all([
    listRecentCheckinDays(userId, today, 380),
    getOffDaySet(userId, windowStart, today),
  ]);
  const levelByDate = new Map<LocalDateString, HeatLevel>();
  for (const d of days) {
    const level = Math.min(d.slots.length, 2) as HeatLevel;
    if (level > 0) levelByDate.set(d.date, level);
  }
  return buildYearHeatmap(levelByDate, today, (d) => isOffDay(d, offCtx));
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
  /**
   * Tour 14 — the day is an OFF day (weekend kept off, or an explicit
   * declaration). The sparkline/trend consumer reads this so an off day is NOT
   * counted as a blank "trou" (a missing check-in): a rest is a chosen day, not
   * a gap (§31.2). A day can be both `off` and `filled` (a check-in filed on an
   * off day still counts — the rempli wins).
   */
  off: boolean;
}

export async function getLast7Days(
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<DayPoint[]> {
  const today = todayFor(timezone, now);
  const startLocal = shiftLocalDate(today, -6);
  const startDate = parseLocalDate(startLocal);

  // Tour 14 — off-day context over the same 7-day window (weekend flag + explicit
  // declarations), so the trend reads an off day as a chosen rest, never a trou.
  const [rows, offCtx] = await Promise.all([
    db.dailyCheckin.findMany({
      where: { userId, date: { gte: startDate } },
      select: {
        date: true,
        slot: true,
        sleepHours: true,
        moodScore: true,
        stressScore: true,
      },
      orderBy: { date: 'desc' },
    }),
    getOffDaySet(userId, startLocal, today),
  ]);

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
      off: isOffDay(dateKey, offCtx),
    });
  }
  return out;
}
