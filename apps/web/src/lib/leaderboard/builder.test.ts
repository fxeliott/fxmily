import { describe, expect, it } from 'vitest';

import {
  computeLeaderboardScore,
  LEADERBOARD_MIN_ACTIVE_DAYS,
  WEIGHT_ASSIDUITY,
  WEIGHT_DISCIPLINE,
  WEIGHT_REGULARITY,
  WEIGHT_WORK,
} from './builder';
import type { LeaderboardScoreInput } from './types';

const base: LeaderboardScoreInput = {
  engagementScore: 80,
  disciplineScore: 90,
  regularityScore: 70,
  trackingCoverage: 60,
  activeDays: 20,
};

describe('computeLeaderboardScore', () => {
  it('weights the four pillars sum-to-100 and averages them (no null pillar)', () => {
    const r = computeLeaderboardScore(base);
    // 0.8*35 + 0.9*30 + 0.7*20 + 0.6*15 = 28 + 27 + 14 + 9 = 78, /100 max → 78
    expect(r.status).toBe('ok');
    expect(r.score).toBe(78);
    expect(r.sample.sufficient).toBe(true);
    expect(r.sample.days).toBe(20);
  });

  it('exposes each pillar as a SubScore with the right weight and rate', () => {
    const r = computeLeaderboardScore(base);
    expect(r.parts.assiduity).toMatchObject({ rate: 0.8, pointsMax: WEIGHT_ASSIDUITY });
    expect(r.parts.discipline).toMatchObject({ rate: 0.9, pointsMax: WEIGHT_DISCIPLINE });
    expect(r.parts.regularity).toMatchObject({ rate: 0.7, pointsMax: WEIGHT_REGULARITY });
    expect(r.parts.work).toMatchObject({ rate: 0.6, pointsMax: WEIGHT_WORK });
  });

  it('the four weights sum to 100', () => {
    expect(WEIGHT_ASSIDUITY + WEIGHT_DISCIPLINE + WEIGHT_REGULARITY + WEIGHT_WORK).toBe(100);
  });

  it('renormalizes null pillars away (never fabricates a 0 for a missing surface)', () => {
    // work surface absent → score is the weighted avg of the 3 present pillars.
    const r = computeLeaderboardScore({ ...base, trackingCoverage: null });
    // awarded = 28 + 27 + 14 = 69 ; activeMax = 35 + 30 + 20 = 85 → 69/85*100 = 81.18 → 81
    expect(r.parts.work).toBeNull();
    expect(r.score).toBe(81);
    expect(r.status).toBe('ok');
  });

  it('a member scoring 0 everywhere is NOT the same as a member with no data', () => {
    const zero = computeLeaderboardScore({
      engagementScore: 0,
      disciplineScore: 0,
      regularityScore: 0,
      trackingCoverage: 0,
      activeDays: 20,
    });
    expect(zero.status).toBe('ok');
    expect(zero.score).toBe(0);
  });

  it('returns no_checkins (unranked) when there is no activity at all', () => {
    const r = computeLeaderboardScore({ ...base, activeDays: 0 });
    expect(r.score).toBeNull();
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('no_checkins');
    expect(r.sample.sufficient).toBe(false);
  });

  it('returns window_short (unranked) below the minimum active-days threshold', () => {
    const r = computeLeaderboardScore({ ...base, activeDays: LEADERBOARD_MIN_ACTIVE_DAYS - 1 });
    expect(r.score).toBeNull();
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('window_short');
  });

  it('ranks exactly at the minimum threshold', () => {
    const r = computeLeaderboardScore({ ...base, activeDays: LEADERBOARD_MIN_ACTIVE_DAYS });
    expect(r.status).toBe('ok');
    expect(r.score).toBe(78);
  });

  it('is insufficient_data when every pillar is null even with enough days', () => {
    const r = computeLeaderboardScore({
      engagementScore: null,
      disciplineScore: null,
      regularityScore: null,
      trackingCoverage: null,
      activeDays: 20,
    });
    expect(r.score).toBeNull();
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('window_short');
  });

  it('clamps out-of-range pillar scores into [0,100]', () => {
    const r = computeLeaderboardScore({
      engagementScore: 150,
      disciplineScore: -20,
      regularityScore: 100,
      trackingCoverage: 100,
      activeDays: 20,
    });
    expect(r.parts.assiduity?.rate).toBe(1); // 150 clamped to 1
    expect(r.parts.discipline?.rate).toBe(0); // -20 clamped to 0
    // awarded = 35 + 0 + 20 + 15 = 70 / 100 → 70
    expect(r.score).toBe(70);
  });

  it('ignores NaN pillars (treated as missing, renormalized)', () => {
    const r = computeLeaderboardScore({ ...base, trackingCoverage: Number.NaN });
    expect(r.parts.work).toBeNull();
    expect(r.score).toBe(81);
  });

  it('is a pure function (same input → same output, no mutation)', () => {
    const input: LeaderboardScoreInput = { ...base };
    const snapshot = JSON.stringify(input);
    const a = computeLeaderboardScore(input);
    const b = computeLeaderboardScore(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('always produces a score within [0,100] across a fuzz sweep', () => {
    for (let e = 0; e <= 100; e += 25) {
      for (let d = 0; d <= 100; d += 25) {
        for (let g = 0; g <= 100; g += 50) {
          const r = computeLeaderboardScore({
            engagementScore: e,
            disciplineScore: d,
            regularityScore: g,
            trackingCoverage: 50,
            activeDays: 20,
          });
          expect(r.score).not.toBeNull();
          expect(r.score as number).toBeGreaterThanOrEqual(0);
          expect(r.score as number).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('computeLeaderboardScore — Decision A (justified long absence not penalized)', () => {
  it('ranks a member justifiably absent most of the window who showed up whenever they could', () => {
    // 26 declared off-days in a 30-day window → opportunity = 4 days; the member
    // was active all 5 of the days they could be. A flat-7 gate would exile them
    // to "qualification en cours"; the justification-aware gate ranks them.
    const r = computeLeaderboardScore({
      ...base,
      activeDays: 5,
      windowDays: 30,
      justifiedOffDays: 26,
    });
    expect(r.status).toBe('ok');
    expect(r.score).not.toBeNull();
  });

  it('drops the work pillar in a deep justified absence (coverage over the full window is not representative)', () => {
    // opportunity = 4 < MIN(7) → deep-absence regime: work (tracking coverage over
    // 30 days, 26 of them absent) is renormalized away instead of dragging them.
    // awarded = 0.8*35 + 0.9*30 + 0.7*20 = 69 ; activeMax = 85 → 69/85*100 = 81.
    const r = computeLeaderboardScore({
      ...base,
      activeDays: 5,
      windowDays: 30,
      justifiedOffDays: 26,
    });
    expect(r.parts.work).toBeNull();
    expect(r.score).toBe(81);
  });

  it('does NOT rank a genuinely inactive member (few active days, no declared off-days)', () => {
    // Same low activeDays but ZERO justification → still gated at the full 7.
    const r = computeLeaderboardScore({
      ...base,
      activeDays: 5,
      windowDays: 30,
      justifiedOffDays: 0,
    });
    expect(r.score).toBeNull();
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('window_short');
  });

  it('keeps the full gate + the work pillar for a MODERATE justified absence', () => {
    // 10 off-days → opportunity 20 (not deep) → gate stays 7, work pillar kept.
    const r = computeLeaderboardScore({
      ...base,
      activeDays: 8,
      windowDays: 30,
      justifiedOffDays: 10,
    });
    expect(r.status).toBe('ok');
    expect(r.parts.work).not.toBeNull();
    expect(r.score).toBe(78); // identical to the no-absence baseline
  });

  it('relaxed threshold is exact: one below the opportunity floor stays unranked', () => {
    const opportunity4 = { ...base, windowDays: 30, justifiedOffDays: 26 }; // floor = 4
    expect(computeLeaderboardScore({ ...opportunity4, activeDays: 4 }).status).toBe('ok');
    expect(computeLeaderboardScore({ ...opportunity4, activeDays: 3 }).status).toBe(
      'insufficient_data',
    );
  });

  it('clamps justifiedOffDays (negative → 0, above the window → window)', () => {
    // negative treated as 0 → genuinely inactive, still gated.
    expect(
      computeLeaderboardScore({ ...base, activeDays: 3, windowDays: 30, justifiedOffDays: -5 })
        .status,
    ).toBe('insufficient_data');
    // absurdly large clamps to windowDays → opportunity floor 1 → any activity ranks.
    expect(
      computeLeaderboardScore({ ...base, activeDays: 1, windowDays: 30, justifiedOffDays: 999 })
        .status,
    ).toBe('ok');
  });

  it('defaults (no windowDays / justifiedOffDays) reproduce the pre-Decision-A gate exactly', () => {
    expect(
      computeLeaderboardScore({ ...base, activeDays: LEADERBOARD_MIN_ACTIVE_DAYS - 1 }).status,
    ).toBe('insufficient_data');
    expect(
      computeLeaderboardScore({ ...base, activeDays: LEADERBOARD_MIN_ACTIVE_DAYS }).status,
    ).toBe('ok');
  });
});
