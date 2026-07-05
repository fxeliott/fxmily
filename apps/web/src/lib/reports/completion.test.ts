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
      offDaysCount: 0,
      owedDays: 7,
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

  describe('Tour 14 — off-day pont', () => {
    it('excludes off days from the coverage denominator (owedDays)', () => {
      // Mon-Fri filled, Sat+Sun off → 5 owed days, 5 filled = 100 % (not 5/7).
      // 2026-06-01 is a Monday.
      const s = buildCompletionSummary({
        periodStart: '2026-06-01',
        periodEnd: '2026-06-07',
        checkins: [
          morning('2026-06-01'),
          morning('2026-06-02'),
          morning('2026-06-03'),
          morning('2026-06-04'),
          morning('2026-06-05'),
        ],
        offDays: new Set(['2026-06-06', '2026-06-07']),
      });
      expect(s.periodDays).toBe(7);
      expect(s.offDaysCount).toBe(2);
      expect(s.owedDays).toBe(5);
      expect(s.checkinDaysFilled).toBe(5);
      expect(s.checkinCoverageRate).toBe(1);
    });

    it('bridges the streak over an unfilled off weekend (Fri + off Sat/Sun + Mon = 4)', () => {
      // Filled Fri 05, off Sat 06 + Sun 07 (both unfilled), filled Mon 08 +
      // Tue 09. The unfilled off weekend is stepped over → run of 4, not 2.
      const s = buildCompletionSummary({
        periodStart: '2026-06-05',
        periodEnd: '2026-06-09',
        checkins: [morning('2026-06-05'), morning('2026-06-08'), morning('2026-06-09')],
        offDays: new Set(['2026-06-06', '2026-06-07']),
      });
      expect(s.longestStreakDays).toBe(3); // 3 filled days, bridged across the off weekend
      expect(s.owedDays).toBe(3); // 5 days − 2 off
    });

    it('an unfilled WORKING day still breaks the run (only off days bridge)', () => {
      // Fri 05 filled, Sat 06 off (unfilled, bridged), Sun 07 off (unfilled,
      // bridged), Mon 08 UNFILLED working day (break), Tue 09 filled.
      const s = buildCompletionSummary({
        periodStart: '2026-06-05',
        periodEnd: '2026-06-09',
        checkins: [morning('2026-06-05'), morning('2026-06-09')],
        offDays: new Set(['2026-06-06', '2026-06-07']),
      });
      // 05 (run 1) → off 06/07 (skipped) → 08 unfilled working (break) → 09 (run 1).
      expect(s.longestStreakDays).toBe(1);
    });

    it('a check-in filed ON an off day still counts (the rempli wins, stays owed)', () => {
      // Sat 06 is off BUT the member filed it → it is NOT removed from owedDays
      // and it counts as a filled day.
      const s = buildCompletionSummary({
        periodStart: '2026-06-06',
        periodEnd: '2026-06-07',
        checkins: [morning('2026-06-06')],
        offDays: new Set(['2026-06-06', '2026-06-07']),
      });
      expect(s.offDaysCount).toBe(1); // only the UNFILLED Sun 07 drops out
      expect(s.owedDays).toBe(1); // 2 days − 1 unfilled off
      expect(s.checkinDaysFilled).toBe(1);
      expect(s.checkinCoverageRate).toBe(1);
    });

    it('is byte-identical to pre-Tour-14 when no off days are supplied', () => {
      const base = {
        periodStart: '2026-06-01',
        periodEnd: '2026-06-07',
        checkins: [morning('2026-06-01'), morning('2026-06-03'), morning('2026-06-05')],
      };
      const withEmpty = buildCompletionSummary({ ...base, offDays: new Set() });
      const without = buildCompletionSummary(base);
      expect(withEmpty).toEqual(without);
      expect(without.owedDays).toBe(without.periodDays); // denominator unchanged
      expect(without.checkinCoverageRate).toBeCloseTo(0.4286, 4);
    });
  });
});
