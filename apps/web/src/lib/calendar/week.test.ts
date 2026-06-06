import { describe, expect, it } from 'vitest';

import { currentParisWeekStart, formatWeekRangeFr, weekEndFromWeekStart } from './week';

describe('currentParisWeekStart', () => {
  it('returns the Monday of a mid-week instant', () => {
    expect(currentParisWeekStart(new Date('2026-06-10T10:00:00.000Z'))).toBe('2026-06-08');
  });

  it('returns the same Monday when "now" is Monday', () => {
    expect(currentParisWeekStart(new Date('2026-06-08T10:00:00.000Z'))).toBe('2026-06-08');
  });

  it('keeps Sunday inside the Mon→Sun week', () => {
    expect(currentParisWeekStart(new Date('2026-06-14T10:00:00.000Z'))).toBe('2026-06-08');
  });

  it('PR#96 nocturnal: a Sunday 22:30 UTC instant is already Monday in Paris (CEST)', () => {
    // 2026-06-07T22:30Z = 2026-06-08T00:30 Europe/Paris → the new week's Monday.
    expect(currentParisWeekStart(new Date('2026-06-07T22:30:00.000Z'))).toBe('2026-06-08');
  });

  it('handles the winter (CET) boundary too', () => {
    // 2026-01-11T23:30Z = 2026-01-12T00:30 Paris (CET) → Monday 2026-01-12.
    expect(currentParisWeekStart(new Date('2026-01-11T23:30:00.000Z'))).toBe('2026-01-12');
  });
});

describe('weekEndFromWeekStart', () => {
  it('returns weekStart + 6 days', () => {
    expect(weekEndFromWeekStart('2026-06-08')).toBe('2026-06-14');
  });
});

describe('formatWeekRangeFr', () => {
  it('renders a human FR range', () => {
    expect(formatWeekRangeFr('2026-06-08')).toBe('8 juin → 14 juin');
  });
});
