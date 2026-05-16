/**
 * V2.1.3 TRACK — Habit × Trade correlation.
 *
 * Composes the J6 `correlations.ts` primitives into a typed, honesty-first
 * result for the dashboard / `/track` correlation card. This is the
 * documented product differentiator: surface whether a member's logged
 * habit (sleep, etc.) moves with their realized R — *without lying when
 * the sample is thin*.
 *
 * Mark Douglas posture, encoded structurally (not just in copy):
 *
 *   - Below `MIN_CORRELATION_PAIRS` (8) we return `insufficient_data` —
 *     the call site CANNOT render a coefficient because the union has no
 *     `r` field in that branch. A Pearson r over 4 points is noise; a
 *     disclaimer next to it is still misleading.
 *   - `SUFFICIENT_SAMPLE_MIN` (20, the Fxmily UI policy from `wilson.ts`)
 *     is reused as a confidence *tier*, not a CI: 8..19 paired days =
 *     `confidence: 'low'` (shown with an explicit "à confirmer" caveat),
 *     >= 20 = `'adequate'`. We deliberately do NOT compute a confidence
 *     interval for r — Wilson is a *proportion* interval (win-rate), the
 *     correct CI for a Pearson r is the Fisher z-transform which this
 *     codebase has no battle-tested helper for. Inventing a band with the
 *     wrong formula would be the exact dishonesty this feature exists to
 *     avoid. Sample size + effect-size language carry the uncertainty.
 *   - The result reports BOTH Pearson and Spearman so the card can warn
 *     when they diverge (outlier-driven linear r vs robust rank ρ).
 *
 * Pairing rule (causal anchor): a trade is matched to the habit logged on
 * its **entry day** in the member's timezone — the day the decision was
 * made under that day's conditions (slept badly last night → entered this
 * trade today). NOT `closedAt` (form-fill day, can lag the real exit by
 * days and would smear the causal link). Only `realizedRSource='computed'`
 * trades are eligible — `estimated` R has no precise magnitude and would
 * corrupt the coefficient (mirrors the J6 expectancy convention,
 * `apps/web/CLAUDE.md` "exclude realizedRSource='estimated'").
 *
 * Pure module — no DB, no `Date.now()`, no `server-only`. The service
 * layer loads + serializes; this file is the deterministic, TDD-tested
 * core.
 */

import { localDateOf, shiftLocalDate, type LocalDateString } from '@/lib/checkin/timezone';
import {
  caffeineValueSchema,
  type HabitKind,
  meditationValueSchema,
  nutritionValueSchema,
  sleepValueSchema,
  sportValueSchema,
} from '@/lib/schemas/habit-log';

import { MIN_CORRELATION_PAIRS, pearson, spearman } from './correlations';
import { SUFFICIENT_SAMPLE_MIN } from './wilson';

// Re-export so consumers can label "X / 8 paires" without importing two files.
export { MIN_CORRELATION_PAIRS } from './correlations';
export { SUFFICIENT_SAMPLE_MIN } from './wilson';

/**
 * Above this absolute gap between Pearson r and Spearman ρ, the card warns
 * the relationship is outlier-/non-linear-driven (linear r unreliable).
 * This is a *statistical* threshold (lives here, next to the other policy
 * constants), not a UI decision — the card just renders against it.
 */
export const SPEARMAN_PEARSON_DIVERGENCE = 0.2;

// =============================================================================
// Input shapes (kept local — the pure module never imports the server-only
// `@/lib/habit/service`; the service maps its `SerializedHabitLog` to these).
// =============================================================================

/** Minimal habit-log slice the correlation needs. `value` stays `unknown` —
 *  `extractHabitScalar` type-narrows via the canonical Zod value schemas. */
export interface HabitLogLike {
  /** Local civil date, `YYYY-MM-DD` (already serialized by the service). */
  date: string;
  kind: HabitKind;
  value: unknown;
}

/** Minimal trade slice. `enteredAt` is an ISO UTC datetime string. */
export interface TradeLike {
  enteredAt: string;
  /** `realizedR` already serialized to a finite number (Decimal -> number).
   *  Callers MUST pre-filter to `realizedRSource='computed'`. */
  realizedR: number;
  tradeQuality?: 'A' | 'B' | 'C';
}

/** One paired observation feeding the coefficient + scatter. */
export interface HabitTradePair {
  /** Paris-local civil date of the trade entry (= the habit day). */
  date: LocalDateString;
  /** Extracted numeric scalar for the habit kind (e.g. sleep hours). */
  habitValue: number;
  /** The trade's realized R for that day. */
  realizedR: number;
  tradeQuality?: 'A' | 'B' | 'C';
}

