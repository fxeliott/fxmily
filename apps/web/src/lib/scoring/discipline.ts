/**
 * Discipline score (SPEC §7.11).
 *
 * Discipline = "did you follow your process?" — not "did you predict the
 * market correctly?". Mark Douglas posture: this is the ONLY thing inside
 * the trader's locus of control. Outcome is probabilistic, execution is not.
 *
 * Weights (sum = 100):
 *   - planRespect     × 35  closed trades planRespected=true / total closed
 *   - hedgeRespect    × 20  trades hedgeRespected!=false / not-N/A trades
 *   - eveningPlan     × 25  evening checkins planRespectedToday=true / evenings filled
 *   - intentionFilled × 10  morning checkins intention!=null / mornings filled
 *   - routineCompleted × 10 morning checkins morningRoutineCompleted=true / mornings filled
 *
 * Sample-size guard:
 *   - 0 closed trades AND 0 evening checkins → status='insufficient_data',
 *     reason='no_trades'. The dashboard renders the disclaimer.
 *   - <10 closed trades → status='ok' but `sample.sufficient=false`
 *     (UI surfaces a "small sample" pill).
 *
 * Renormalization: a sub-score whose denominator=0 (e.g. all trades have
 * hedge=N/A) is "not applicable" — its weight is redistributed onto the
 * surviving sub-scores so the dimension still maxes out at 100.
 *
 * Reference: Mark Douglas, _Trading in the Zone_ ch.10 ("Edge requires
 * consistency of execution") + Steenbarger _Trading Psychology 2.0_ ch.4
 * (process metrics > outcome metrics).
 */

import { aggregateDimension, rateSubScore, roundScore } from './helpers';
import type { DisciplineParts, ScoreResult } from './types';

/** Closed trade fields needed to score discipline. */
export interface DisciplineTradeInput {
  closedAt: string | null;
  planRespected: boolean;
  hedgeRespected: boolean | null;
}

/** Check-in fields needed to score discipline. */
export interface DisciplineCheckinInput {
  slot: 'morning' | 'evening';
  /** Evening only. */
  planRespectedToday: boolean | null;
  /** Morning only. */
  morningRoutineCompleted: boolean | null;
  /** Morning only. */
  intention: string | null;
  /**
   * Morning only (DoD#3). Tri-state: `true` (market prep done), `false`
   * (skipped), `null` (not asked / legacy row). A prep/routine ACT — we score
   * THAT it happened, never its content (SPEC §2).
   */
  marketAnalysisDone: boolean | null;
}

export interface DisciplineInput {
  trades: readonly DisciplineTradeInput[];
  checkins: readonly DisciplineCheckinInput[];
  /** Window length used for sample-size flags. Default 30. */
  windowDays?: number;
}

/** Minimum closed trades before we trust the trade-side sub-scores. */
export const DISCIPLINE_MIN_CLOSED_TRADES = 10;
/** Minimum check-in days before we trust the check-in-side sub-scores. */
export const DISCIPLINE_MIN_CHECKIN_DAYS = 14;

const WEIGHT_PLAN = 35;
const WEIGHT_HEDGE = 20;
const WEIGHT_EVENING_PLAN = 25;
const WEIGHT_INTENTION = 10;
const WEIGHT_ROUTINE = 10;

/**
 * DoD#3 — market-analysis (morning prep) sub-score weight. Added as a PURE
 * ADDITION: the existing five weights (35/20/25/10/10) are deliberately NOT
 * rebalanced. `aggregateDimension` normalizes by the *active* `pointsMax`, so
 * when no morning checkin carries the field the part is `null` and the
 * dimension renormalizes to EXACTLY its pre-DoD#3 value — a provable zero
 * regression. Sized level with `routineCompleted`/`intentionFilled` (10):
 * market prep is a meaningful but non-dominant prep act vs plan respect (35).
 */
const WEIGHT_MARKET_ANALYSIS = 10;

