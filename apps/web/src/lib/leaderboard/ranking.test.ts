import { describe, expect, it } from 'vitest';

import {
  computeRankMovement,
  countActivePillars,
  podiumThresholdScore,
  rankEntries,
  splitBoardByRank,
} from './ranking';
import type { LeaderboardScore } from './types';

const d = (iso: string) => new Date(iso);

describe('rankEntries', () => {
  it('orders by score desc and assigns dense ranks 1..N', () => {
    const out = rankEntries([
      { userId: 'a', score: 70, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 90, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'c', score: 80, streak: 5, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => [e.userId, e.rank])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('breaks score ties by streak desc', () => {
    const out = rankEntries([
      { userId: 'a', score: 80, streak: 3, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 80, streak: 9, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => e.userId)).toEqual(['b', 'a']);
  });

  it('ranks by the PRECISE composite BEFORE streak: same displayed score, higher precise wins "au détail près"', () => {
    // Both members display "84", but a's true composite (84.4) beats b's (83.6).
    // Without precise, b's much longer streak would wrongly put it first; precise
    // orders them by their real finer standing, exactly what "au détail près" means.
    const out = rankEntries([
      { userId: 'a', score: 84, precise: 84.4, streak: 1, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 84, precise: 83.6, streak: 9, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => [e.userId, e.rank])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('falls back to streak only when the precise composites are exactly equal', () => {
    const out = rankEntries([
      { userId: 'a', score: 84, precise: 84.2, streak: 3, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 84, precise: 84.2, streak: 9, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => e.userId)).toEqual(['b', 'a']);
  });

  it('without precise, falls back to the rounded score (legacy callers unchanged)', () => {
    const out = rankEntries([
      { userId: 'a', score: 70, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 90, streak: 5, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => e.userId)).toEqual(['b', 'a']);
  });

  it('a non-finite precise (NaN) never corrupts the sort: falls back to the rounded score', () => {
    // Defense-in-depth: `??` would NOT catch NaN and a NaN comparator return
    // silently scrambles Array.sort. The finite-guarded key ignores the NaN and
    // ranks b (score 90) above a (score 70), the honest rounded-score order.
    const out = rankEntries([
      { userId: 'a', score: 70, precise: Number.NaN, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 90, precise: Number.NaN, streak: 5, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => [e.userId, e.rank])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
  });

  it('breaks score+streak ties by earlier joinedAt', () => {
    const out = rankEntries([
      { userId: 'a', score: 80, streak: 5, joinedAt: d('2026-02-01') },
      { userId: 'b', score: 80, streak: 5, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => e.userId)).toEqual(['b', 'a']);
  });

  it('breaks a full tie by userId asc (total order → stable)', () => {
    const out = rankEntries([
      { userId: 'zeta', score: 80, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'alpha', score: 80, streak: 5, joinedAt: d('2026-01-01') },
    ]);
    expect(out.map((e) => e.userId)).toEqual(['alpha', 'zeta']);
  });

  it('puts insufficient_data (null score) members last with rank=null', () => {
    const out = rankEntries([
      { userId: 'new', score: null, streak: 0, joinedAt: d('2026-06-01') },
      { userId: 'a', score: 50, streak: 2, joinedAt: d('2026-01-01') },
    ]);
    expect(out).toEqual([
      { userId: 'a', score: 50, streak: 2, joinedAt: d('2026-01-01'), rank: 1 },
      { userId: 'new', score: null, streak: 0, joinedAt: d('2026-06-01'), rank: null },
    ]);
  });

  it('is order-independent (same set → same ranking)', () => {
    const set = [
      { userId: 'a', score: 70, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 90, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'c', score: null, streak: 0, joinedAt: d('2026-01-01') },
    ];
    const forward = rankEntries(set).map((e) => [e.userId, e.rank]);
    const reversed = rankEntries([...set].reverse()).map((e) => [e.userId, e.rank]);
    expect(forward).toEqual(reversed);
  });

  it('does not mutate the input array', () => {
    const set = [
      { userId: 'a', score: 70, streak: 5, joinedAt: d('2026-01-01') },
      { userId: 'b', score: 90, streak: 5, joinedAt: d('2026-01-01') },
    ];
    const snapshot = set.map((e) => e.userId).join(',');
    rankEntries(set);
    expect(set.map((e) => e.userId).join(',')).toBe(snapshot);
  });

  it('handles an empty board', () => {
    expect(rankEntries([])).toEqual([]);
  });
});

describe('countActivePillars', () => {
  const sub = { rate: 0.5, pointsAwarded: 10, pointsMax: 20 };
  const make = (parts: LeaderboardScore['parts']): LeaderboardScore => ({
    score: 50,
    status: 'ok',
    parts,
    sample: { days: 20, sufficient: true },
  });

  it('counts all four when present', () => {
    expect(
      countActivePillars(make({ assiduity: sub, discipline: sub, regularity: sub, work: sub })),
    ).toBe(4);
  });

  it('skips null pillars', () => {
    expect(
      countActivePillars(make({ assiduity: sub, discipline: null, regularity: sub, work: null })),
    ).toBe(2);
  });

  it('returns 0 when every pillar is null', () => {
    expect(
      countActivePillars(make({ assiduity: null, discipline: null, regularity: null, work: null })),
    ).toBe(0);
  });
});

describe('computeRankMovement', () => {
  it('reports a climb: a SMALLER rank number is a positive delta (up)', () => {
    // previous 5th → current 2nd = +3 places gained.
    expect(computeRankMovement(2, 5)).toEqual({ previousRank: 5, delta: 3, direction: 'up' });
  });

  it('reports a slip: a LARGER rank number is a negative delta (down)', () => {
    // previous 2nd → current 5th = 3 places lost.
    expect(computeRankMovement(5, 2)).toEqual({ previousRank: 2, delta: -3, direction: 'down' });
  });

  it('reports an unchanged rank as same with delta 0', () => {
    expect(computeRankMovement(3, 3)).toEqual({ previousRank: 3, delta: 0, direction: 'same' });
  });

  it('reports a first-ever ranked appearance as new (no previous snapshot)', () => {
    expect(computeRankMovement(4, null)).toEqual({
      previousRank: null,
      delta: 0,
      direction: 'new',
    });
  });

  it('reports a member who fell out of the ranking as dropped (was ranked, now not)', () => {
    // Previously 7th, now unranked: complacent off-days shrank the rolling
    // window back below the gate. Surfaced honestly as 'dropped' (J3), never
    // masked as a neutral 'same'/"Stable".
    expect(computeRankMovement(null, 7)).toEqual({
      previousRank: 7,
      delta: 0,
      direction: 'dropped',
    });
  });

  it('reports a never-ranked member as same (no previous rank, no movement to show)', () => {
    expect(computeRankMovement(null, null)).toEqual({
      previousRank: null,
      delta: 0,
      direction: 'same',
    });
  });

  it('reaching rank 1 from rank 2 is a single-place climb', () => {
    expect(computeRankMovement(1, 2)).toEqual({ previousRank: 2, delta: 1, direction: 'up' });
  });
});

describe('splitBoardByRank', () => {
  const row = (rank: number | null) => ({ userId: `u${rank}`, rank });

  it('splits a full board into podium (rank 1-3) and the rest (rank 4+)', () => {
    const { podium, rest } = splitBoardByRank([row(1), row(2), row(3), row(4), row(5)]);
    expect(podium.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rest.map((r) => r.rank)).toEqual([4, 5]);
  });

  it('selects by TRUE rank, not position: a hidden rank-2 leaves a gap, never promotes rank-4', () => {
    // Opt-out scenario: the rank-2 member is hidden, so the visible array is
    // [1, 3, 4, 5] — a positional slice(0,3) would wrongly crown rank-4.
    const { podium, rest } = splitBoardByRank([row(1), row(3), row(4), row(5)]);
    expect(podium.map((r) => r.rank)).toEqual([1, 3]);
    expect(rest.map((r) => r.rank)).toEqual([4, 5]);
    // The rank-4 member is NEVER on the podium.
    expect(podium.some((r) => r.rank === 4)).toBe(false);
  });

  it('handles two hidden podium members: only rank 1 stays on the podium', () => {
    // ranks 2 and 3 hidden → visible [1, 4, 5].
    const { podium, rest } = splitBoardByRank([row(1), row(4), row(5)]);
    expect(podium.map((r) => r.rank)).toEqual([1]);
    expect(rest.map((r) => r.rank)).toEqual([4, 5]);
  });

  it('handles a short board (fewer than 3 ranked) with an empty rest', () => {
    const { podium, rest } = splitBoardByRank([row(1), row(2)]);
    expect(podium.map((r) => r.rank)).toEqual([1, 2]);
    expect(rest).toEqual([]);
  });

  it('drops null-rank rows from both podium and rest', () => {
    const { podium, rest } = splitBoardByRank([row(1), row(null), row(4)]);
    expect(podium.map((r) => r.rank)).toEqual([1]);
    expect(rest.map((r) => r.rank)).toEqual([4]);
  });

  it('handles an empty board', () => {
    expect(splitBoardByRank([])).toEqual({ podium: [], rest: [] });
  });
});

describe('podiumThresholdScore', () => {
  const row = (rank: number | null, score: number | null) => ({ userId: `u${rank}`, rank, score });

  it('returns the score of the member holding TRUE rank 3 (nominal contiguous board)', () => {
    expect(podiumThresholdScore([row(1, 90), row(2, 80), row(3, 70), row(4, 60), row(5, 50)])).toBe(
      70,
    );
  });

  it('stays honest when the rank-3 member is OPTED-OUT: the row is retained, so the threshold holds', () => {
    // Opt-out members are kept in the input (only hidden from the visible `rows`),
    // so the rank-3 holder's score still powers the gap line for everyone below.
    expect(podiumThresholdScore([row(1, 90), row(2, 80), row(3, 70), row(4, 60)])).toBe(70);
  });

  it('goes null in the suspend/delete gap where rank 3 is dropped (ranks [1,2,4,5])', () => {
    // The rank-3 holder was suspended/deleted between the nightly recompute and
    // this read → no visible rank 3 → null → the card suppresses the gap line
    // (generic fallback) instead of mislabelling the rank-4 score as "3rd place".
    expect(podiumThresholdScore([row(1, 90), row(2, 80), row(4, 60), row(5, 50)])).toBeNull();
  });

  it('reads rank 3 by real rank, NOT position: a dropped rank-2 (ranks [1,3,4]) still returns rank 3', () => {
    // The exact bug a positional `rows[2]` had: with rank-2 gone the array is
    // [1, 3, 4] and index 2 is the rank-4 member, but rank 3 IS present at index 1.
    // Keying on the real rank returns rank-3's score (70), never rank-4's (60).
    expect(podiumThresholdScore([row(1, 90), row(3, 70), row(4, 60)])).toBe(70);
  });

  it('returns null when fewer than three members are ranked (no podium threshold yet)', () => {
    expect(podiumThresholdScore([row(1, 90), row(2, 80)])).toBeNull();
  });

  it('ignores null-rank (insufficient_data) rows when locating rank 3', () => {
    expect(podiumThresholdScore([row(1, 90), row(2, 80), row(3, 70), row(null, null)])).toBe(70);
  });

  it('handles an empty board', () => {
    expect(podiumThresholdScore([])).toBeNull();
  });
});
