import { describe, expect, it } from 'vitest';

import {
  computeWeeklyRecap,
  type WeeklyRecapCounters,
  type WeeklyRecapMetric,
} from './weekly-recap-card';

// -----------------------------------------------------------------------------
// Helpers — synthesize counter slices. The aggregator is pure and DB-free, so
// tests need no DB mock (carbone weekly-insight-card.test.ts style).
// -----------------------------------------------------------------------------

function counters(over: Partial<WeeklyRecapCounters> = {}): WeeklyRecapCounters {
  return {
    tradesTotal: 0,
    planRespectRate: null,
    streakDays: 0,
    eveningCheckinsCount: 0,
    ...over,
  };
}

/** Find a metric by key in a `recap` result (throws on the empty state). */
function metric(
  result: ReturnType<typeof computeWeeklyRecap>,
  key: WeeklyRecapMetric['key'],
): WeeklyRecapMetric {
  if (result.kind !== 'recap') throw new Error(`expected recap, got ${result.kind}`);
  const m = result.metrics.find((x) => x.key === key);
  if (!m) throw new Error(`metric ${key} not found`);
  return m;
}

describe('computeWeeklyRecap — activity gate (honest empty state)', () => {
  it('insufficient when this week has no activity at all (no fabricated 0s)', () => {
    const res = computeWeeklyRecap(counters(), counters({ tradesTotal: 5 }));
    expect(res.kind).toBe('insufficient');
  });

  it('active with a single check-in day → real recap, not insufficient', () => {
    const res = computeWeeklyRecap(counters({ streakDays: 1 }), null);
    expect(res.kind).toBe('recap');
  });

  it('active with a single trade → real recap', () => {
    const res = computeWeeklyRecap(counters({ tradesTotal: 1 }), null);
    expect(res.kind).toBe('recap');
  });
});

describe('computeWeeklyRecap — delta direction (anti-Black-Hat: never red)', () => {
  const prev = counters({
    tradesTotal: 5,
    planRespectRate: 0.65,
    streakDays: 4,
    eveningCheckinsCount: 4,
  });

  it('a rising metric is green (direction up) with a positive delta', () => {
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 8, planRespectRate: 0.75, streakDays: 6, eveningCheckinsCount: 6 }),
      prev,
    );
    const plan = metric(res, 'planRespect');
    expect(plan.direction).toBe('up');
    expect(plan.delta).toBe(10); // 75 − 65 percentage POINTS, like the email
    expect(plan.deltaDisplay).toBe('+10 pts');

    const trades = metric(res, 'trades');
    expect(trades.direction).toBe('up');
    expect(trades.delta).toBe(3);
    expect(trades.deltaDisplay).toBe('+3');
  });

  it('a falling metric is NEUTRAL grey (direction down), never a red/punitive state', () => {
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 2, planRespectRate: 0.5, streakDays: 2, eveningCheckinsCount: 2 }),
      prev,
    );
    const plan = metric(res, 'planRespect');
    // Down is still surfaced as a calm fact — the component renders it grey, the
    // pure layer only flags the direction; CRUCIALLY it is never a third "red".
    expect(plan.direction).toBe('down');
    expect(plan.delta).toBe(-15); // 50 − 65
    expect(plan.deltaDisplay).toBe('−15 pts'); // real minus sign, signed

    const trades = metric(res, 'trades');
    expect(trades.direction).toBe('down');
    expect(trades.deltaDisplay).toBe('−3');
  });

  it('an unchanged metric is flat with an "=" delta', () => {
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 5, planRespectRate: 0.65, streakDays: 4, eveningCheckinsCount: 4 }),
      prev,
    );
    expect(metric(res, 'trades').direction).toBe('flat');
    expect(metric(res, 'trades').deltaDisplay).toBe('=');
    expect(metric(res, 'planRespect').direction).toBe('flat');
    expect(metric(res, 'streak').deltaDisplay).toBe('= j');
  });
});

describe('computeWeeklyRecap — statistical integrity (no fabricated delta)', () => {
  it('no previous week → values shown but every delta is null (first week)', () => {
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 8, planRespectRate: 0.75, streakDays: 6, eveningCheckinsCount: 6 }),
      null,
    );
    if (res.kind !== 'recap') throw new Error('expected recap');
    expect(res.hasPreviousWeek).toBe(false);
    for (const m of res.metrics) {
      expect(m.delta).toBeNull();
      expect(m.deltaDisplay).toBeNull();
      expect(m.direction).toBe('none');
    }
    // …but the current values are still rendered honestly.
    expect(metric(res, 'trades').display).toBe('8');
    expect(metric(res, 'planRespect').display).toBe('75 %');
    expect(metric(res, 'streak').display).toBe('6 j');
  });

  it('a null plan-respect rate is NEVER read as 0 % (this week unmeasured)', () => {
    // This week: trades exist but none CLOSED → planRespectRate null. Last week
    // measured 65 %. We must NOT invent "0 % (−65)" — show "—" with no delta.
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 3, planRespectRate: null, streakDays: 3 }),
      counters({ planRespectRate: 0.65, streakDays: 4 }),
    );
    const plan = metric(res, 'planRespect');
    expect(plan.display).toBe('—');
    expect(plan.delta).toBeNull();
    expect(plan.deltaDisplay).toBeNull();
    expect(plan.direction).toBe('none');
  });

  it('a null PREVIOUS plan-respect rate yields no delta (last week unmeasured)', () => {
    // This week measured, last week null → no comparable baseline, no delta.
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 3, planRespectRate: 0.8, streakDays: 3 }),
      counters({ planRespectRate: null, streakDays: 4 }),
    );
    const plan = metric(res, 'planRespect');
    expect(plan.display).toBe('80 %');
    expect(plan.delta).toBeNull();
    expect(plan.deltaDisplay).toBeNull();
  });

  it('rate delta is rounded in POINTS, mirroring the email (75% vs 71% → +4 pts)', () => {
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 4, planRespectRate: 0.754 }),
      counters({ planRespectRate: 0.714 }),
    );
    const plan = metric(res, 'planRespect');
    // round(75.4)=75, round(71.4)=71 → +4. (Not the raw 0.04 relative diff.)
    expect(plan.delta).toBe(4);
    expect(plan.display).toBe('75 %');
  });
});

describe('computeWeeklyRecap — shape & ordering', () => {
  it('always returns the 4 metrics in canonical order', () => {
    const res = computeWeeklyRecap(counters({ tradesTotal: 1 }), null);
    if (res.kind !== 'recap') throw new Error('expected recap');
    expect(res.metrics.map((m) => m.key)).toEqual(['trades', 'planRespect', 'streak', 'journal']);
  });

  it('streak/journal counts render with their units and deltas', () => {
    const res = computeWeeklyRecap(
      counters({ tradesTotal: 1, streakDays: 7, eveningCheckinsCount: 5 }),
      counters({ streakDays: 5, eveningCheckinsCount: 2 }),
    );
    expect(metric(res, 'streak').display).toBe('7 j');
    expect(metric(res, 'streak').deltaDisplay).toBe('+2 j');
    expect(metric(res, 'journal').display).toBe('5');
    expect(metric(res, 'journal').deltaDisplay).toBe('+3');
  });
});
