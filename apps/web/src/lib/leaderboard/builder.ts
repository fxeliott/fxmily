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

/**
 * Full-precision composite recomputed from an already-built parts set — the key
 * the leaderboard RANKS on (finer than the rounded, displayed `score`) and the
 * "score exact" surfaced in the breakdown. It is `aggregateDimension` over the
 * four renormalized pillars, i.e. the SAME value `computeLeaderboardScore`
 * rounds into `score`, so the two can never disagree. Returns `null` when no
 * pillar is filled (an unranked member has no finer standing to compare), and
 * guards NaN/Infinity at the source so it is ALWAYS a finite number or null —
 * never an unsafe `Array.sort` key. PURE, no I/O.
 *
 * Kept OUT of the persisted `ScoreResult` on purpose: `precise` is a transient
 * ranking/display value, never written to the `LeaderboardSnapshot.components`
 * JSON (which stays the rounded `score` + parts), so a raw read of that column
 * can never expose a finer-than-displayed score.
 */
export function preciseScoreFromParts(parts: LeaderboardParts): number | null {
  const active = [parts.assiduity, parts.discipline, parts.regularity, parts.work];
  if (active.every((p) => p === null)) return null;
  const raw = aggregateDimension(active);
  return Number.isFinite(raw) ? raw : null;
}

/**
 * Derived fairness-gate quantities for a member — the justification-aware
 * thresholds `computeLeaderboardScore` ranks on, extracted as a PURE helper so
 * the SAME formula is the single source of truth for both the score computation
 * and the persisted sample-size JSON. The member card reads `minActiveDays` back
 * from that JSON to render the exact "X/N jours actifs — il t'en reste M"
 * qualification counter, so it must never diverge from the gate the ranking
 * actually applied. No I/O.
 *
 * Decision A (justification-aware): a member who DECLARED off-days had less
 * OPPORTUNITY to be active, so we gate on `window − justifiedOffDays` (floored at
 * 1) instead of a flat 7. A justifiably-absent member who showed up whenever they
 * could qualifies sooner (never penalized); a genuinely inactive member — few/no
 * declared off-days AND few active days — still needs the full sample and stays
 * "qualification en cours". Weekends are NOT counted here (already neutral inside
 * every pillar); only explicit `MemberOffDay` declarations relax the gate.
 *
 *   - `deepAbsence` — away for MOST of the window (`opportunity < 7`): the
 *     tracking-coverage `work` pillar, measured over a window mostly spent
 *     legitimately away, is dropped (renormalized) rather than allowed to drag
 *     the member down.
 */
export interface LeaderboardGate {
  windowDays: number;
  justifiedOffDays: number;
  opportunityDays: number;
  minActiveDays: number;
  deepAbsence: boolean;
}

export function computeLeaderboardGate(input: LeaderboardScoreInput): LeaderboardGate {
  const windowDays =
    Number.isFinite(input.windowDays) && (input.windowDays as number) > 0
      ? (input.windowDays as number)
      : LEADERBOARD_WINDOW_DAYS;
  const justifiedOffDays = Math.min(Math.max(input.justifiedOffDays ?? 0, 0), windowDays);
  const opportunityDays = Math.max(1, windowDays - justifiedOffDays);
  const minActiveDays = Math.min(LEADERBOARD_MIN_ACTIVE_DAYS, opportunityDays);
  const deepAbsence = opportunityDays < LEADERBOARD_MIN_ACTIVE_DAYS;
  return { windowDays, justifiedOffDays, opportunityDays, minActiveDays, deepAbsence };
}

export function computeLeaderboardScore(
  input: LeaderboardScoreInput,
): ScoreResult<LeaderboardParts> {
  const { minActiveDays, deepAbsence } = computeLeaderboardGate(input);

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

  // The persisted score is the rounded composite; the finer full-precision value
  // (the RANK sort key) is recomputed on demand from `parts` via
  // `preciseScoreFromParts` so it never enters the persisted ScoreResult.
  const score = aggregateDimension(partsForAggregate);
  return {
    score: roundScore(score),
    status: 'ok',
    parts,
    sample: { days: input.activeDays, sufficient: true },
  };
}
