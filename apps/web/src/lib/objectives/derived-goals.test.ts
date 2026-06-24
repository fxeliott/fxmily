import { describe, expect, it } from 'vitest';

import type { MethodMirror, MethodRule, MethodRuleKey } from '@/lib/method-mirror/compute';

import { deriveMethodGoal } from './derived-goals';

/**
 * S25 — pure derivation of the member's EVOLVING method goal from his fidelity
 * mirror. Must be deterministic (no `Math.random`), pick the WEAKEST sufficiently
 * sampled rule, ladder the target gently above current, and refuse to fabricate a
 * goal when there isn't enough data or the member is already faithful.
 */

function rule(key: MethodRuleKey, rate: number | null, total: number): MethodRule {
  return {
    key,
    label: key,
    hint: `${key} hint`,
    good: rate === null ? 0 : Math.round((rate / 100) * total),
    total,
    rate,
  };
}

function mirror(rules: MethodRule[], hasEnough = true, windowDays = 30): MethodMirror {
  return {
    rules,
    sampleEntered: rules.reduce((s, r) => Math.max(s, r.total), 0),
    windowDays,
    hasEnough,
  };
}

describe('deriveMethodGoal', () => {
  it('returns null when there is not enough data (!hasEnough)', () => {
    const m = mirror([rule('window', 30, 4)], false);
    expect(deriveMethodGoal(m)).toBeNull();
  });

  it('returns null when no rule has a real rate (all totals zero)', () => {
    const m = mirror([rule('window', null, 0), rule('cut', null, 0)]);
    expect(deriveMethodGoal(m)).toBeNull();
  });

  it('ignores rules with too small a sample (anti-noise, total < 3)', () => {
    // window 0% on a single trade must NOT win over a real 60% on 10.
    const m = mirror([rule('window', 0, 1), rule('targetRR', 60, 10)]);
    const goal = deriveMethodGoal(m);
    expect(goal?.rule).toBe('targetRR');
  });

  it('returns null when the member is already faithful everywhere (>= 90%)', () => {
    const m = mirror([rule('window', 95, 10), rule('cut', 92, 8), rule('targetRR', 100, 10)]);
    expect(deriveMethodGoal(m)).toBeNull();
  });

  it('picks the WEAKEST sufficiently-sampled rule', () => {
    const m = mirror([
      rule('window', 80, 10),
      rule('oneADay', 40, 10),
      rule('cut', 70, 10),
      rule('targetRR', 90, 10),
    ]);
    const goal = deriveMethodGoal(m);
    expect(goal?.rule).toBe('oneADay');
    expect(goal?.current).toBe(40);
  });

  it('ladders the target one gentle step above current', () => {
    expect(deriveMethodGoal(mirror([rule('window', 30, 10)]))?.target).toBe(40);
    expect(deriveMethodGoal(mirror([rule('window', 35, 10)]))?.target).toBe(40);
    expect(deriveMethodGoal(mirror([rule('window', 72, 10)]))?.target).toBe(80);
    expect(deriveMethodGoal(mirror([rule('window', 0, 10)]))?.target).toBe(10);
  });

  it('caps the target at 95 (never demands a rigid 100%)', () => {
    // current 88 → ladder would be 90, fine; current 89 → 90.
    expect(deriveMethodGoal(mirror([rule('window', 89, 10)]))?.target).toBe(90);
    // current 85 → 90.
    expect(deriveMethodGoal(mirror([rule('window', 85, 10)]))?.target).toBe(90);
  });

  it('is deterministic and breaks ties by stable rule order', () => {
    const rules = [rule('window', 50, 10), rule('cut', 50, 10)];
    const a = deriveMethodGoal(mirror(rules));
    const b = deriveMethodGoal(mirror(rules));
    expect(a?.rule).toBe('window'); // first in stable order wins the tie
    expect(a?.rule).toBe(b?.rule);
  });

  it('carries through the honest numerator/denominator and window', () => {
    const goal = deriveMethodGoal(mirror([rule('cut', 60, 5)], true, 30));
    expect(goal).toMatchObject({ rule: 'cut', current: 60, good: 3, total: 5, windowDays: 30 });
  });
});