export type CorrelationInterpretation =
  | 'strong_positive'
  | 'moderate_positive'
  | 'weak'
  | 'moderate_negative'
  | 'strong_negative';

export type CorrelationConfidence = 'low' | 'adequate';

export type CorrelationStatus =
  | {
      status: 'sufficient';
      /** Pearson r in [-1, 1]. */
      r: number;
      /** Spearman ρ in [-1, 1] — robust cross-check vs outliers. */
      rSpearman: number;
      /** Number of paired observations (trades matched to a habit day). */
      n: number;
      /** `low` = 8..19 pairs, `adequate` = >= SUFFICIENT_SAMPLE_MIN. */
      confidence: CorrelationConfidence;
      interpretation: CorrelationInterpretation;
      /** Sorted ascending by habitValue for a stable scatter render. */
      pairs: HabitTradePair[];
    }
  | {
      status: 'insufficient_data';
      /** How many pairs we DO have (always < minRequired). */
      n: number;
      minRequired: number;
    };

/** One column of the 7-day heatmap: which kinds were logged that day. */
export interface HabitHeatmapDay {
  date: LocalDateString;
  /** `true` = a log exists for that kind on that day. Missing key = false. */
  kinds: Partial<Record<HabitKind, boolean>>;
}

export interface HabitTradeCorrelationResult {
  correlation: CorrelationStatus;
  /** Always exactly `days` entries, newest-first. */
  heatmap: HabitHeatmapDay[];
  /** The habit kind this correlation is computed for (day-1: `sleep`). */
  habitKind: HabitKind;
  windowDays: number;
}

// =============================================================================
// Scalar extraction
// =============================================================================

/**
 * Pull a single comparable number out of a `HabitLog.value` payload.
 *
 *   - sleep / sport / meditation -> minutes converted/kept as the natural
 *     unit (sleep -> hours; sport / meditation -> minutes).
 *   - nutrition -> meals count.
 *   - caffeine -> cups.
 *
 * Returns `null` (never throws) when the payload doesn't match the
 * canonical Zod shape for that kind — a malformed row is excluded from
 * the correlation rather than crashing the dashboard.
 *
 * Note — `0` is treated as a REAL observation, not "absence". For
 * caffeine/sport that is meaningful signal ("no coffee" / "no workout"
 * is a genuine condition that may correlate with R); for sleep a logged
 * `0` is implausible-but-possible. On a thin sample a lone `0` is outlier
 * leverage — surfaced (not hidden) by the Spearman cross-check + the
 * `SPEARMAN_PEARSON_DIVERGENCE` warning + the n-floor honesty. A per-kind
 * "0 = absent" policy is a product decision deferred to >100-member scale
 * (code-review V2.1.3 T2#2) — intentionally NOT pre-built (YAGNI at 30).
 */
export function extractHabitScalar(kind: HabitKind, value: unknown): number | null {
  switch (kind) {
    case 'sleep': {
      const r = sleepValueSchema.safeParse(value);
      return r.success ? r.data.durationMin / 60 : null;
    }
    case 'nutrition': {
      const r = nutritionValueSchema.safeParse(value);
      return r.success ? r.data.mealsCount : null;
    }
    case 'caffeine': {
      const r = caffeineValueSchema.safeParse(value);
      return r.success ? r.data.cups : null;
    }
    case 'sport': {
      const r = sportValueSchema.safeParse(value);
      return r.success ? r.data.durationMin : null;
    }
    case 'meditation': {
      const r = meditationValueSchema.safeParse(value);
      return r.success ? r.data.durationMin : null;
    }
    default:
      return null;
  }
}

// =============================================================================
// Pairing
// =============================================================================

/**
 * Build the `(habitValue, realizedR)` pairs for one habit kind.
 *
 * One habit log per `(date, kind)` is guaranteed by the DB unique
 * constraint, so the day -> scalar map is unambiguous. A day with N
 * qualifying trades yields N pairs (same x, different y) — the unit of
 * analysis is "habit state on the decision day vs that trade's R", which
 * is what a member actually wants to know.
 *
 * Result is sorted ascending by `habitValue` so the scatter renders
 * deterministically (Pearson/Spearman are order-invariant — sorting is
 * purely a render concern).
 */
