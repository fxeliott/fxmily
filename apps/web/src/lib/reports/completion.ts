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
  /**
   * Tour 14 — the OFF days (weekend kept off + explicit declarations) that fall
   * inside the period, as local `YYYY-MM-DD` strings. The loader resolves them
   * once via `getOffDaySet` + `isOffDay`. Two effects, mirroring the SPEC pont:
   *   - coverage DENOMINATOR excludes off days (a member who takes weekends off
   *     is measured against the days they actually owed a check-in, never the
   *     full calendar span);
   *   - the continuity run STEPS OVER an unfilled off day (a weekend off must
   *     not break a Friday→Monday streak — same bridge as `checkin/streak.ts`).
   * Absent/empty → byte-identical to pre-Tour-14 (denominator = periodDays, no
   * bridge). A check-in actually filed on an off day still counts 100 % (the
   * rempli wins): off status only ever REMOVES pressure, never a filled entry.
   */
  offDays?: ReadonlySet<string>;
}

/** Deterministic completion + continuity snapshot for one report period. */
export interface CompletionSummary {
  /** Number of calendar days in the (inclusive) period. */
  periodDays: number;
  /**
   * Tour 14 — off days inside the period (weekend off + explicit declarations).
   * Excluded from the coverage denominator; surfaced so the reader can frame the
   * rate ("hors jours off"). 0 when no off days / no set supplied.
   */
  offDaysCount: number;
  /**
   * Tour 14 — days the member actually OWED a check-in: `periodDays − offDays`,
   * floored at 0. This is the coverage denominator (never the raw calendar span
   * once off days exist), so a member who keeps weekends off is not scored
   * against the days they never owed.
   */
  owedDays: number;
  /** Distinct days with at least one check-in. */
  checkinDaysFilled: number;
  /**
   * `checkinDaysFilled / owedDays`, clamped to [0,1]. Denominator excludes off
   * days (Tour 14). Falls back to `periodDays` when no off days are supplied.
   */
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

  // Tour 14 — only off days that fall INSIDE the period count against the
  // denominator, and only when they are NOT themselves filled (a check-in filed
  // on an off day still counts 100 % — the rempli wins, so it stays in the owed
  // set). `owedDays` = the days the member actually owed a check-in.
  const offInPeriod = new Set<string>();
  if (input.offDays) {
    for (const date of input.offDays) {
      const ord = dayOrdinal(date);
      if (ord >= startOrd && ord <= endOrd && !distinctDates.has(date)) offInPeriod.add(date);
    }
  }
  const offDaysCount = offInPeriod.size;
  const owedDays = Math.max(0, periodDays - offDaysCount);
  const checkinCoverageRate = owedDays > 0 ? Math.min(1, checkinDaysFilled / owedDays) : 0;

  const morningCheckinsCount = input.checkins.filter((c) => c.slot === 'morning').length;
  const eveningCheckinsCount = input.checkins.filter((c) => c.slot === 'evening').length;

  const routineDaysCompleted = new Set(
    input.checkins.filter((c) => c.morningRoutineCompleted === true).map((c) => c.date),
  ).size;

  // Tour 14 — the continuity run STEPS OVER unfilled off days (a weekend off
  // does not break a Friday→Monday streak), mirroring `checkin/streak.ts`.
  const longestStreakDays = computeLongestRun(startOrd, endOrd, distinctDates, offInPeriod);

  return {
    periodDays,
    offDaysCount,
    owedDays,
    checkinDaysFilled,
    checkinCoverageRate: roundTo(checkinCoverageRate, 4),
    morningCheckinsCount,
    eveningCheckinsCount,
    routineDaysCompleted,
    longestStreakDays,
    hasActivity: checkinDaysFilled > 0,
  };
}

/**
 * Longest run of CONSECUTIVE filled days within `[startOrd, endOrd]`, where an
 * unfilled OFF day is TRANSPARENT (steps over, never a break — the SPEC pont)
 * and an unfilled working day breaks the run. A filled day always adds 1 (even
 * a filled off day: the rempli wins). Returns 0 on a period with no filled day.
 *
 * Walks the period day-by-day (cheap: periods are ≤31 days) rather than sorting
 * check-in ordinals, because the bridge needs to know, for every gap, whether
 * the gap days were off (skip) or working (break).
 */
function computeLongestRun(
  startOrd: number,
  endOrd: number,
  filledDates: ReadonlySet<string>,
  offDates: ReadonlySet<string>,
): number {
  if (filledDates.size === 0) return 0;

  let longest = 0;
  let run = 0;
  for (let ord = startOrd; ord <= endOrd; ord += 1) {
    const date = localFromOrdinal(ord);
    if (filledDates.has(date)) {
      run += 1;
      if (run > longest) longest = run;
    } else if (!offDates.has(date)) {
      // Unfilled working day → the run breaks. (An unfilled off day is skipped:
      // `run` carries over, so a filled Friday + off weekend + filled Monday = 2.)
      run = 0;
    }
  }
  return longest;
}

/** Inverse of {@link dayOrdinal}: a UTC-epoch day ordinal → `YYYY-MM-DD`. */
function localFromOrdinal(ordinal: number): string {
  return new Date(ordinal * 86_400_000).toISOString().slice(0, 10);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
