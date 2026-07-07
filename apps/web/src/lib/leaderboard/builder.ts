/**
 * Leaderboard score builder (SPEC §2 posture — measure the ACT, never the P&L).
 *
 * The ranking answers ONE question: "who does the work?" — who shows up, who
 * keeps the discipline, who stays regular over time, who does the tracking
 * work. It is a deterministic composite (ZERO IA, fully reproducible) of four
 * already-computed, already-tested surfaces, weighted and renormalized with the
 * exact same primitives (`valueSubScore` / `aggregateDimension` / `roundScore`)
 * the four behavioral dimensions use.
 *
 * Weights (sum = 100):
 *   - assiduity  × 35  — the `engagement` dimension (connexion / habitude)
 *   - discipline × 30  — the `discipline` dimension (respect du process)
 *   - regularity × 20  — the `ConstancyScore` regularity axis (durée, absences
 *                        excusées non pénalisées)
 *   - work       × 15  — the tracking-coverage gauge (travail de suivi)
 *
 * Why a composite of dimensions rather than a re-derivation from raw signals:
 *   1. ZERO double-count — streak, meeting, journal, plan-respect etc. already
 *      live INSIDE the engagement/discipline dimensions; re-adding them as
 *      separate pillars would count the same act twice. The four pillars are
 *      four DISTINCT axes (habit / process / rhythm / coverage).
 *   2. Best-calc — it stands on validated scores instead of a fragile parallel
 *      re-implementation that could drift from the tested dimension logic.
 *   3. Transparent — each pillar is independently explainable to the member
 *      ("ton rang = assiduité 82 · discipline 90 · régularité 75 · travail 60").
 *
 * 🔒 Firewall §21.5: the `consistency` dimension (expectancy / profit factor /
 * drawdown — the real edge) is NEVER an input. A member's rank cannot move
 * because a trade won or lost. Enforced by `leaderboard-isolation.test.ts`.
 *
 * Renormalization (ADDITION PURE): a pillar whose surface has insufficient data
 * is `null`; `aggregateDimension` normalizes by the *active* `pointsMax`, so a
 * member is scored only on the pillars they could fill — never penalized for a
 * surface that does not yet apply to them.
 *
 * Fairness guard: a member with fewer than `LEADERBOARD_MIN_ACTIVE_DAYS` days of
 * activity (or zero contributing pillar) is `insufficient_data` — unranked and
 * shown as "qualification en cours", never dumped at rank 0.
 *
 * Decision A (justified long absence): the min-active-days gate is sized to the
 * member's real OPPORTUNITY to be active (`windowDays − justifiedOffDays`, where
 * `justifiedOffDays` counts explicit `MemberOffDay` declarations only). A member
 * who declared a long absence and showed up whenever they could is RANKED, never
 * penalized; a genuinely inactive member (few active days, no justification) is
 * still gated. In a DEEP justified absence the tracking-coverage `work` pillar —
 * measured over a window mostly spent legitimately away — is dropped
 * (renormalized), never allowed to drag the member down.
 */

import { aggregateDimension, roundScore, valueSubScore } from '@/lib/scoring/helpers';
import type { ScoreResult, SubScore } from '@/lib/scoring/types';

import type { LeaderboardParts, LeaderboardScoreInput } from './types';

/** Rolling window (days) the leaderboard is computed over. Mirrors scoring. */
export const LEADERBOARD_WINDOW_DAYS = 30;

/**
 * Minimum days with any check-in before a member is ranked. Mirrors
 * `ENGAGEMENT_MIN_DAYS` (7): fewer days is too small a sample to rank fairly
 * against a member with a full month of history. Below it the member is
 * `insufficient_data` (unranked, "qualification en cours"). Tunable.
 */
export const LEADERBOARD_MIN_ACTIVE_DAYS = 7;