export function pairHabitLogsToTrades(
  habitLogs: readonly HabitLogLike[],
  trades: readonly TradeLike[],
  kind: HabitKind,
  timezone: string,
): HabitTradePair[] {
  const scalarByDate = new Map<string, number>();
  for (const log of habitLogs) {
    if (log.kind !== kind) continue;
    const scalar = extractHabitScalar(kind, log.value);
    if (scalar === null) continue;
    scalarByDate.set(log.date, scalar);
  }

  const pairs: HabitTradePair[] = [];
  for (const trade of trades) {
    if (!Number.isFinite(trade.realizedR)) continue;
    const day = localDateOf(new Date(trade.enteredAt), timezone);
    const habitValue = scalarByDate.get(day);
    if (habitValue === undefined) continue;
    pairs.push({
      date: day,
      habitValue,
      realizedR: trade.realizedR,
      ...(trade.tradeQuality ? { tradeQuality: trade.tradeQuality } : {}),
    });
  }

  pairs.sort((a, b) => a.habitValue - b.habitValue);
  return pairs;
}

// =============================================================================
// Interpretation + compute
// =============================================================================

/**
 * Map a coefficient to an effect-size bucket. Thresholds are the common
 * Cohen-ish convention used elsewhere in Fxmily copy: |r| < 0.3 = weak
 * (we don't even sign it — "no clear link"), 0.3..0.5 = moderate,
 * >= 0.5 = strong. The card NEVER prints the raw r as the headline; it
 * prints the bucket. The number is secondary detail.
 */
export function interpretCoefficient(r: number): CorrelationInterpretation {
  const a = Math.abs(r);
  if (a < 0.3) return 'weak';
  if (a < 0.5) return r > 0 ? 'moderate_positive' : 'moderate_negative';
  return r > 0 ? 'strong_positive' : 'strong_negative';
}

/**
 * The discriminated-union entry point. Returns `insufficient_data` when
 * there are fewer than `MIN_CORRELATION_PAIRS` pairs OR when Pearson is
 * undefined (zero variance — e.g. every trade has the same R, or the
 * member always sleeps exactly 7h). In both cases a coefficient would be
 * a lie, so the union structurally forbids rendering one.
 */
export function computeHabitTradeCorrelation(
  pairs: readonly HabitTradePair[],
  kind: HabitKind,
  windowDays: number,
  heatmap: readonly HabitHeatmapDay[],
): HabitTradeCorrelationResult {
  const n = pairs.length;
  const base = { heatmap: [...heatmap], habitKind: kind, windowDays };

  if (n < MIN_CORRELATION_PAIRS) {
    return {
      ...base,
      correlation: { status: 'insufficient_data', n, minRequired: MIN_CORRELATION_PAIRS },
    };
  }

  const xs = pairs.map((p) => p.habitValue);
  const ys = pairs.map((p) => p.realizedR);
  const r = pearson(xs, ys);
  const rSpearman = spearman(xs, ys);

  if (r === null || rSpearman === null) {
    return {
      ...base,
      correlation: { status: 'insufficient_data', n, minRequired: MIN_CORRELATION_PAIRS },
    };
  }

  return {
    ...base,
    correlation: {
      status: 'sufficient',
      r,
      rSpearman,
      n,
      confidence: n >= SUFFICIENT_SAMPLE_MIN ? 'adequate' : 'low',
      interpretation: interpretCoefficient(r),
      pairs: [...pairs],
    },
  };
}

// =============================================================================
// Heatmap
// =============================================================================

const ALL_HABIT_KINDS: readonly HabitKind[] = [
  'sleep',
  'nutrition',
  'caffeine',
  'sport',
  'meditation',
];

/**
 * Build the GitHub-contributions-style grid: the last `days` civil days
 * (ending `today`, in the member's timezone), newest-first, each marking
 * which of the 5 kinds were logged. Always exactly `days` entries even
 * with zero logs — the empty grid is itself the (honest) message.
 *
 * Pure: `today` is passed in (the service derives it via
 * `localDateOf(new Date(), tz)`), so this stays deterministic + testable.
 */
export function buildHabitHeatmap(
  habitLogs: readonly HabitLogLike[],
  today: LocalDateString,
  days = 7,
): HabitHeatmapDay[] {
  const logged = new Set<string>();
  for (const log of habitLogs) {
    logged.add(`${log.date}|${log.kind}`);
  }

  const result: HabitHeatmapDay[] = [];
  // newest-first: offset 0 = today, -1 = yesterday, ...
  for (let i = 0; i < days; i++) {
    const date = i === 0 ? today : shiftLocalDate(today, -i);
    const kinds: Partial<Record<HabitKind, boolean>> = {};
    for (const k of ALL_HABIT_KINDS) {
      if (logged.has(`${date}|${k}`)) kinds[k] = true;
    }
    result.push({ date, kinds });
  }
  return result;
}
