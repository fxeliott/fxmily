import { describe, expect, it } from 'vitest';

import {
  computeTrainingDebriefStats,
  selectWeekTrades,
  type TrainingDebriefStatTrade,
} from './stats';

/**
 * SPEC §23.3 — pure process-stats aggregator. TDD: empty week, the 4 families,
 * the Europe/Paris civil-day window boundary (invariant §23.7 — a backtest at
 * 00:30 Paris belongs to its Paris day, NOT the UTC one), annotation clamp.
 *
 * Reference week: 2026-05-11 (Monday) → 2026-05-17 (Sunday). May = CEST
 * (Europe/Paris = UTC+2).
 */

const WEEK = '2026-05-11';

function trade(
  p: Partial<TrainingDebriefStatTrade> & { enteredAt: string },
): TrainingDebriefStatTrade {
  return {
    id: p.id ?? `t_${p.enteredAt}`,
    enteredAt: p.enteredAt,
    pair: p.pair ?? 'EURUSD',
    systemRespected: p.systemRespected ?? null,
    lessonLearned: p.lessonLearned ?? 'Lesson.',
  };
}

describe('selectWeekTrades — Europe/Paris civil-day window (§23.7)', () => {
  it('keeps a backtest whose Paris civil day is the Monday even if its UTC date is the prior Sunday', () => {
    // 2026-05-10T22:30Z = 2026-05-11 00:30 Paris (CEST) → Monday, IN week.
    const t = trade({ enteredAt: '2026-05-10T22:30:00.000Z' });
    expect(selectWeekTrades([t], WEEK)).toHaveLength(1);
  });

  it('drops a backtest whose Paris civil day is the next Monday', () => {
    // 2026-05-17T22:30Z = 2026-05-18 00:30 Paris → Monday next week, OUT.
    const t = trade({ enteredAt: '2026-05-17T22:30:00.000Z' });
    expect(selectWeekTrades([t], WEEK)).toHaveLength(0);
  });

  it('drops a backtest from the previous Sunday', () => {
    // 2026-05-10T21:30Z = 2026-05-10 23:30 Paris → Sunday prior week, OUT.
    const t = trade({ enteredAt: '2026-05-10T21:30:00.000Z' });
    expect(selectWeekTrades([t], WEEK)).toHaveLength(0);
  });
});

describe('selectWeekTrades — CET winter boundary (§23.7, other DST regime)', () => {
  // Pins the loader fetch-slack reasoning for CET (UTC+1). Week 2026-01-05
  // (Monday) → 2026-01-11 (Sunday). January = CET.
  const W = '2026-01-05';

  it('keeps Monday 00:30 Paris-CET even though its UTC date is the prior Sunday', () => {
    // 2026-01-04T23:30Z = 2026-01-05 00:30 Paris (CET=UTC+1) → Monday, IN.
    expect(selectWeekTrades([trade({ enteredAt: '2026-01-04T23:30:00.000Z' })], W)).toHaveLength(1);
  });

  it('keeps Sunday 23:30 Paris-CET (last in-week instant)', () => {
    // 2026-01-11T22:30Z = 2026-01-11 23:30 Paris → Sunday, IN.
    expect(selectWeekTrades([trade({ enteredAt: '2026-01-11T22:30:00.000Z' })], W)).toHaveLength(1);
  });

  it('drops the next Monday 00:30 Paris-CET', () => {
    // 2026-01-11T23:30Z = 2026-01-12 00:30 Paris → next Monday, OUT.
    expect(selectWeekTrades([trade({ enteredAt: '2026-01-11T23:30:00.000Z' })], W)).toHaveLength(0);
  });

  it('drops the prior Sunday 23:30 Paris-CET', () => {
    // 2026-01-04T22:30Z = 2026-01-04 23:30 Paris → Sunday prior week, OUT.
    expect(selectWeekTrades([trade({ enteredAt: '2026-01-04T22:30:00.000Z' })], W)).toHaveLength(0);
  });
});

describe('computeTrainingDebriefStats — empty week (§23.4 pedagogical, never score-0)', () => {
  it('0 backtest → zeroed families, longestGap = full week, no negative', () => {
    const s = computeTrainingDebriefStats([], 0, WEEK);
    expect(s.weekStart).toBe(WEEK);
    expect(s.volume).toEqual({
      backtestCount: 0,
      distinctDays: 0,
      longestGapDays: 7,
      perWeekday: [0, 0, 0, 0, 0, 0, 0],
    });
    expect(s.systemRespect).toEqual({ respected: 0, notRespected: 0, unspecified: 0 });
    expect(s.diversity).toEqual({ distinctPairs: 0 });
    expect(s.lessons).toEqual({ lessonsCount: 0, annotationsCount: 0 });
  });
});

