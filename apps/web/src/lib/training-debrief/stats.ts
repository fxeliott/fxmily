import { localDateOf, shiftLocalDate, type LocalDateString } from '@/lib/checkin/timezone';

/**
 * V1.3 — `TrainingDebrief` process-stats aggregator (SPEC §23.3).
 *
 * PURE, side-effect free, no DB, no `Date.now()`. The service layer
 * (`./service.ts`) fetches a §21.5-safe slice of `TrainingTrade` rows + an
 * annotation count and feeds them here. Computed at RENDER, never stored.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5 — BLOCKING). `TrainingDebriefStatTrade`
 * STRUCTURALLY omits `resultR` / `outcome` / `plannedRR`: this module CANNOT
 * see a backtest P&L because the input type does not carry it, and the
 * service's `db.trainingTrade` query selects only the four safe columns. The
 * blocking anti-leak suite (`src/test/anti-leak/training-isolation.test.ts`)
 * pins both halves of that invariant.
 *
 * Posture §23.2 / §2: a debrief shows PROCESS EFFORT (regularity, discipline,
 * diversity, lessons) — never a result, never a market judgement, never the
 * Lhedge system. Empty weeks render a pedagogical "0 backtest" panel, never a
 * misleading "score 0" (SPEC §23.4 / §21.4 canon).
 *
 * The week window is the 7 civil days `[weekStart, weekStart + 6 j]` anchored
 * to Europe/Paris (V1 cohort tz). Membership is decided by
 * `localDateOf(enteredAt, 'Europe/Paris')` — NEVER `toISOString().slice(0,10)`
 * (invariant §23.7 / PR#96 nocturnal flake). `enteredAt` is a plain UTC
 * instant (mirror `Trade.enteredAt`), so a backtest logged at 00:30 Paris is
 * correctly attributed to its Paris civil day, not the UTC one.
 */

// =============================================================================
// Public types
// =============================================================================

/**
 * The ONLY shape by which a backtest reaches the debrief stats. Deliberately
 * carries NO `resultR` / `outcome` / `plannedRR` (§21.5). `id` is needed so
 * the service can count admin corrections on exactly the in-week backtests.
 */
export interface TrainingDebriefStatTrade {
  id: string;
  /** ISO UTC instant — `TrainingTrade.enteredAt`. */
  enteredAt: string;
  pair: string;
  /** Tri-state — `true` respected / `false` not / `null` N/A. */
  systemRespected: boolean | null;
  lessonLearned: string;
}

export interface TrainingDebriefStats {
  /** Echoed back (Monday, Europe/Paris) so the UI has a single source. */
  weekStart: LocalDateString;
  /** Family 1 — Volume & régularité. */
  volume: {
    backtestCount: number;
    /** Distinct Europe/Paris civil days practised within the week (0..7). */
    distinctDays: number;
    /** Longest run of consecutive week-days with zero backtest (0..7). */
    longestGapDays: number;
    /**
     * Backtests per week-day, Monday→Sunday (length 7, Europe/Paris civil
     * day). Powers the calm "practice rhythm" visual. §21.5-clean: a pure
     * count vector, never a P&L — same isolation contract as the rest.
     */
    perWeekday: number[];
  };
  /** Family 2 — Respect du système (tri-state of `systemRespected`). */
  systemRespect: {
    respected: number;
    notRespected: number;
    unspecified: number;
  };
  /** Family 3 — Diversité de pratique. */
  diversity: {
    distinctPairs: number;
  };
  /** Family 4 — Leçons & corrections. */
  lessons: {
    /** Backtests with a non-empty `lessonLearned` (text never surfaced). */
    lessonsCount: number;
    /** Admin corrections received on the week's backtests (§21.5-safe). */
    annotationsCount: number;
  };
}

// =============================================================================
// Helpers
// =============================================================================

/** The 7 civil-day strings `[weekStart, … weekStart+6]` (Europe/Paris). */
function weekDays(weekStart: LocalDateString): LocalDateString[] {
  const days: LocalDateString[] = [];
  for (let i = 0; i < 7; i += 1) days.push(shiftLocalDate(weekStart, i));
  return days;
}

/** Europe/Paris civil day of a backtest's `enteredAt` (UTC instant). */
function parisDayOf(enteredAtIso: string): LocalDateString {
  return localDateOf(new Date(enteredAtIso), 'Europe/Paris');
}

// =============================================================================
// Pure aggregation
// =============================================================================

/**
 * Filter candidate backtests down to the ones whose Europe/Paris civil day
 * falls in `[weekStart, weekStart + 6 j]`. Pure. The service over-fetches a
 * ±1-day-slack UTC window (Paris is UTC+1/+2) then narrows precisely here —
 * same belt-and-suspenders pattern as the Habit×Trade correlation loader.
 */
export function selectWeekTrades(
  trades: readonly TrainingDebriefStatTrade[],
  weekStart: LocalDateString,
): TrainingDebriefStatTrade[] {
  const days = new Set(weekDays(weekStart));
  return trades.filter((t) => days.has(parisDayOf(t.enteredAt)));
}

/**
 * Compute the 4 process-stat families from candidate backtests + an admin
 * correction count. Re-filters to the week internally (idempotent if the
 * caller already filtered) so the function is correct regardless of caller —
 * SPEC §23.3 anchors every family to `enteredAt ∈ [weekStart, weekStart+6j]`.
 *
 * `annotationCount` is the number of `TrainingAnnotation` rows attached to the
 * week's backtests — a §21.5-safe count (no comment text, no P&L), computed by
 * the service from the in-week backtest ids.
 */
export function computeTrainingDebriefStats(
  trades: readonly TrainingDebriefStatTrade[],
  annotationCount: number,
  weekStart: LocalDateString,
): TrainingDebriefStats {
  const inWeek = selectWeekTrades(trades, weekStart);
  const days = weekDays(weekStart);

  // Volume & régularité.
  const daysWithPractice = new Set(inWeek.map((t) => parisDayOf(t.enteredAt)));
  const dayIndex = new Map(days.map((d, i) => [d, i] as const));
  const perWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const t of inWeek) {
    const i = dayIndex.get(parisDayOf(t.enteredAt));
    if (i !== undefined) perWeekday[i] = (perWeekday[i] ?? 0) + 1;
  }
  let longestGapDays = 0;
  let currentGap = 0;
  for (const d of days) {
    if (daysWithPractice.has(d)) {
      currentGap = 0;
    } else {
      currentGap += 1;
      if (currentGap > longestGapDays) longestGapDays = currentGap;
    }
  }

  // Respect du système (tri-state).
  let respected = 0;
  let notRespected = 0;
  let unspecified = 0;
  for (const t of inWeek) {
    if (t.systemRespected === true) respected += 1;
    else if (t.systemRespected === false) notRespected += 1;
    else unspecified += 1;
  }

  // Diversité de pratique.
  const distinctPairs = new Set(inWeek.map((t) => t.pair.trim()).filter((p) => p.length > 0)).size;

  // Leçons & corrections.
  const lessonsCount = inWeek.filter((t) => t.lessonLearned.trim().length > 0).length;

  return {
    weekStart,
    volume: {
      backtestCount: inWeek.length,
      distinctDays: daysWithPractice.size,
      longestGapDays,
      perWeekday,
    },
    systemRespect: { respected, notRespected, unspecified },
    diversity: { distinctPairs },
    lessons: {
      lessonsCount,
      annotationsCount: Math.max(0, Math.trunc(annotationCount)),
    },
  };
}