export function computeDisciplineScore(input: DisciplineInput): ScoreResult<DisciplineParts> {
  const closed = input.trades.filter((t) => t.closedAt !== null);
  const morning = input.checkins.filter((c) => c.slot === 'morning');
  const evening = input.checkins.filter((c) => c.slot === 'evening');

  const closedCount = closed.length;
  const morningCount = morning.length;
  const eveningCount = evening.length;
  const checkinDays = morningCount + eveningCount;

  // Insufficient data branch — both sides empty.
  if (closedCount === 0 && checkinDays === 0) {
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'no_trades',
      parts: emptyParts(),
      sample: { trades: 0, days: 0, sufficient: false },
    };
  }

  // Plan respect on trades.
  const planRespectedCount = closed.filter((t) => t.planRespected).length;
  const planRespect = rateSubScore(planRespectedCount, closedCount, WEIGHT_PLAN);

  // Hedge respect: skip N/A (null), denominator excludes them.
  const hedgeApplicable = closed.filter((t) => t.hedgeRespected !== null);
  const hedgeRespectedCount = hedgeApplicable.filter((t) => t.hedgeRespected === true).length;
  const hedgeRespect = rateSubScore(hedgeRespectedCount, hedgeApplicable.length, WEIGHT_HEDGE);

  // Evening plan respect.
  const eveningPlanApplicable = evening.filter((c) => c.planRespectedToday !== null);
  const eveningPlanRespected = eveningPlanApplicable.filter(
    (c) => c.planRespectedToday === true,
  ).length;
  const eveningPlan = rateSubScore(
    eveningPlanRespected,
    eveningPlanApplicable.length,
    WEIGHT_EVENING_PLAN,
  );

  // Intention filled.
  const intentionFilledCount = morning.filter(
    (c) => c.intention !== null && c.intention.trim() !== '',
  ).length;
  const intentionFilled = rateSubScore(intentionFilledCount, morningCount, WEIGHT_INTENTION);

  // Routine completed.
  const routineCompletedCount = morning.filter((c) => c.morningRoutineCompleted === true).length;
  const routineCompleted = rateSubScore(routineCompletedCount, morningCount, WEIGHT_ROUTINE);

  // DoD#3 — market analysis (morning prep). Carbon-copy of routineCompleted,
  // but the denominator skips mornings where the member was NOT asked
  // (`marketAnalysisDone === null`) so a legacy/unanswered morning never
  // penalizes the rate. Numerator = mornings the prep was actually done.
  const marketAnalysisApplicable = morning.filter((c) => c.marketAnalysisDone !== null);
  const marketAnalysisDoneCount = marketAnalysisApplicable.filter(
    (c) => c.marketAnalysisDone === true,
  ).length;
  const marketAnalysisRate = rateSubScore(
    marketAnalysisDoneCount,
    marketAnalysisApplicable.length,
    WEIGHT_MARKET_ANALYSIS,
  );

  const parts: DisciplineParts = {
    planRespect,
    hedgeRespect,
    eveningPlan,
    intentionFilled,
    routineCompleted,
    // Surfaced for transparency only when the member was asked at least once;
    // `null` otherwise so the UI doesn't show a phantom 0-of-0 prep metric.
    marketAnalysisDone: marketAnalysisApplicable.length > 0 ? marketAnalysisRate : null,
  };

  // Renormalize: sub-scores whose denominator=0 are "not applicable".
  const partsForAggregate = [
    closedCount > 0 ? planRespect : null,
    hedgeApplicable.length > 0 ? hedgeRespect : null,
    eveningPlanApplicable.length > 0 ? eveningPlan : null,
    morningCount > 0 ? intentionFilled : null,
    morningCount > 0 ? routineCompleted : null,
    // DoD#3 — null-skip on the field-presence denominator: byte-identical when
    // no morning carries `marketAnalysisDone` (every pre-DoD#3 / legacy row).
    marketAnalysisApplicable.length > 0 ? marketAnalysisRate : null,
  ];

  const score = aggregateDimension(partsForAggregate);
  const sufficient =
    closedCount >= DISCIPLINE_MIN_CLOSED_TRADES || checkinDays >= DISCIPLINE_MIN_CHECKIN_DAYS;

  return {
    score: roundScore(score),
    status: 'ok',
    parts,
    sample: { trades: closedCount, days: checkinDays, sufficient },
  };
}

function emptyParts(): DisciplineParts {
  return {
    planRespect: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_PLAN,
      numerator: 0,
      denominator: 0,
    },
    hedgeRespect: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_HEDGE,
      numerator: 0,
      denominator: 0,
    },
    eveningPlan: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_EVENING_PLAN,
      numerator: 0,
      denominator: 0,
    },
    intentionFilled: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_INTENTION,
      numerator: 0,
      denominator: 0,
    },
    routineCompleted: {
      rate: 0,
      pointsAwarded: 0,
      pointsMax: WEIGHT_ROUTINE,
      numerator: 0,
      denominator: 0,
    },
    // DoD#3 — null on the insufficient-data branch (no morning data → the prep
    // act was never asked), mirroring engagement's `trainingActivityRate: null`.
    marketAnalysisDone: null,
  };
}
