import { describe, expect, it } from 'vitest';

import { computeEngagementScore, type EngagementCheckinInput } from './engagement';

const M = (date: string): EngagementCheckinInput => ({
  date,
  slot: 'morning',
  journalNote: null,
});
const E = (date: string, journal: string | null = null): EngagementCheckinInput => ({
  date,
  slot: 'evening',
  journalNote: journal,
});

const day = (i: number) => `2026-01-${String(i + 1).padStart(2, '0')}`;

describe('computeEngagementScore', () => {
  it('returns no_checkins when no check-ins exist', () => {
    const r = computeEngagementScore({ checkins: [], streak: 0 });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_checkins');
  });

  it('returns window_short when fewer than 7 days with any check-in', () => {
    const checkins = Array.from({ length: 5 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 5 });
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('window_short');
    expect(r.sample.days).toBe(5);
  });

  it('returns ok with full score for a perfect 30-day dual-slot run', () => {
    const checkins: EngagementCheckinInput[] = [];
    for (let i = 0; i < 30; i++) {
      checkins.push(M(day(i)));
      checkins.push(E(day(i), 'journal'));
    }
    const r = computeEngagementScore({ checkins, streak: 30 });
    expect(r.score).toBe(100);
    expect(r.status).toBe('ok');
  });

  it('caps streak normalization at 30 days (no toxic gamification)', () => {
    const checkins: EngagementCheckinInput[] = [];
    for (let i = 0; i < 30; i++) {
      checkins.push(M(day(i)));
      checkins.push(E(day(i), 'journal'));
    }
    const r1 = computeEngagementScore({ checkins, streak: 30 });
    const r2 = computeEngagementScore({ checkins, streak: 100 });
    // Streak ≥ 30 caps the streak sub-score; both should yield the same result.
    expect(r1.parts.streakNormalized.rate).toBe(1);
    expect(r2.parts.streakNormalized.rate).toBe(1);
    expect(r1.score).toBe(r2.score);
  });

  it('rewards check-in fill rate proportionally', () => {
    // 15 / 30 days with morning only → fill 0.5
    const checkins = Array.from({ length: 15 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 0 });
    expect(r.parts.checkinFillRate.rate).toBe(0.5);
  });

  it('rewards dual-slot rate over morning-only', () => {
    const morningOnly: EngagementCheckinInput[] = [];
    const dualSlot: EngagementCheckinInput[] = [];
    for (let i = 0; i < 14; i++) {
      morningOnly.push(M(day(i)));
      dualSlot.push(M(day(i)));
      dualSlot.push(E(day(i)));
    }
    const r1 = computeEngagementScore({ checkins: morningOnly, streak: 14 });
    const r2 = computeEngagementScore({ checkins: dualSlot, streak: 14 });
    expect(r1.parts.dualSlotRate.rate).toBe(0);
    expect(r2.parts.dualSlotRate.rate).toBe(1);
    expect(r2.score).toBeGreaterThan(r1.score!);
  });

  it('skips journalDepth when no evenings exist (renormalize)', () => {
    const checkins = Array.from({ length: 14 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 14 });
    // Active sub-scores: fill (0.467 → 23.33), dualSlot (0/14=0), streak (14/30 → 9.33)
    // skipped: journalDepth, dualSlotRate kept (denom>0 → 0)
    expect(r.parts.journalDepthRate.numerator).toBe(0);
    expect(r.parts.journalDepthRate.denominator).toBe(0);
  });

  it('treats whitespace-only journal as not filled', () => {
    const checkins = Array.from({ length: 14 }, (_, i) => E(day(i), '  '));
    const r = computeEngagementScore({ checkins, streak: 14 });
    expect(r.parts.journalDepthRate.numerator).toBe(0);
    expect(r.parts.journalDepthRate.denominator).toBe(14);
    expect(r.parts.journalDepthRate.rate).toBe(0);
  });

  it('counts a single date with both slots as one day-with-any', () => {
    const checkins = [M(day(0)), E(day(0))];
    const r = computeEngagementScore({ checkins, streak: 1 });
    expect(r.sample.days).toBe(1);
    expect(r.status).toBe('insufficient_data'); // <7 days
  });

  it('respects custom windowDays parameter', () => {
    // 7 days filled out of 7-day window → fill rate = 1
    const checkins = Array.from({ length: 7 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 7, windowDays: 7 });
    expect(r.parts.checkinFillRate.rate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SPEC §21 J-T4 — training (backtest) activity sub-score.
//
// 🚨 STATISTICAL ISOLATION (§21.5): engagement may consume ONLY a count of
// recent training activity (effort/volume), NEVER a backtest P&L. The pure
// fn takes a single integer `trainingActivityCount` — there is no type by
// which `resultR` / `outcome` / `plannedRR` could cross this boundary.
//
// ZERO-REGRESSION INVARIANT: a member with no training activity (the state
// of all 30 V1 members at deploy — TrainingTrade table is empty) gets a
// `null` training sub-score, which `aggregateDimension` renormalizes away →
// the engagement score is byte-identical to pre-J-T4. The score only starts
// reflecting training once the member actually backtests.
// ---------------------------------------------------------------------------

describe('computeEngagementScore — training activity (SPEC §21 J-T4)', () => {
  /** 14 days, morning+evening+journal each — every check-in sub-score is
   *  fully determined so any score delta is attributable to the training
   *  part alone. */
  function fullishCheckins(): EngagementCheckinInput[] {
    const cs: EngagementCheckinInput[] = [];
    for (let i = 0; i < 14; i++) {
      cs.push(M(day(i)));
      cs.push(E(day(i), 'journal'));
    }
    return cs;
  }

  it('ZERO REGRESSION — omitted ≡ count 0 (byte-identical score, training part null)', () => {
    // Under `exactOptionalPropertyTypes`, `trainingActivityCount` is either
    // absent or a number — explicit `undefined` is not a reachable input.
    // "Absent" (the state of all 30 V1 members at deploy) and an explicit
    // `0` must both leave the training part null and the score untouched.
    const checkins = fullishCheckins();
    const omitted = computeEngagementScore({ checkins, streak: 14 });
    const zero = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 0 });

    expect(zero.score).toBe(omitted.score);
    // Renormalized away → non-backtesters wholly unaffected.
    expect(omitted.parts.trainingActivityRate).toBeNull();
    expect(zero.parts.trainingActivityRate).toBeNull();
  });

  it('preserves the perfect-run 100 boundary BOTH with and without training', () => {
    const checkins: EngagementCheckinInput[] = [];
    for (let i = 0; i < 30; i++) {
      checkins.push(M(day(i)));
      checkins.push(E(day(i), 'journal'));
    }
    // No training → 100 (existing contract, unchanged).
    expect(computeEngagementScore({ checkins, streak: 30 }).score).toBe(100);
    // At-target practice + otherwise-perfect → still exactly 100 (every
    // active part, training included, at rate 1).
    const r = computeEngagementScore({ checkins, streak: 30, trainingActivityCount: 8 });
    expect(r.score).toBe(100);
    expect(r.parts.trainingActivityRate?.rate).toBe(1);
  });

  it('count>0 produces a non-null sub-score; score is monotonic non-decreasing in count', () => {
    const checkins = fullishCheckins();
    const c2 = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 2 });
    const c4 = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 4 });
    const c8 = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 8 });

    expect(c2.parts.trainingActivityRate).not.toBeNull();
    expect(c2.parts.trainingActivityRate?.pointsAwarded).toBeGreaterThan(0);
    // More practice never lowers engagement (numerator ↑, denominator fixed
    // once the part is active).
    expect(c4.score!).toBeGreaterThanOrEqual(c2.score!);
    expect(c8.score!).toBeGreaterThanOrEqual(c4.score!);
  });

  it('caps the training sub-score at the activity target (no toxic grind incentive)', () => {
    const checkins = fullishCheckins();
    const atTarget = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 8 });
    const wayOver = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 999 });
    expect(atTarget.parts.trainingActivityRate?.rate).toBe(1);
    expect(wayOver.parts.trainingActivityRate?.rate).toBe(1);
    expect(atTarget.score).toBe(wayOver.score);
  });

  it('depends ONLY on the integer count (deterministic — no hidden P&L channel)', () => {
    const checkins = fullishCheckins();
    const a = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 5 });
    const b = computeEngagementScore({ checkins, streak: 14, trainingActivityCount: 5 });
    expect(a.score).toBe(b.score);
    expect(a.parts.trainingActivityRate).toEqual(b.parts.trainingActivityRate);
  });

  it('insufficient check-in data still short-circuits (training does not rescue the guard)', () => {
    // 0 check-ins → no_checkins regardless of training activity.
    const r = computeEngagementScore({ checkins: [], streak: 0, trainingActivityCount: 20 });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_checkins');
    expect(r.parts.trainingActivityRate).toBeNull();
  });
});
