/**
 * Canonical types for the four behavioral scores (SPEC §6.10, §7.11).
 *
 * Posture: every dimension carries its own `status` + `reason` so the
 * dashboard can render a per-dimension fallback ("Données insuffisantes —
 * encore N jours") instead of a single "no data" wall. Sample-size guards
 * are statistical, not arbitrary — we reject computations that would mislead
 * the member with a number drawn from too small a sample.
 *
 * Mark Douglas alignment: scores measure *process execution*, not market
 * prediction. Discipline = "did you follow your plan?", not "did the trade
 * win?". Emotional stability = state regulation, not P&L. Consistency = edge
 * proxies (expectancy, PF, DD), not luck. Engagement = habit adherence.
 */

import type { Prisma } from '@/generated/prisma/client';

/** A dimension score is `null` when its status is insufficient_data. */
export type ScoringStatus = 'ok' | 'insufficient_data';

/** Why a dimension cannot be computed with confidence. */
export type ScoringReason = 'no_trades' | 'no_computed_trades' | 'no_checkins' | 'window_short';

/** Generic shape: score + status + reason + the per-dimension parts. */
export interface ScoreResult<Parts> {
  /** 0–100. Null iff status='insufficient_data'. */
  score: number | null;
  status: ScoringStatus;
  reason?: ScoringReason;
  /** Sub-score breakdown for the UI ("why is my score X?"). */
  parts: Parts;
  /** Per-dimension sample counters (for the disclaimer). */
  sample: SamplePerDimension;
}

export interface SamplePerDimension {
  /** Closed trades counted in this dimension (when relevant). */
  trades?: number;
  /** Days of check-in data available in the window. */
  days?: number;
  /** Whether the sample meets the dimension's minimum threshold. */
  sufficient: boolean;
}

// ----- Discipline -----------------------------------------------------------

export interface DisciplineParts {
  /** Closed trades with planRespected=true / closed trades. */
  planRespect: SubScore;
  /** Closed trades with hedgeRespected!=false / trades with !=null (skips N/A). */
  hedgeRespect: SubScore;
  /** Evening checkins with planRespectedToday=true / evenings filled. */
  eveningPlan: SubScore;
  /** Morning checkins with intention!=null / mornings filled. */
  intentionFilled: SubScore;
  /** Morning checkins with morningRoutineCompleted=true / mornings filled. */
  routineCompleted: SubScore;
}

// ----- Emotional Stability --------------------------------------------------

export interface EmotionalStabilityParts {
  /** 100 − clamp(stdDev(mood) × 12.5, 0, 100). High = stable mood. */
  moodVariance: SubScore;
  /** 100 − clamp((medianStress − 1) × 11.11, 0, 100). High = lower stress. */
  stressMedian: SubScore;
  /** 100 − negativeEmotionRate × 100. High = fewer negative tags. */
  negativeEmotionRate: SubScore;
  /** Recovery after a loss day vs baseline. High = bounces back fast. */
  recoveryAfterLoss: SubScore | null;
}

// ----- Consistency ----------------------------------------------------------

export interface ConsistencyParts {
  /** clamp(expectancyR × 33.33, 0, 100). 1R → 33, 3R+ → 100. */
  expectancyConsistency: SubScore;
  /** clamp((profitFactor − 1) × 50, 0, 100). PF=1→0, PF=3→100. */
  profitFactor: SubScore;
  /** 100 − clamp(maxDDR × 6.67, 0, 100). 15R DD → 0. */
  drawdownControl: SubScore;
  /** 100 − clamp((observedMaxLoss / expectedMaxLoss) × 50, 0, 100). */
  lossStreakControl: SubScore | null;
  /** 0–100 entropy-normalized session focus. */
  sessionDispersion: SubScore;
}

// ----- Engagement -----------------------------------------------------------

export interface EngagementParts {
  /** (daysWithAnyCheckin / windowDays) × 100. */
  checkinFillRate: SubScore;
  /** (daysWithBothSlots / daysWithAnyCheckin) × 100. */
  dualSlotRate: SubScore;
  /** clamp(streak / 30, 0, 1) × 100 (capped — no toxic gamification). */
  streakNormalized: SubScore;
  /** (eveningsWithJournalNote / eveningsFilled) × 100. */
  journalDepthRate: SubScore;
  /**
   * SPEC §21 J-T4 — training (backtest) activity sub-score. `null` when the
   * member has no recent backtest activity → `aggregateDimension`
   * renormalizes it away so non-backtesters' engagement is unaffected
   * (zero-regression invariant). 🚨 §21.5: derived from a COUNT of training
   * activity only, never a backtest P&L (`resultR`/`outcome`/`plannedRR`).
   */
  trainingActivityRate: SubScore | null;
}

/**
 * Single sub-score: the raw 0–1 rate, the points awarded after multiplying
 * by the dimension weight, and the metric's denominator (for transparency).
 */
export interface SubScore {
  /** Raw rate or normalized value, in [0, 1]. */
  rate: number;
  /** Points contributed to the dimension total (weight × rate). */
  pointsAwarded: number;
  /** Maximum points achievable for this sub-score. */
  pointsMax: number;
  /** Numerator (e.g. "23 trades with planRespected=true"). */
  numerator?: number;
  /** Denominator (e.g. "47 closed trades"). */
  denominator?: number;
}

/** All four dimension results bundled. */
export interface AllScoresResult {
  discipline: ScoreResult<DisciplineParts>;
  emotionalStability: ScoreResult<EmotionalStabilityParts>;
  consistency: ScoreResult<ConsistencyParts>;
  engagement: ScoreResult<EngagementParts>;
  /** Window in days (default 30). */
  windowDays: number;
  /** ISO timestamp the snapshot was computed at. */
  computedAt: string;
  /** Local-day anchor (YYYY-MM-DD). */
  date: string;
}

// ----- Persisted shape ------------------------------------------------------

/**
 * Shape of `BehavioralScore.components` JSON column.
 * Mirrors `AllScoresResult` minus the windowDays / dates (kept on the model).
 */
export interface ComponentsJson {
  discipline: ScoreResult<DisciplineParts>;
  emotionalStability: ScoreResult<EmotionalStabilityParts>;
  consistency: ScoreResult<ConsistencyParts>;
  engagement: ScoreResult<EngagementParts>;
}

/** Shape of `BehavioralScore.sample_size` JSON column. */
export interface SampleSizeJson {
  trades: {
    closed: number;
    computed: number;
    estimated: number;
  };
  checkins: {
    days: number;
    morningOnly: number;
    eveningOnly: number;
    bothSlots: number;
  };
  windowDays: number;
}

/** Helper used by the service to build `Prisma.InputJsonValue`. */
export function asInputJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
