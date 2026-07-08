import { describe, expect, it } from 'vitest';

import { floorFillWindowStart } from './fill-window';

describe('floorFillWindowStart', () => {
  it('keeps the window start for a veteran who joined before it (byte-identical)', () => {
    // Joined months before the window → no floor, full 30-day denominator.
    expect(floorFillWindowStart('2026-06-01', '2026-01-15')).toBe('2026-06-01');
  });

  it('floors at the join day for a member who registered mid-window', () => {
    // Window opened 2026-06-01 but the member only joined 2026-06-21 → their
    // assiduité denominator starts the day they existed, not 20 empty days early.
    expect(floorFillWindowStart('2026-06-01', '2026-06-21')).toBe('2026-06-21');
  });

  it('keeps the window start when the member joined exactly on it (no spurious floor)', () => {
    // Joined on the first day of the window → the window IS their tenure already.
    expect(floorFillWindowStart('2026-06-01', '2026-06-01')).toBe('2026-06-01');
  });

  it('leaves the window untouched when the join day is unknown (null)', () => {
    expect(floorFillWindowStart('2026-06-01', null)).toBe('2026-06-01');
  });

  it('uses lexicographic = chronological order on YYYY-MM-DD strings', () => {
    // A join day one calendar day inside the window still floors correctly.
    expect(floorFillWindowStart('2026-06-01', '2026-06-02')).toBe('2026-06-02');
    // A join day one day before the window start does NOT floor.
    expect(floorFillWindowStart('2026-06-02', '2026-06-01')).toBe('2026-06-02');
  });
});
