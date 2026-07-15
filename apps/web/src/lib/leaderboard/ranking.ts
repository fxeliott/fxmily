/**
 * Pure ranking core for the leaderboard (no I/O, no `server-only`) — the
 * deterministic tie-break + dense-rank assignment, split out from the I/O
 * service so it is unit-testable in isolation (mirrors the pure `builder.ts` /
 * I/O `service.ts` split used across the scoring layer).
 */

import type { LeaderboardScore } from './types';

export interface RankableEntry {
  userId: string;
  /** Rounded composite score 0–100 (display/persistence), or null when the
   * member is insufficient_data. Determines ranked vs unranked; the ORDER of
   * ranked members is driven by `precise` (below) when present. */
  score: number | null;
  /**
   * Full-precision composite (pre-rounding) — the PRIMARY sort key, so two
   * members whose displayed integer `score` collides (e.g. 84.4 vs 83.6, both
   * shown "84") are still ranked "au détail près" by their true finer standing
   * instead of falling straight to the coarse streak tie-break. Optional: when
   * omitted the sort falls back to `score` (identical to the pre-precision
   * behavior — keeps callers that don't carry it working unchanged).
   */
  precise?: number | null;
  /** Tie-break #2 (after the precise composite) — raw streak (higher first). */
  streak: number;
  /** Tie-break #3 — join day (earlier first). */
  joinedAt: Date;
}

/**
 * Assign a deterministic dense rank to every entry. Ranked members (score !=
 * null) are ordered by precise-composite desc → streak desc → joinedAt asc →
 * userId asc (the order documented on `LeaderboardSnapshot.rank`). The precise
 * composite is the full-precision score before rounding, so members who tie on
 * the DISPLAYED integer are separated by their real finer standing; `score` is
 * used as the fallback key when `precise` is absent. Insufficient-data members
 * keep `rank = null` (unranked, "qualification en cours"). PURE — no I/O, stable
 * (a total order via the userId final key means the result never depends on the
 * input array order).
 */
export function rankEntries<T extends RankableEntry>(
  entries: readonly T[],
): Array<T & { rank: number | null }> {
  const ranked = entries.filter((e) => e.score !== null);
  const unranked = entries.filter((e) => e.score === null);

  // Sort key: prefer the full-precision composite (finer than the rounded
  // `score`), falling back to `score` when a caller does not carry `precise`.
  // Both branches are `Number.isFinite`-guarded: a NaN/Infinity would corrupt
  // `Array.sort` SILENTLY (comparator returns NaN → undefined order), so an
  // unexpected non-finite key collapses to 0 rather than poisoning the ranking.
  // `??` alone does NOT catch NaN, hence the explicit finite checks.
  const sortScore = (e: RankableEntry): number => {
    if (e.precise != null && Number.isFinite(e.precise)) return e.precise;
    return e.score != null && Number.isFinite(e.score) ? e.score : 0;
  };
  ranked.sort(
    (a, b) =>
      sortScore(b) - sortScore(a) ||
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

/**
 * The podium ENTRY THRESHOLD — the score of the member holding TRUE `rank === 3`,
 * or null when no such member is currently visible. It powers the "il te manque N
 * points pour entrer dans le top 3" gap line for off-podium members.
 *
 * Keyed on the REAL rank, never a positional `rows[2]`, for the SAME reason
 * {@link splitBoardByRank} keys on rank: the read layer drops suspended/deleted
 * members at read time and hides opted-out ones, so the rank-ordered array can
 * have GAPS (ranks [1, 2, 4, …] when the rank-3 holder is gone, or [1, 3, 4, …]
 * when rank-2 is gone). A positional `rows[2]` would then read the WRONG member's
 * score — the rank-4 member in the first gap, and even mislabel it as "3rd place"
 * in the second gap where the real rank-3 member is present at index 1 — pointing
 * the gap line at a score that is not the podium threshold (and, when the reader
 * IS that member, at their own score → a nonsensical "il te manque 0 point").
 *
 * Opted-out members are RETAINED in the input here (they hold a real rank and a
 * real threshold score), so the line stays honest when the rank-3 holder is
 * merely hidden. It goes null only in the transient suspend/delete gap, where the
 * exact threshold is genuinely undefined until the next nightly recompute
 * re-ranks the now-active set contiguously — and the consumer suppresses the line
 * (generic fallback) on null. Coherent-by-construction with `splitBoardByRank`:
 * both surfaces read the same real rank. PURE — no I/O, unit-tested.
 */
export function podiumThresholdScore<T extends { rank: number | null; score: number | null }>(
  rows: readonly T[],
): number | null {
  return rows.find((r) => r.rank === 3)?.score ?? null;
}

// =============================================================================
// Rank movement — pure derivation from the snapshot log (no I/O)
// =============================================================================

/**
 * Direction of a member's rank change since their previous ranked snapshot.
 * `dropped` = they held a rank before and hold none now (fell out of the board).
 */
export type RankDirection = 'up' | 'down' | 'same' | 'new' | 'dropped';

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
 *
 * When the current rank is null the member is not ranked on this board: if they
 * HELD a rank before (`previousRank !== null`) they FELL OUT of the ranking —
 * surfaced honestly as `dropped` (J3: complacent off-days must be visible, never
 * masked as a neutral "Stable"). A member who was never ranked has no movement
 * to show and collapses to `same`.
 */
export function computeRankMovement(
  currentRank: number | null,
  previousRank: number | null,
): RankMovement {
  if (currentRank === null) {
    const direction: RankDirection = previousRank === null ? 'same' : 'dropped';
    return { previousRank, delta: 0, direction };
  }
  if (previousRank === null) return { previousRank: null, delta: 0, direction: 'new' };
  const delta = previousRank - currentRank;
  const direction: RankDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  return { previousRank, delta, direction };
}
