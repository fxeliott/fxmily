import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentWeekStartUTC, findCurrentWeekReview } from './week';

afterEach(() => {
  vi.useRealTimers();
});

describe('currentWeekStartUTC', () => {
  it('returns an ISO date that is a Monday (UTC)', () => {
    const iso = currentWeekStartUTC();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(1);
  });

  it('maps any weekday to the preceding Monday in the UTC frame', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-07-01T10:00:00Z')); // Wednesday
    expect(currentWeekStartUTC()).toBe('2026-06-29');

    vi.setSystemTime(new Date('2026-06-29T00:30:00Z')); // Monday itself
    expect(currentWeekStartUTC()).toBe('2026-06-29');

    vi.setSystemTime(new Date('2026-07-05T23:59:00Z')); // late Sunday
    expect(currentWeekStartUTC()).toBe('2026-06-29');
  });
});

describe('findCurrentWeekReview (loader for the "existing review this week" signal)', () => {
  const thisWeek = { id: 'rev-2', weekStart: '2026-06-29' };
  const lastWeek = { id: 'rev-1', weekStart: '2026-06-22' };

  it('returns the review whose weekStart matches the current week', () => {
    expect(findCurrentWeekReview([thisWeek, lastWeek], '2026-06-29')).toBe(thisWeek);
  });

  it('returns null when only previous weeks have reviews', () => {
    expect(findCurrentWeekReview([lastWeek], '2026-06-29')).toBeNull();
  });

  it('returns null on an empty list (member never reviewed)', () => {
    expect(findCurrentWeekReview([], '2026-06-29')).toBeNull();
  });
});
