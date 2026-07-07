/**
 * Canonical types for the member Leaderboard ranking (SPEC §2 posture).
 *
 * The leaderboard ranks members on the ACT of working — showing up, keeping
 * the discipline, staying regular, doing the tracking work — NEVER on trading
 * performance / P&L. It is a HIGHER-LEVEL composite of four already-computed,
 * already-tested behavioral surfaces:
 *
 *   - assiduity   ← the `engagement` behavioral dimension (check-in fill rate,
 *                    dual-slot, streak, journal depth, meeting attendance, …)
 *   - discipline  ← the `discipline` behavioral dimension (plan respect,
 *                    routine, process completeness, intention kept, …)
 *   - regularity  ← the `ConstancyScore` regularity axis (rhythm over the
 *                    window; excused absences are NOT penalized)
 *   - work        ← the tracking-coverage gauge (breadth of self-tracking)
 *
 * 🔒 Firewall §21.5: the `consistency` dimension (expectancy / profit factor /
 * drawdown — the real-edge P&L proxy) is DELIBERATELY EXCLUDED. A member's rank
 * can never move because a trade won or lost. Enforced by
 * `test/anti-leak/leaderboard-isolation.test.ts`.
 *
 * Mirrors the `ScoreResult<Parts>` shape used by the four behavioral scores so
 * the same `aggregateDimension` renormalization and the same UI breakdown
 * ("pourquoi ce rang ?") apply unchanged.
 */

import type { Prisma } from '@/generated/prisma/client';
import type { ScoreResult, SubScore } from '@/lib/scoring/types';

/**
 * The four leaderboard pillars. Each is a `SubScore` (0–1 rate × weight) or
 * `null` when the underlying surface has insufficient data — `null` pillars are
 * renormalized away by `aggregateDimension`, so a member is never penalized for
 * a surface they could not yet fill (ADDITION PURE — same invariant as the
 * behavioral dimensions).
 */
export interface LeaderboardParts {
  /** Engagement dimension (assiduité / connexion). */
  assiduity: SubScore | null;
  /** Discipline dimension (respect du process). */
  discipline: SubScore | null;
  /** Constancy regularity axis (régularité dans la durée, absences excusées). */
  regularity: SubScore | null;
  /** Tracking coverage (travail de suivi). */
  work: SubScore | null;
}

/** A fully-built leaderboard score for one member. */
export type LeaderboardScore = ScoreResult<LeaderboardParts>;

/**
 * The full-precision composite (`precise`) — same value as `score` BEFORE the
 * integer rounding — is the leaderboard's primary RANK sort key. It is NOT a
 * field of `LeaderboardScore`: it is recomputed on demand from the persisted
 * `parts` by `preciseScoreFromParts`, so it is never written to the snapshot
 * `components` JSON and can never leak a finer-than-displayed number. See
 * `builder.ts` (`preciseScoreFromParts`) and `ranking.ts` (`RankableEntry.precise`).
 */

/**
 * Pure input to `computeLeaderboardScore`. Every pillar is a 0–100 score (or
 * `null` when its surface is insufficient) already produced by the tested
 * behavioral/coverage code — the builder only weights and renormalizes them, it
 * NEVER re-derives them from raw trades/check-ins. `activeDays` is the number of
 * days with any check-in in the window (the fairness guard for ranking).
 */
export interface LeaderboardScoreInput {
  /** `engagement` behavioral dimension score (0–100) or null. */
  engagementScore: number | null;
  /** `discipline` behavioral dimension score (0–100) or null. */
  disciplineScore: number | null;
  /** `ConstancyScore` regularity axis (0–100) or null. */
  regularityScore: number | null;
  /** Tracking-coverage gauge (0–100) or null. */
  trackingCoverage: number | null;
  /** Days with any check-in in the window — the ranking fairness guard. */
  activeDays: number;
  /**
   * Rolling window length in days. Optional (defaults to
   * `LEADERBOARD_WINDOW_DAYS`); sizes the fairness gate together with
   * `justifiedOffDays` so the min-active-days threshold reflects the member's
   * real opportunity to be active.
   */
  windowDays?: number;
  /**
   * Decision A — member-DECLARED off-days in the window (`MemberOffDay` rows,
   * the explicit, auditable justification). A justified long absence lowers the
   * min-active-days gate proportionally, so a member who showed up whenever they
   * could is RANKED rather than pushed into "qualification en cours" for days
   * they had no opportunity to be active. Undeclared gaps do NOT count here (a
   * genuinely inactive member with no justification is still gated). Optional,
   * defaults to 0 (no relaxation — identical to the pre-Decision-A behavior).
   */
  justifiedOffDays?: number;
}

/**
 * Shape of `LeaderboardSnapshot.components` JSON column. Mirrors the behavioral
 * `ComponentsJson` convention: the full `ScoreResult` so the UI can render the
 * per-pillar breakdown without a recompute.
 */
export interface LeaderboardComponentsJson {
  score: LeaderboardScore;
}

/** Shape of `LeaderboardSnapshot.sample_size` JSON column. */
export interface LeaderboardSampleSizeJson {
  /** Days with any check-in counted in the window. */
  activeDays: number;
  /** Rolling window length in days. */
  windowDays: number;
  /** Number of pillars that had enough data to contribute. */
  activePillars: number;
}

/** Helper used by the service to build `Prisma.InputJsonValue`. */
export function asLeaderboardInputJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