describe('computeTrainingDebriefStats — Family 1 volume & régularité', () => {
  it('counts backtests, distinct Paris days, and the longest no-practice run', () => {
    const trades = [
      trade({ enteredAt: '2026-05-11T08:00:00.000Z' }), // Mon
      trade({ enteredAt: '2026-05-11T15:00:00.000Z' }), // Mon (same day)
      trade({ enteredAt: '2026-05-13T09:00:00.000Z' }), // Wed
      trade({ enteredAt: '2026-05-14T09:00:00.000Z' }), // Thu
    ];
    const s = computeTrainingDebriefStats(trades, 0, WEEK);
    // Mon✓ Tue✗ Wed✓ Thu✓ Fri✗ Sat✗ Sun✗ → longest empty run = Fri+Sat+Sun = 3.
    expect(s.volume).toEqual({
      backtestCount: 4,
      distinctDays: 3,
      longestGapDays: 3,
      perWeekday: [2, 0, 1, 1, 0, 0, 0],
    });
  });

  it('practice every day → longestGap 0, distinctDays 7', () => {
    const trades = Array.from({ length: 7 }, (_, i) =>
      trade({ enteredAt: `2026-05-${String(11 + i).padStart(2, '0')}T10:00:00.000Z` }),
    );
    const s = computeTrainingDebriefStats(trades, 0, WEEK);
    expect(s.volume).toEqual({
      backtestCount: 7,
      distinctDays: 7,
      longestGapDays: 0,
      perWeekday: [1, 1, 1, 1, 1, 1, 1],
    });
  });

  it('excludes out-of-window candidates before counting', () => {
    const trades = [
      trade({ enteredAt: '2026-05-11T10:00:00.000Z' }), // in
      trade({ enteredAt: '2026-05-01T10:00:00.000Z' }), // way before
      trade({ enteredAt: '2026-06-01T10:00:00.000Z' }), // way after
    ];
    const s = computeTrainingDebriefStats(trades, 0, WEEK);
    expect(s.volume.backtestCount).toBe(1);
  });
});

describe('computeTrainingDebriefStats — Family 2 respect du système (tri-state)', () => {
  it('partitions respected / not / unspecified', () => {
    const trades = [
      trade({ enteredAt: '2026-05-11T10:00:00.000Z', systemRespected: true }),
      trade({ enteredAt: '2026-05-12T10:00:00.000Z', systemRespected: true }),
      trade({ enteredAt: '2026-05-13T10:00:00.000Z', systemRespected: false }),
      trade({ enteredAt: '2026-05-14T10:00:00.000Z', systemRespected: null }),
    ];
    const s = computeTrainingDebriefStats(trades, 0, WEEK);
    expect(s.systemRespect).toEqual({ respected: 2, notRespected: 1, unspecified: 1 });
  });
});

describe('computeTrainingDebriefStats — Family 3 diversité', () => {
  it('counts distinct non-empty pairs', () => {
    const trades = [
      trade({ enteredAt: '2026-05-11T10:00:00.000Z', pair: 'EURUSD' }),
      trade({ enteredAt: '2026-05-12T10:00:00.000Z', pair: 'EURUSD' }),
      trade({ enteredAt: '2026-05-13T10:00:00.000Z', pair: 'XAUUSD' }),
      trade({ enteredAt: '2026-05-14T10:00:00.000Z', pair: 'NAS100' }),
    ];
    const s = computeTrainingDebriefStats(trades, 0, WEEK);
    expect(s.diversity.distinctPairs).toBe(3);
  });
});

describe('computeTrainingDebriefStats — Family 4 leçons & corrections', () => {
  it('counts non-empty lessons and echoes a clamped annotation count', () => {
    const trades = [
      trade({ enteredAt: '2026-05-11T10:00:00.000Z', lessonLearned: 'Patience.' }),
      trade({ enteredAt: '2026-05-12T10:00:00.000Z', lessonLearned: '   ' }), // blank → not counted
      trade({ enteredAt: '2026-05-13T10:00:00.000Z', lessonLearned: 'Cut fast.' }),
    ];
    const s = computeTrainingDebriefStats(trades, 5, WEEK);
    expect(s.lessons).toEqual({ lessonsCount: 2, annotationsCount: 5 });
  });

  it('clamps a negative / fractional annotation count to a non-negative integer', () => {
    const s1 = computeTrainingDebriefStats([], -3, WEEK);
    expect(s1.lessons.annotationsCount).toBe(0);
    const s2 = computeTrainingDebriefStats([], 2.9, WEEK);
    expect(s2.lessons.annotationsCount).toBe(2);
  });
});

describe('§21.5 — output structurally carries no backtest P&L', () => {
  it('the stats object exposes only the 4 process families (no resultR/outcome)', () => {
    const s = computeTrainingDebriefStats(
      [trade({ enteredAt: '2026-05-11T10:00:00.000Z' })],
      1,
      WEEK,
    );
    const json = JSON.stringify(s);
    expect(json).not.toContain('resultR');
    expect(json).not.toContain('outcome');
    expect(json).not.toContain('plannedRR');
    expect(Object.keys(s).sort()).toEqual(
      ['diversity', 'lessons', 'systemRespect', 'volume', 'weekStart'].sort(),
    );
  });
});
