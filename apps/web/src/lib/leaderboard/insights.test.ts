import { describe, expect, it } from 'vitest';

import { isLowScore, LOW_SCORE_THRESHOLD, weakestPillar } from './insights';
import type { LeaderboardParts } from './types';

const sub = (rate: number) => ({
  rate,
  pointsAwarded: rate * 10,
  pointsMax: 10,
  numerator: 0,
  denominator: 0,
});

const parts = (p: Partial<Record<keyof LeaderboardParts, number | null>>): LeaderboardParts => ({
  assiduity: p.assiduity == null ? null : sub(p.assiduity),
  discipline: p.discipline == null ? null : sub(p.discipline),
  regularity: p.regularity == null ? null : sub(p.regularity),
  work: p.work == null ? null : sub(p.work),
});

describe('weakestPillar', () => {
  it('returns the pillar with the lowest rate', () => {
    expect(
      weakestPillar(parts({ assiduity: 0.9, discipline: 0.4, regularity: 0.7, work: 0.6 })),
    ).toBe('discipline');
  });

  it('skips null pillars (never picks a surface with no data)', () => {
    expect(
      weakestPillar(parts({ assiduity: 0.8, discipline: null, regularity: 0.5, work: null })),
    ).toBe('regularity');
  });

  it('breaks ties by PILLAR_ORDER (assiduité before discipline before …)', () => {
    // assiduity and discipline both at 0.3 → assiduity wins (comes first).
    expect(
      weakestPillar(parts({ assiduity: 0.3, discipline: 0.3, regularity: 0.9, work: 0.9 })),
    ).toBe('assiduity');
  });

  it('returns null when every pillar is null (nothing to push yet)', () => {
    expect(
      weakestPillar(parts({ assiduity: null, discipline: null, regularity: null, work: null })),
    ).toBeNull();
  });

  it('ignores a non-finite rate (defensive, never poisons the min)', () => {
    expect(
      weakestPillar(parts({ assiduity: Number.NaN, discipline: 0.6, regularity: 0.9, work: 0.9 })),
    ).toBe('discipline');
  });
});

describe('isLowScore', () => {
  it('flags a ranked member strictly below the threshold', () => {
    expect(isLowScore(LOW_SCORE_THRESHOLD - 1, 'ok')).toBe(true);
    expect(isLowScore(0, 'ok')).toBe(true);
  });

  it('does NOT flag a member at or above the threshold', () => {
    expect(isLowScore(LOW_SCORE_THRESHOLD, 'ok')).toBe(false);
    expect(isLowScore(80, 'ok')).toBe(false);
  });

  it('never flags an insufficient_data member (no score to be low)', () => {
    expect(isLowScore(null, 'insufficient_data')).toBe(false);
    // Even a stray low number under insufficient_data is not an alert.
    expect(isLowScore(10, 'insufficient_data')).toBe(false);
  });

  it('never flags a null score', () => {
    expect(isLowScore(null, 'ok')).toBe(false);
  });

  it('ignores a non-finite score (defensive)', () => {
    expect(isLowScore(Number.NaN, 'ok')).toBe(false);
  });
});
