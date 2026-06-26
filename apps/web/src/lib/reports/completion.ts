/**
 * Pure, DB-free completion + continuity aggregator (S6 §32-3 enrichment #3).
 *
 * Turns a period's raw check-in rows into a deterministic
 * {@link CompletionSummary} — "vue d'ensemble du taux de complétion +
 * continuité (jours consécutifs de routines tenues)". Rendered at the HEAD of
 * the weekly (admin) and monthly (member) report readers as a factual,
 * always-present block, INDEPENDENT of whatever the AI prose chose to mention.
 *
 * Why a separate deterministic block (not the AI summary) : the report's LLM
 * text may or may not surface assiduité depending on the run. §32-3 asks for a
 * GUARANTEED overview — so it is computed here, purely, from the member's own
 * check-ins, and never depends on the model.
 *
 * Posture (SPEC §2 + anti-Black-Hat §31.2), mirror of `weekly-recap-card`:
 *   - INTEGRITY: counts only what was actually recorded. Coverage is clamped to
 *     [0,1]; `longestStreakDays` is 0 (not 1) on an empty period. No fabricated
 *     "calendar-realization %" — only what the member demonstrably did.
 *   - ANTI-BLACK-HAT: this is a calm factual snapshot, NEVER a verdict. The
 *     renderer uses neutral tones (no red, no punitive branch). A low-coverage
 *     period is surfaced as a neutral fact framed by process > outcome.
 *   - §2: behavioural process only (check-in coverage, morning-routine days,
 *     journaling, continuity) — zero market content, zero P&L, zero advice.
 *
 * Scope note (deliberate, §32-3 "routines tenues") : completion here is
 * CHECK-IN-derived (the member's daily routine adherence). Fxmily MEETING
 * assiduité is a distinct axis already surfaced to the admin (verification
 * panel) and fed to the AI (`WeeklySnapshot.counters.meetingAttendance`); it is
 * intentionally NOT duplicated in this block, whose continuity figure is
 * period-scoped (distinct from the live dashboard streak).
 *
 * Pure — no DB, no `Date.now()`, no I/O. `Date.UTC` is used only to turn the
 * fixed `YYYY-MM-DD` strings into TZ-free day ordinals (deterministic). Easy to
 * unit-test against a frozen fixture under Vitest.
 */

/** One check-in row, minimal slice the aggregator needs (DB-free). */
export interface CompletionDay {
  /** Local calendar day, `YYYY-MM-DD` (the `@db.Date` column, no time/DST). */
  date: string;
  /** Which slot this row is. */
  slot: 'morning' | 'evening';
  /**
   * Tri-state morning-routine flag: `true` (done), `false` (skipped),
   * `null` (slot-N/A or unanswered). Only `true` counts toward
   * `routineDaysCompleted` — a `null` is NEVER read as a skip.
   */
  morningRoutineCompleted: boolean | null;
}

/** Aggregator input — a single period's check-ins + its inclusive bounds. */
export interface CompletionInput {
  /** Inclusive period start, local `YYYY-MM-DD`. */
  periodStart: string;
  /** Inclusive period end, local `YYYY-MM-DD`. */
  periodEnd: string;
  /** Raw check-in rows in the period (any slot), as loaded from the DB. */
  checkins: readonly CompletionDay[];
}

/** Deterministic completion + continuity snapshot for one report period. */
export interface CompletionSummary {
  /** Number of calendar days in the (inclusive) period. */
  periodDays: number;
  /** Distinct days with at least one check-in. */
  checkinDaysFilled: number;
  /** `checkinDaysFilled / periodDays`, clamped to [0,1]. */
  checkinCoverageRate: number;
  /** Morning check-ins filed (count). */
  morningCheckinsCount: number;
  /** Evening check-ins filed (count) — where the daily journaling happens. */
  eveningCheckinsCount: number;
  /** Distinct days where the morning routine was completed (`=== true`). */
  routineDaysCompleted: number;
  /**
   * Longest run of CONSECUTIVE check-in days within the period — the
   * continuity signal (§32-3 "jours consécutifs"). 0 on an empty period.
   * Period-scoped by design: distinct from the live dashboard streak.
   */
  longestStreakDays: number;
  /**
   * True iff the member showed ANY activity in the period (≥ 1 check-in day).
   * Gates the renderer: below this, an all-zeros block would be a misleading
   * non-event → the pedagogical empty state is shown instead.
   */
  hasActivity: boolean;
}

/**
 * Days since the UTC epoch for a `YYYY-MM-DD` string — a TZ-free ordinal used
 * for both the period length and the consecutive-day streak. `Date.UTC` makes
 * this deterministic and DST-proof (the input is a pure calendar day).
 */
function dayOrdinal(local: string): number {
  const [y, m, d] = local.split('-').map(Number);
  return Math.floor(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/**
 * Build the deterministic completion + continuity summary from a period's
 * check-ins. No IA, fully reproducible:
 *  1. `periodDays` = inclusive calendar-day span of [periodStart, periodEnd].
 *  2. `checkinDaysFilled` / coverage = distinct check-in days (clamped ≤ 1).
 *  3. `routineDaysCompleted` = distinct days with `morningRoutineCompleted === true`
 *     (a `null`/`false` is never coerced into a completion).
 *  4. `longestStreakDays` = longest consecutive-day run among the check-in days.
 */
export function buildCompletionSummary(input: CompletionInput): CompletionSummary {
  const startOrd = dayOrdinal(input.periodStart);
  const endOrd = dayOrdinal(input.periodEnd);
  const periodDays = endOrd >= startOrd ? endOrd - startOrd + 1 : 0;

  const distinctDates = new Set(input.checkins.map((c) => c.date));
  const checkinDaysFilled = distinctDates.size;
  const checkinCoverageRate = periodDays > 0 ? Math.min(1, checkinDaysFilled / periodDays) : 0;

  const morningCheckinsCount = input.checkins.filter((c) => c.slot === 'morning').length;
  const eveningCheckinsCount = input.checkins.filter((c) => c.slot === 'evening').length;

  const routineDaysCompleted = new Set(
    input.checkins.filter((c) => c.morningRoutineCompleted === true).map((c) => c.date),
  ).size;

  const longestStreakDays = computeLongestRun([...distinctDates].map(dayOrdinal));

  return {
    periodDays,
    checkinDaysFilled,
    checkinCoverageRate: roundTo(checkinCoverageRate, 4),
    morningCheckinsCount,
    eveningCheckinsCount,
    routineDaysCompleted,
    longestStreakDays,
    hasActivity: checkinDaysFilled > 0,
  };
}

/** Longest run of consecutive integers in a (possibly unsorted) ordinal list. */
function computeLongestRun(ordinals: number[]): number {
  if (ordinals.length === 0) return 0;
  const sorted = [...ordinals].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (cur === undefined || prev === undefined) continue;
    run = cur === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  return longest;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