/** Pillar weights (sum = 100). Named constants so they are trivially tunable. */
export const WEIGHT_ASSIDUITY = 35;
export const WEIGHT_DISCIPLINE = 30;
export const WEIGHT_REGULARITY = 20;
export const WEIGHT_WORK = 15;

/** The behavioral/coverage inputs are 0–100; sub-scores want a 0–1 rate. */
const SCORE_SCALE = 100;

/**
 * Turn a 0–100 pillar score into a `SubScore`, or `null` when the surface has
 * no data (renormalized away by `aggregateDimension`). `valueSubScore` already
 * clamps the [0,1] rate, so an out-of-range input is bounded, not trusted.
 */
function pillar(score: number | null | undefined, weight: number): SubScore | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return valueSubScore(score / SCORE_SCALE, weight, {
    numerator: Math.round(score),
    denominator: SCORE_SCALE,
  });
}

export function computeLeaderboardScore(
  input: LeaderboardScoreInput,
): ScoreResult<LeaderboardParts> {
  // Decision A — justification-aware fairness gate. A member who DECLARED off-days
  // (`justifiedOffDays`) had less OPPORTUNITY to be active; gate on the days they
  // could realistically have shown up (window − justified off-days) instead of a
  // flat 7. So a justifiably-absent member who showed up whenever they could is
  // ranked (never penalized), while a genuinely inactive member — few/no declared
  // off-days AND few active days — still needs the full sample and stays
  // "qualification en cours". Weekends are NOT counted here (they are already
  // neutral inside every pillar); only explicit `MemberOffDay` declarations relax
  // the gate. Clamped so the guard can never divide the opportunity to zero.
  const windowDays =
    Number.isFinite(input.windowDays) && (input.windowDays as number) > 0
      ? (input.windowDays as number)
      : LEADERBOARD_WINDOW_DAYS;
  const justifiedOffDays = Math.min(Math.max(input.justifiedOffDays ?? 0, 0), windowDays);
  const opportunityDays = Math.max(1, windowDays - justifiedOffDays);
  const minActiveDays = Math.min(LEADERBOARD_MIN_ACTIVE_DAYS, opportunityDays);
  // Deep-absence regime: the member was justifiably away for MOST of the window,
  // so tracking-coverage measured over the full window (absent days read as
  // "no work") is not representative → drop the work pillar (renormalized away)
  // rather than let it drag them. Same "never penalize an inapplicable surface"
  // invariant as a natively-null pillar; only triggers for a genuine long absence.
  const deepAbsence = opportunityDays < LEADERBOARD_MIN_ACTIVE_DAYS;

  const assiduity = pillar(input.engagementScore, WEIGHT_ASSIDUITY);
  const discipline = pillar(input.disciplineScore, WEIGHT_DISCIPLINE);
  const regularity = pillar(input.regularityScore, WEIGHT_REGULARITY);
  const work = deepAbsence ? null : pillar(input.trackingCoverage, WEIGHT_WORK);

  const parts: LeaderboardParts = { assiduity, discipline, regularity, work };
  const partsForAggregate = [assiduity, discipline, regularity, work];
  const activePillars = partsForAggregate.filter((p) => p !== null).length;

  // Fairness guard 1 — no activity at all: unranked, not rank 0.
  if (!Number.isFinite(input.activeDays) || input.activeDays <= 0) {
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'no_checkins',
      parts,
      sample: { days: 0, sufficient: false },
    };
  }
  // Fairness guard 2 — too short a track record (relaxed by justified absence,
  // see above), or no pillar could be filled.
  if (input.activeDays < minActiveDays || activePillars === 0) {
    return {
      score: null,
      status: 'insufficient_data',
      reason: 'window_short',
      parts,
      sample: { days: input.activeDays, sufficient: false },
    };
  }

  const score = aggregateDimension(partsForAggregate);
  return {
    score: roundScore(score),
    status: 'ok',
    parts,
    sample: { days: input.activeDays, sufficient: true },
  };
}
