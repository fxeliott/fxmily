/**
 * Pure ranking core for the leaderboard (no I/O, no `server-only`) — the
 * deterministic tie-break + dense-rank assignment, split out from the I/O
 * service so it is unit-testable in isolation (mirrors the pure `builder.ts` /
 * I/O `service.ts` split used across the scoring layer).
 */

import type { LeaderboardScore } from './types';

export interface RankableEntry {
  userId: string;
  /** Composite score 0–100, or null when the member is insufficient_data. */
  score: number | null;
  /** Tie-break #2 — raw streak (higher first). */
  streak: number;
  /** Tie-break #3 — join day (earlier first). */
  joinedAt: Date;
}

/**
 * Assign a deterministic dense rank to every entry. Ranked members (score !=
 * null) are ordered by score desc → streak desc → joinedAt asc → userId asc
 * (the order documented on `LeaderboardSnapshot.rank`). Insufficient-data members
 * keep `rank = null` (unranked, "qualification en cours"). PURE — no I/O, stable
 * (a total order via the userId final key means the result never depends on the
 * input array order).
 */
export function rankEntries<T extends RankableEntry>(
  entries: readonly T[],
): Array<T & { rank: number | null }> {
  const ranked = entries.filter((e) => e.score !== null);
  const unranked = entries.filter((e) => e.score === null);

  ranked.sort(
    (a, b) =>
      (b.score as number) - (a.score as number) ||
      b.streak - a.streak ||
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );

  return [
    ...ranked.map((e, i) => ({ ...e, rank: i + 1 })),
    ...unranked.map((e) => ({ ...e, rank: null as number | null })),
  ];
}

/** Count the pillars that actually contributed (non-null) — for the disclaimer. */
export function countActivePillars(result: LeaderboardScore): number {
  const p = result.parts;
  return [p.assiduity, p.discipline, p.regularity, p.work].filter((x) => x !== null).length;
}

/**
 * Split the VISIBLE ranked rows into the podium (true rank 1–3) and the rest
 * (rank 4+), selecting by the member's REAL `rank`, never by array position.
 *
 * This is the firewall against a subtle opt-out bug: the read layer hides
 * opted-out members from `rows` while preserving each survivor's global rank, so
 * the array is rank-ordered but can have GAPS (e.g. ranks [1, 3, 4] when the
 * rank-2 member opted out). A positional `slice(0, 3)` would then promote the
 * rank-4 member onto the podium and mislabel everyone; selecting by `rank` keeps
 * the missing step absent and every member at their honest standing. PURE — no
 * I/O, unit-tested; consumed by the `/classement` page + the `Podium` component.
 */
export function splitBoardByRank<T extends { rank: number | null }>(
  rows: readonly T[],
): { podium: T[]; rest: T[] } {
  const podium = rows.filter((r) => r.rank !== null && r.rank <= 3);
  const rest = rows.filter((r) => r.rank !== null && r.rank > 3);
  return { podium, rest };
}

// =============================================================================
// Rank movement — pure derivation from the snapshot log (no I/O)
// =============================================================================

/** Direction of a member's rank change since their previous ranked snapshot. */
export type RankDirection = 'up' | 'down' | 'same' | 'new';

/** A member's rank delta since the last board they were ranked on. */
export interface RankMovement {
  /** Rank on the previous ranked snapshot, or null when this is their first. */
  previousRank: number | null;
  /** Positions gained (positive) or lost (negative). 0 when new or unchanged. */
  delta: number;
  direction: RankDirection;
}

/**
 * Pure rank-movement derivation. A SMALLER rank number is BETTER, so a positive
 * `delta` (previousRank - currentRank) means the member climbed. Split into the
 * pure core (like {@link rankEntries}) so the movement chip and its unit tests
 * share one source of truth with zero I/O.
 */
export function computeRankMovement(
  currentRank: number | null,
  previousRank: number | null,
): RankMovement {
  if (currentRank === null) return { previousRank, delta: 0, direction: 'same' };
  if (previousRank === null) return { previousRank: null, delta: 0, direction: 'new' };
  const delta = previousRank - currentRank;
  const direction: RankDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  return { previousRank, delta, direction };
}
