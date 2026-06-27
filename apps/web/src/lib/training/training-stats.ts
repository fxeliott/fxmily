import { localDateOf, shiftLocalDate, type LocalDateString } from '@/lib/checkin/timezone';

/**
 * S8 RE-CHALLENGE — pure §269 enrichment aggregators for the `/training`
 * regularity surface (brief §269 Enrichissement 1 : régularité dans le temps,
 * séries/streaks de jours, taux de complétude des champs du journal).
 *
 * PURE, side-effect free, no DB, no `Date.now()` (the caller injects `now` for
 * deterministic tests — mirror of `lib/checkin/streak.ts` + `training-debrief/
 * stats.ts`). The service (`training-trade-service.ts`) feeds these from a
 * §21.5-safe slice and surfaces the result on `/training`.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5): regularity + streaks read ONLY the
 * entry instant (`enteredAt`) — count/recency, NEVER a backtest P&L. Civil-day
 * membership is decided by `localDateOf(enteredAt, 'Europe/Paris')` — NEVER
 * `toISOString().slice(0,10)` (invariant §23.7 / nocturnal-flake), so a backtest
 * logged at 00:30 Paris is attributed to its Paris civil day, not the UTC one.
 * Field-completeness counts PRESENCE (non-null), never reading a value into a
 * judgement — and lives ABOVE the `countRecentTrainingActivity` primitive in
 * the service, so the anti-leak file-slice contract is untouched.
 */

const COHORT_TZ = 'Europe/Paris';

/** Inclusive rolling window for the "régularité" metric (§269c). */
export const REGULARITY_WINDOW_DAYS = 30;

export interface TrainingRegularity {
  /** Distinct Europe/Paris civil days with ≥1 backtest in the last 30 days (0..30). */
  activeDays30: number;
  /** §269(e) — current SOBER day-streak: consecutive civil days with ≥1 backtest
   * ending today (if practised today) or yesterday (grace, mirror
   * `computeStreak`). 0 when neither today nor yesterday was practised. */
  currentDayStreak: number;
  /** §269(e) — longest all-time run of consecutive civil days with ≥1 backtest. */
  longestDayStreak: number;
}

/**
 * Derive the §269(c)/(e) regularity + streaks from backtest entry instants.
 * `now` is injected (the service passes `new Date()`); both `now` and the
 * entries are read in the Europe/Paris cohort calendar.
 */
export function computeTrainingRegularity(
  enteredAts: readonly Date[],
  now: Date,
): TrainingRegularity {
  const today = localDateOf(now, COHORT_TZ);
  const days = new Set<LocalDateString>();
  for (const d of enteredAts) days.add(localDateOf(d, COHORT_TZ));

  // §269c — distinct active civil days within [today-29, today] (30-day window).
  const windowStart = shiftLocalDate(today, -(REGULARITY_WINDOW_DAYS - 1));
  let activeDays30 = 0;
  for (const d of days) {
    if (d >= windowStart && d <= today) activeDays30 += 1;
  }

  // §269e — current streak. Today counts only if practised today; otherwise the
  // streak is the run ending yesterday (a member who hasn't practised yet today
  // keeps yesterday's streak). Breaks once both today AND yesterday are empty.
  let cursor: LocalDateString | null = null;
  if (days.has(today)) cursor = today;
  else {
    const yesterday = shiftLocalDate(today, -1);
    if (days.has(yesterday)) cursor = yesterday;
  }
  let currentDayStreak = 0;
  while (cursor && days.has(cursor)) {
    currentDayStreak += 1;
    cursor = shiftLocalDate(cursor, -1);
  }

  // §269e — longest all-time run, by walking the sorted distinct days.
  const sorted = [...days].sort();
  let longestDayStreak = 0;
  let run = 0;
  let prev: LocalDateString | null = null;
  for (const d of sorted) {
    run = prev !== null && shiftLocalDate(prev, 1) === d ? run + 1 : 1;
    if (run > longestDayStreak) longestDayStreak = run;
    prev = d;
  }

  return { activeDays30, currentDayStreak, longestDayStreak };
}

/**
 * The optional journal fields whose PRESENCE the §269(d) completeness rate
 * measures. Deliberately the fillable fields a member may leave blank — NOT the
 * always-present mandatory ones (`pair` / `entryScreenshotKey` / `plannedRR` /
 * `lessonLearned` / `enteredAt`), which would inflate the rate to a meaningless
 * floor. The 4 checklist items are INCLUDED by PRESENCE (non-null), which is
 * what makes §269(d) genuinely distinct from the §270 "checklist tenue" rate
 * (which counts value === true): a member who honestly answers "Non" to a
 * checklist item has COMPLETED that field (counts here) but it is not "clean"
 * (does not count for §270).
 */
export const FIELD_COMPLETION_FIELDS = [
  'outcome',
  'resultR',
  'systemRespected',
  'planFollowed',
  'riskDefinedBefore',
  'emotionalStateNoted',
  'noImpulsiveDeviation',
] as const;

/** A row carrying (at least) the optional journal fields, presence-checked. */
export type FieldPresenceRow = Partial<Record<(typeof FIELD_COMPLETION_FIELDS)[number], unknown>>;

/**
 * §269(d) — mean fill-rate of the optional journal fields per backtest.
 * `null` when there are no backtests (the UI shows "—", never a misleading 0 %).
 * Presence = non-null; the VALUE is never interpreted (so a `false`/`loss`
 * still counts as a completed field — the key distinction from the §270 rate).
 */
export function computeFieldCompletionRate(rows: readonly FieldPresenceRow[]): number | null {
  if (rows.length === 0) return null;
  const fieldCount = FIELD_COMPLETION_FIELDS.length;
  let sum = 0;
  for (const row of rows) {
    let filled = 0;
    for (const f of FIELD_COMPLETION_FIELDS) {
      if (row[f] != null) filled += 1;
    }
    sum += filled / fieldCount;
  }
  return sum / rows.length;
}
