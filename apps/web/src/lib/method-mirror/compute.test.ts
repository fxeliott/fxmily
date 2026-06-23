import { describe, expect, it } from 'vitest';

import { computeMethodMirror, MIN_ENTERED, type MethodRuleKey, type MirrorTrade } from './compute';

/**
 * S24 — pure method-fidelity mirror. Fixtures use explicit UTC instants and we
 * reason in Europe/Paris (the method's fixed schedule). Summer = UTC+2, winter =
 * UTC+1, asserted so the `Intl`-based hour/day reads are proven DST-safe.
 */

const ruleByKey = (m: ReturnType<typeof computeMethodMirror>, key: MethodRuleKey) => {
  const r = m.rules.find((x) => x.key === key);
  if (!r) throw new Error(`rule ${key} missing`);
  return r;
};

describe('computeMethodMirror — each hard rule (summer, Paris = UTC+2)', () => {
  // T1 Day A: entered Paris 14h, closed 17h same day, RR3.
  // T2 Day B: entered Paris 14h, closed 22h same day (after the 20h cut), RR3.
  // T3 Day B: entered Paris 11h (out of window), closed NEXT day (overnight), RR2.
  const trades: MirrorTrade[] = [
    {
      enteredAt: new Date('2026-06-10T12:00:00Z'),
      closedAt: new Date('2026-06-10T15:00:00Z'),
      plannedRR: 3,
    },
    {
      enteredAt: new Date('2026-06-11T12:00:00Z'),
      closedAt: new Date('2026-06-11T20:00:00Z'),
      plannedRR: 3,
    },
    {
      enteredAt: new Date('2026-06-11T09:00:00Z'),
      closedAt: new Date('2026-06-12T08:00:00Z'),
      plannedRR: 2,
    },
  ];
  const mirror = computeMethodMirror(trades, 30);

  it('window 13h–16h: 2 of 3 entries in window', () => {
    const r = ruleByKey(mirror, 'window');
    expect([r.good, r.total, r.rate]).toEqual([2, 3, 67]);
  });

  it('one trade per day: 1 of 2 trading days compliant (Day B had two)', () => {
    const r = ruleByKey(mirror, 'oneADay');
    expect([r.good, r.total, r.rate]).toEqual([1, 2, 50]);
  });

  it('20h cut / 0 overnight: only the same-day-before-20h close counts', () => {
    const r = ruleByKey(mirror, 'cut');
    // T1 ok ; T2 closed 22h (>20h) breach ; T3 closed next day (overnight) breach.
    expect([r.good, r.total, r.rate]).toEqual([1, 3, 33]);
  });

  it('targeting RR ≥ 3: 2 of 3 planned at RR3+', () => {
    const r = ruleByKey(mirror, 'targetRR');
    expect([r.good, r.total, r.rate]).toEqual([2, 3, 67]);
  });

  it('reports the sample and does not mirror below MIN_ENTERED', () => {
    expect(mirror.sampleEntered).toBe(3);
    expect(mirror.hasEnough).toBe(false); // 3 < MIN_ENTERED
  });
});

describe('computeMethodMirror — winter DST (Paris = UTC+1, January)', () => {
  it('a Paris-14h entry (13:00Z in winter) still counts as in-window', () => {
    const trades: MirrorTrade[] = [
      {
        enteredAt: new Date('2026-01-15T13:00:00Z'), // Paris 14:00
        closedAt: new Date('2026-01-15T17:00:00Z'), // Paris 18:00
        plannedRR: 3,
      },
    ];
    const m = computeMethodMirror(trades, 30);
    expect(ruleByKey(m, 'window').good).toBe(1);
    expect(ruleByKey(m, 'cut').good).toBe(1); // 18h < 20h, same day
  });
});

describe('computeMethodMirror — guards', () => {
  it('empty input → every rate is null, never fabricated', () => {
    const m = computeMethodMirror([], 30);
    expect(m.rules.every((r) => r.rate === null && r.good === 0 && r.total === 0)).toBe(true);
    expect(m.hasEnough).toBe(false);
    expect(m.sampleEntered).toBe(0);
  });

  it('hasEnough flips true at MIN_ENTERED entered trades', () => {
    // Five distinct-day in-window entries, none closed.
    const trades: MirrorTrade[] = Array.from({ length: MIN_ENTERED }, (_, i) => ({
      enteredAt: new Date(`2026-06-${String(10 + i).padStart(2, '0')}T12:00:00Z`), // Paris 14h
      closedAt: null,
      plannedRR: 3,
    }));
    const m = computeMethodMirror(trades, 30);
    expect(m.hasEnough).toBe(true);
    expect(ruleByKey(m, 'window').rate).toBe(100);
    expect(ruleByKey(m, 'oneADay').rate).toBe(100); // 5 days, 1 each
    expect(ruleByKey(m, 'cut').total).toBe(0); // none closed → null rate
    expect(ruleByKey(m, 'cut').rate).toBeNull();
  });
});
