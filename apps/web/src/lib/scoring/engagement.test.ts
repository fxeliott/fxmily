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
/** Morning check-in carrying a sleepQuality value (DoD#3). */
const MS = (date: string, sleepQuality: number | null): EngagementCheckinInput => ({
  date,
  slot: 'morning',
  journalNote: null,
  sleepQuality,
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

// ---------------------------------------------------------------------------
// SPEC §30.4 J-M4 — meeting (réunion Fxmily) attendance sub-score.
//
// ADDITION PURE (§30.7): `WEIGHT_MEETING` (15) is added EN PLUS; the existing
// five weights (50/20/20/10 + training 15) are NEVER rebalanced. A member with
// no meeting scheduled in the window scores BYTE-IDENTICALLY to pre-J-M4.
//
// CRUX (T2-2): the skip is keyed on `scheduledCount`, NOT `completedCount`
// (≠ training, which tests `count > 0`):
//   - scheduledCount === 0 (no meeting in the window)      → sub-score null →
//     `aggregateDimension` renormalizes it away           → byte-identical.
//   - scheduledCount > 0 & completedCount === 0 (had       → sub-score 0 →
//     meetings, validated none)                            → engagement DROPS
//     (the effort signal — "ne rien déclarer" ≠ "pas de réunion").
//
// Numbers below are pinned for a 14-day fullish run (windowDays 30, streak 14,
// no training), where the four check-in sub-scores are:
//   fill   = 14/30 × 50 = 23.3̄ (max 50)
//   dual   = 14/14 × 20 = 20    (max 20)
//   streak = 14/30 × 20 =  9.3̄ (max 20)
//   journal= 14/14 × 10 = 10    (max 10)
// base (no meeting) = 62.6̄ / 100 → round 63.
// ---------------------------------------------------------------------------

describe('computeEngagementScore — meeting attendance (SPEC §30.4 J-M4)', () => {
  /** 14 days, morning + evening + journal each — every check-in sub-score is
   *  fully determined, so any score delta is attributable to the meeting part
   *  alone. */
  function fullishCheckins(): EngagementCheckinInput[] {
    const cs: EngagementCheckinInput[] = [];
    for (let i = 0; i < 14; i++) {
      cs.push(M(day(i)));
      cs.push(E(day(i), 'journal'));
    }
    return cs;
  }

  it('(a) scheduledCount 0 → BYTE-IDENTICAL to the same input without meeting fields', () => {
    const checkins = fullishCheckins();
    // No meeting fields at all (state of every member before the first
    // generate-meetings cron run).
    const omitted = computeEngagementScore({ checkins, streak: 14 });
    // Explicit zeros: no meeting was scheduled in the window.
    const zero = computeEngagementScore({
      checkins,
      streak: 14,
      meetingScheduledCount: 0,
      meetingCompletedCount: 0,
    });

    // Pinned exact score (round of 62.6̄).
    expect(omitted.score).toBe(63);
    // Byte-identical: the meeting part is skipped → renormalized away.
    expect(zero.score).toBe(omitted.score);
    expect(omitted.parts.meetingAttendanceRate).toBeNull();
    expect(zero.parts.meetingAttendanceRate).toBeNull();
  });

  it('(b) scheduledCount 4, completedCount 0 → STRICTLY LOWER than case (a) (effort signal)', () => {
    const checkins = fullishCheckins();
    const base = computeEngagementScore({ checkins, streak: 14 });
    // Had 4 meetings in the window, validated none → meeting sub-score 0
    // (NOT skipped — the crux is the skip is on scheduledCount, not completed).
    const r = computeEngagementScore({
      checkins,
      streak: 14,
      meetingScheduledCount: 4,
      meetingCompletedCount: 0,
    });

    // Pinned exact score: 62.6̄ awarded over 115 active max → 54.49̄ → round 54.
    expect(r.score).toBe(54);
    expect(r.score!).toBeLessThan(base.score!);
    // The sub-score is present (NOT null) and contributes 0 points — the drop.
    expect(r.parts.meetingAttendanceRate).not.toBeNull();
    expect(r.parts.meetingAttendanceRate?.rate).toBe(0);
    expect(r.parts.meetingAttendanceRate?.pointsAwarded).toBe(0);
    expect(r.parts.meetingAttendanceRate?.pointsMax).toBe(15);
  });

  it('(c) scheduledCount 4, completedCount 4 → full WEIGHT_MEETING contribution', () => {
    const checkins = fullishCheckins();
    const base = computeEngagementScore({ checkins, streak: 14 });
    // Attended + validated all 4 → meeting sub-score at rate 1 (full 15 pts).
    const r = computeEngagementScore({
      checkins,
      streak: 14,
      meetingScheduledCount: 4,
      meetingCompletedCount: 4,
    });

    // Pinned exact score: (62.6̄ + 15) awarded over 115 active max → 67.53̄ → 68.
    expect(r.score).toBe(68);
    expect(r.score!).toBeGreaterThan(base.score!);
    expect(r.parts.meetingAttendanceRate?.rate).toBe(1);
    expect(r.parts.meetingAttendanceRate?.pointsAwarded).toBe(15);
    expect(r.parts.meetingAttendanceRate?.pointsMax).toBe(15);
  });

  it('a perfect 30-day run stays exactly 100 with full meeting attendance', () => {
    const checkins: EngagementCheckinInput[] = [];
    for (let i = 0; i < 30; i++) {
      checkins.push(M(day(i)));
      checkins.push(E(day(i), 'journal'));
    }
    // No meeting → 100 (existing contract, unchanged).
    expect(computeEngagementScore({ checkins, streak: 30 }).score).toBe(100);
    // All scheduled meetings validated + otherwise-perfect → still exactly 100.
    const r = computeEngagementScore({
      checkins,
      streak: 30,
      meetingScheduledCount: 8,
      meetingCompletedCount: 8,
    });
    expect(r.score).toBe(100);
    expect(r.parts.meetingAttendanceRate?.rate).toBe(1);
  });

  it('partial attendance sits strictly between zero and full', () => {
    const checkins = fullishCheckins();
    const none = computeEngagementScore({
      checkins,
      streak: 14,
      meetingScheduledCount: 4,
      meetingCompletedCount: 0,
    });
    const half = computeEngagementScore({
      checkins,
      streak: 14,
      meetingScheduledCount: 4,
      meetingCompletedCount: 2,
    });
    const full = computeEngagementScore({
      checkins,
      streak: 14,
      meetingScheduledCount: 4,
      meetingCompletedCount: 4,
    });
    expect(half.parts.meetingAttendanceRate?.rate).toBe(0.5);
    expect(half.score!).toBeGreaterThan(none.score!);
    expect(half.score!).toBeLessThan(full.score!);
  });

  it('clamps completedCount above scheduledCount to rate 1 (defensive, never > full)', () => {
    const checkins = fullishCheckins();
    // Should never happen (completed ≤ scheduled by construction) but the rate
    // must clamp to 1 rather than exceed the weight.
    const r = computeEngagementScore({
      checkins,
      streak: 14,
      meetingScheduledCount: 4,
      meetingCompletedCount: 99,
    });
    expect(r.parts.meetingAttendanceRate?.rate).toBe(1);
    expect(r.parts.meetingAttendanceRate?.pointsAwarded).toBe(15);
  });

  it('insufficient check-in data still short-circuits (meeting does not rescue the guard)', () => {
    const r = computeEngagementScore({
      checkins: [],
      streak: 0,
      meetingScheduledCount: 8,
      meetingCompletedCount: 8,
    });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_checkins');
    expect(r.parts.meetingAttendanceRate).toBeNull();
  });

  it('is deterministic and orthogonal to the training sub-score (both addible)', () => {
    const checkins = fullishCheckins();
    // Training AND meeting both active → both renormalize against each other,
    // each a pure addition; the result is deterministic.
    const a = computeEngagementScore({
      checkins,
      streak: 14,
      trainingActivityCount: 8,
      meetingScheduledCount: 4,
      meetingCompletedCount: 4,
    });
    const b = computeEngagementScore({
      checkins,
      streak: 14,
      trainingActivityCount: 8,
      meetingScheduledCount: 4,
      meetingCompletedCount: 4,
    });
    expect(a.score).toBe(b.score);
    expect(a.parts.trainingActivityRate).not.toBeNull();
    expect(a.parts.meetingAttendanceRate).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DoD#3 — sleep (self-care) sub-score.
//
// ADDITION PURE: `WEIGHT_SLEEP` (10) is added EN PLUS; the existing weights
// (50/20/20/10 + training 15 + meeting 15) are NEVER rebalanced. A member who
// never logs sleep quality scores BYTE-IDENTICALLY to pre-DoD#3 — the part is
// `null` and renormalized away.
//
// Anti-Black-Hat: sleep is ONLY ever a positive contribution when present —
// never a "you sleep badly" penalty by itself. The sub-score normalizes the
// average subjective quality (avg / 10) over mornings where it was answered,
// EXACTLY like `streakNormalized` builds a value sub-score from a [0,1] input.
//
// Pinned for the standard 14-day fullish run (windowDays 30, streak 14, no
// training, no meeting): the four base sub-scores award 62.6̄ / 100 → 63.
// ---------------------------------------------------------------------------

describe('computeEngagementScore — sleep self-care (DoD#3)', () => {
  function fullishCheckins(): EngagementCheckinInput[] {
    const cs: EngagementCheckinInput[] = [];
    for (let i = 0; i < 14; i++) {
      cs.push(M(day(i)));
      cs.push(E(day(i), 'journal'));
    }
    return cs;
  }
  /** Same fullish run but the morning carries a sleepQuality value. */
  function fullishWithSleep(quality: number | null): EngagementCheckinInput[] {
    const cs: EngagementCheckinInput[] = [];
    for (let i = 0; i < 14; i++) {
      cs.push(MS(day(i), quality));
      cs.push(E(day(i), 'journal'));
    }
    return cs;
  }

  it('ZERO REGRESSION — omitted ≡ all-null sleepQuality (byte-identical, part null)', () => {
    const omitted = computeEngagementScore({ checkins: fullishCheckins(), streak: 14 });
    const allNull = computeEngagementScore({ checkins: fullishWithSleep(null), streak: 14 });
    expect(omitted.score).toBe(63); // pinned pre-DoD#3 value
    expect(allNull.score).toBe(omitted.score);
    expect(omitted.parts.sleepQualityRate).toBeNull();
    expect(allNull.parts.sleepQualityRate).toBeNull();
  });

  it('present sleepQuality → non-null sub-score that lifts engagement', () => {
    const base = computeEngagementScore({ checkins: fullishCheckins(), streak: 14 });
    // Perfect quality 10 on all 14 mornings → rate 1 → full 10 pts.
    // 62.6̄ + 10 awarded over 110 active max → 66.06̄ → 66.
    const r = computeEngagementScore({ checkins: fullishWithSleep(10), streak: 14 });
    expect(r.score).toBe(66);
    expect(r.score!).toBeGreaterThan(base.score!);
    expect(r.parts.sleepQualityRate).not.toBeNull();
    expect(r.parts.sleepQualityRate?.rate).toBe(1);
    expect(r.parts.sleepQualityRate?.pointsMax).toBe(10);
    expect(r.parts.sleepQualityRate?.pointsAwarded).toBe(10);
  });

  it('mid-quality sleep produces a proportional rate', () => {
    // quality 5 / 10 = 0.5 → rate 0.5. 62.6̄ + 5 over 110 → 61.51̄ → 62.
    const r = computeEngagementScore({ checkins: fullishWithSleep(5), streak: 14 });
    expect(r.parts.sleepQualityRate?.rate).toBe(0.5);
    expect(r.score).toBe(62);
  });

  it('averages over only the mornings that answered (null mornings excluded)', () => {
    // 7 mornings quality 8, 7 mornings quality null → avg 8 over 7 days.
    const cs: EngagementCheckinInput[] = [];
    for (let i = 0; i < 7; i++) {
      cs.push(MS(day(i), 8));
      cs.push(E(day(i), 'journal'));
    }
    for (let i = 7; i < 14; i++) {
      cs.push(MS(day(i), null));
      cs.push(E(day(i), 'journal'));
    }
    const r = computeEngagementScore({ checkins: cs, streak: 14 });
    expect(r.parts.sleepQualityRate?.rate).toBe(0.8); // avg 8 / 10
    expect(r.parts.sleepQualityRate?.denominator).toBe(7); // only answered mornings
    expect(r.parts.sleepQualityRate?.numerator).toBe(56); // sum 7 × 8
  });

  it('a perfect 30-day run stays exactly 100 with full sleep quality', () => {
    const cs: EngagementCheckinInput[] = [];
    for (let i = 0; i < 30; i++) {
      cs.push(MS(day(i), 10));
      cs.push(E(day(i), 'journal'));
    }
    const r = computeEngagementScore({ checkins: cs, streak: 30 });
    expect(r.score).toBe(100);
    expect(r.parts.sleepQualityRate?.rate).toBe(1);
  });

  it('clamps an out-of-range quality and guards NaN/Infinity', () => {
    // quality 99 (out of 1–10) → avg/10 = 9.9 → clamped to rate 1.
    const over = computeEngagementScore({ checkins: fullishWithSleep(99), streak: 14 });
    expect(over.parts.sleepQualityRate?.rate).toBe(1);
    // NaN morning is filtered out → no answered morning → part null.
    const nan = computeEngagementScore({ checkins: fullishWithSleep(Number.NaN), streak: 14 });
    expect(nan.parts.sleepQualityRate).toBeNull();
  });

  it('insufficient check-in data still short-circuits (sleep does not rescue the guard)', () => {
    const r = computeEngagementScore({ checkins: [], streak: 0 });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_checkins');
    expect(r.parts.sleepQualityRate).toBeNull();
  });
});
