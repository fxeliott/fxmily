import { describe, expect, it } from 'vitest';

import { getTodayMilestone } from './milestone';

describe('getTodayMilestone', () => {
  it('returns the milestone when today is filled and the streak is exactly an anchor', () => {
    expect(getTodayMilestone({ current: 7, todayFilled: true })).toBe(7);
    expect(getTodayMilestone({ current: 14, todayFilled: true })).toBe(14);
    expect(getTodayMilestone({ current: 30, todayFilled: true })).toBe(30);
    expect(getTodayMilestone({ current: 100, todayFilled: true })).toBe(100);
  });

  it('returns null when today is NOT filled (not earned today)', () => {
    // The streak may still read 7 the morning after, but it was not crossed
    // TODAY — the celebration must not re-fire. Anti-Black-Hat (§31.2).
    expect(getTodayMilestone({ current: 7, todayFilled: false })).toBeNull();
    expect(getTodayMilestone({ current: 30, todayFilled: false })).toBeNull();
  });

  it('returns null when the streak is between anchors', () => {
    expect(getTodayMilestone({ current: 8, todayFilled: true })).toBeNull();
    expect(getTodayMilestone({ current: 13, todayFilled: true })).toBeNull();
    expect(getTodayMilestone({ current: 0, todayFilled: true })).toBeNull();
  });
});
