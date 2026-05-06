import { describe, expect, it } from 'vitest';

import { computeStreak, type CheckinDay } from './streak';

/**
 * Streak counter (J5, SPEC §7.4 — "Streaks visibles" + scoring engagement J6).
 *
 * Behaviour:
 *   - "Streak" = consecutive days (in the user's local timezone) where they
 *     submitted at least one check-in (morning OR evening).
 *   - The walk starts from `today` and steps backwards day by day until it
 *     hits a gap. Today is included only if a check-in was already filed —
 *     a member who hasn't checked in yet today still has yesterday's streak,
 *     and the streak should not break the moment the clock turns midnight.
 *   - Empty input → 0.
 *
 * Inputs are normalised `CheckinDay` rows pre-fetched from the DB (the service
 * layer does the user-scoped query). We keep the algo pure on a list so it's
 * trivially testable.
 */

function day(date: string, slots: Array<'morning' | 'evening'> = ['morning']): CheckinDay {
  return { date, slots };
}

describe('computeStreak', () => {
  it('returns 0 when no check-ins exist', () => {
    expect(computeStreak([], '2026-05-06')).toBe(0);
  });

  it('returns 1 for a single check-in today', () => {
    expect(computeStreak([day('2026-05-06')], '2026-05-06')).toBe(1);
  });

  it('returns 1 for a single check-in yesterday (today not yet filled)', () => {
    expect(computeStreak([day('2026-05-05')], '2026-05-06')).toBe(1);
  });

  it('returns N for N consecutive days ending today', () => {
    const days: CheckinDay[] = [
      day('2026-05-06'),
      day('2026-05-05'),
      day('2026-05-04'),
      day('2026-05-03'),
    ];
    expect(computeStreak(days, '2026-05-06')).toBe(4);
  });

  it('returns N for N consecutive days ending yesterday (today empty)', () => {
    const days: CheckinDay[] = [day('2026-05-05'), day('2026-05-04'), day('2026-05-03')];
    expect(computeStreak(days, '2026-05-06')).toBe(3);
  });

  it('breaks the streak on a gap day', () => {
    // Yesterday filled, but day before that missed → only 1.
    const days: CheckinDay[] = [day('2026-05-05'), day('2026-05-03'), day('2026-05-02')];
    expect(computeStreak(days, '2026-05-06')).toBe(1);
  });

  it('returns 0 if neither today nor yesterday have a check-in', () => {
    const days: CheckinDay[] = [day('2026-05-04'), day('2026-05-03')];
    expect(computeStreak(days, '2026-05-06')).toBe(0);
  });

  it('counts the day even if only the evening slot is filled', () => {
    const days: CheckinDay[] = [day('2026-05-06', ['evening']), day('2026-05-05', ['evening'])];
    expect(computeStreak(days, '2026-05-06')).toBe(2);
  });

  it('counts the day even if both slots are filled (no double-count)', () => {
    const days: CheckinDay[] = [day('2026-05-06', ['morning', 'evening'])];
    expect(computeStreak(days, '2026-05-06')).toBe(1);
  });

  it('handles unsorted input', () => {
    const days: CheckinDay[] = [day('2026-05-04'), day('2026-05-06'), day('2026-05-05')];
    expect(computeStreak(days, '2026-05-06')).toBe(3);
  });

  it('handles month boundaries', () => {
    const days: CheckinDay[] = [
      day('2026-05-02'),
      day('2026-05-01'),
      day('2026-04-30'),
      day('2026-04-29'),
    ];
    expect(computeStreak(days, '2026-05-02')).toBe(4);
  });

  it('handles year boundaries', () => {
    const days: CheckinDay[] = [day('2027-01-02'), day('2027-01-01'), day('2026-12-31')];
    expect(computeStreak(days, '2027-01-02')).toBe(3);
  });

  it('ignores duplicates of the same date silently', () => {
    const days: CheckinDay[] = [
      day('2026-05-06'),
      day('2026-05-06', ['evening']),
      day('2026-05-05'),
    ];
    expect(computeStreak(days, '2026-05-06')).toBe(2);
  });

  it('does not count future-dated rows (defensive against clock skew)', () => {
    const days: CheckinDay[] = [
      day('2026-05-08'), // future
      day('2026-05-06'),
      day('2026-05-05'),
    ];
    expect(computeStreak(days, '2026-05-06')).toBe(2);
  });
});
