import { describe, expect, it } from 'vitest';

import { buildCompletionSummary, type CompletionDay } from './completion';

/**
 * Completion + continuity aggregator (S6 §32-3).
 *
 * Invariants under test:
 *   - `periodDays` = inclusive calendar-day span (DST-proof via UTC ordinals).
 *   - coverage = distinct check-in days / periodDays, CLAMPED to [0,1].
 *   - `routineDaysCompleted` counts ONLY `morningRoutineCompleted === true`
 *     (a `null`/`false` is never coerced into a completion).
 *   - `longestStreakDays` = longest CONSECUTIVE-day run (0 on empty).
 *   - `hasActivity` gates the renderer (false ⇒ pedagogical empty state).
 */

function morning(date: string, routine: boolean | null = null): CompletionDay {
  return { date, slot: 'morning', morningRoutineCompleted: routine };
}
function evening(date: string): CompletionDay {
  return { date, slot: 'evening', morningRoutineCompleted: null };
}

describe('buildCompletionSummary', () => {
  it('returns an honest empty snapshot on a period with no check-ins', () => {
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      checkins: [],
    });
    expect(s).toEqual({
      periodDays: 7,
      checkinDaysFilled: 0,
      checkinCoverageRate: 0,
      morningCheckinsCount: 0,
      eveningCheckinsCount: 0,
      routineDaysCompleted: 0,
      longestStreakDays: 0,
      hasActivity: false,
    });
  });

  it('counts a 7-day inclusive week and full coverage', () => {
    const checkins = [
      morning('2026-06-01'),
      morning('2026-06-02'),
      morning('2026-06-03'),
      morning('2026-06-04'),
      morning('2026-06-05'),
      morning('2026-06-06'),
      morning('2026-06-07'),
    ];
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      checkins,
    });
    expect(s.periodDays).toBe(7);
    expect(s.checkinDaysFilled).toBe(7);
    expect(s.checkinCoverageRate).toBe(1);
    expect(s.longestStreakDays).toBe(7);
    expect(s.hasActivity).toBe(true);
  });

  it('dedupes morning+evening of the same day into one active day', () => {
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      checkins: [morning('2026-06-01'), evening('2026-06-01'), morning('2026-06-02')],
    });
    expect(s.checkinDaysFilled).toBe(2);
    expect(s.morningCheckinsCount).toBe(2);
    expect(s.eveningCheckinsCount).toBe(1);
    expect(s.longestStreakDays).toBe(2);
  });

  it('computes the LONGEST consecutive run, not the total count', () => {
    // Days 1-2-3 (run of 3), gap on 4, then 5-6 (run of 2). Longest = 3.
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      checkins: [
        morning('2026-06-01'),
        morning('2026-06-02'),
        morning('2026-06-03'),
        morning('2026-06-05'),
        morning('2026-06-06'),
      ],
    });
    expect(s.checkinDaysFilled).toBe(5);
    expect(s.longestStreakDays).toBe(3);
  });

  it('handles unordered input (streak is order-independent)', () => {
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      checkins: [morning('2026-06-12'), morning('2026-06-10'), morning('2026-06-11')],
    });
    expect(s.longestStreakDays).toBe(3);
    expect(s.checkinDaysFilled).toBe(3);
  });

  it('counts routine days only when morningRoutineCompleted === true', () => {
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      checkins: [
        morning('2026-06-01', true),
        morning('2026-06-02', false),
        morning('2026-06-03', null),
        morning('2026-06-04', true),
      ],
    });
    expect(s.checkinDaysFilled).toBe(4);
    expect(s.routineDaysCompleted).toBe(2); // only the two `true` days
  });

  it('counts a routine day once even with both slots present', () => {
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      checkins: [
        morning('2026-06-01', true),
        { date: '2026-06-01', slot: 'evening', morningRoutineCompleted: true },
      ],
    });
    expect(s.routineDaysCompleted).toBe(1);
  });

  it('clamps coverage to 1 when check-ins exceed the period (defensive)', () => {
    // Two days but a degenerate single-day period — coverage must not exceed 1.
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-01',
      checkins: [morning('2026-06-01'), morning('2026-06-02')],
    });
    expect(s.periodDays).toBe(1);
    expect(s.checkinCoverageRate).toBe(1);
  });

  it('computes a partial coverage rate honestly (3/7)', () => {
    const s = buildCompletionSummary({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      checkins: [morning('2026-06-01'), morning('2026-06-03'), morning('2026-06-05')],
    });
    expect(s.checkinDaysFilled).toBe(3);
    expect(s.periodDays).toBe(7);
    expect(s.checkinCoverageRate).toBeCloseTo(0.4286, 4);
    expect(s.longestStreakDays).toBe(1); // all isolated days
  });

  it('spans a 30-day month inclusive and a DST boundary without drift', () => {
    // March 2026 spans the EU DST spring-forward (29 Mar); UTC ordinals keep
    // the inclusive span at exactly 31 days regardless.
    const s = buildCompletionSummary({
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      checkins: [morning('2026-03-28'), morning('2026-03-29'), morning('2026-03-30')],
    });
    expect(s.periodDays).toBe(31);
    expect(s.longestStreakDays).toBe(3);
  });
});
