/**
 * Leaderboard public surface (SPEC §2 — rank the ACT, never the P&L).
 *
 * The pure builder + ranking core are firewall-tested by
 * `test/anti-leak/leaderboard-isolation.test.ts`; the service is the I/O layer
 * consumed by the cron + the `/classement` page + the featuring widgets.
 */

export {
  computeLeaderboardScore,
  LEADERBOARD_MIN_ACTIVE_DAYS,
  LEADERBOARD_WINDOW_DAYS,
  WEIGHT_ASSIDUITY,
  WEIGHT_DISCIPLINE,
  WEIGHT_REGULARITY,
  WEIGHT_WORK,
} from './builder';
export { countActivePillars, rankEntries, type RankableEntry } from './ranking';
export {
  getLeaderboardBoard,
  getMyLeaderboardRank,
  recomputeLeaderboard,
  type LeaderboardBoardView,
  type LeaderboardRecomputeResult,
  type LeaderboardRowView,
  type MyLeaderboardRank,
} from './service';
export type { LeaderboardParts, LeaderboardScore, LeaderboardScoreInput } from './types';
