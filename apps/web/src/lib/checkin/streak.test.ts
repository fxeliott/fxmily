import { describe, expect, it } from 'vitest';

import { computeStreak, crossedMilestone, STREAK_MILESTONES, type CheckinDay } from './streak';

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
    const days: CheckinDay[] = [day('2027-01-02'), day('2027-01-01'), day('2026-12-31')]; // allow-absolute-date injected-clock-anchor
    expect(computeStreak(days, '2027-01-02')).toBe(3); // allow-absolute-date injected-clock-anchor
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

/**
 * Tour 14 — the off-day "pont". An UNFILLED off day is transparent to the walk
 * (never counts, never breaks); a FILLED day always counts (the rempli wins);
 * omitting `isOffDay` is byte-identical to the pre-Tour-14 behaviour (the whole
 * suite above already proves that path).
 */
describe('computeStreak — off-day pont (Tour 14)', () => {
  // 2026-06-06 = Sat, 06-07 = Sun; 06-05 = Fri, 06-08 = Mon.
  const isWeekend = (d: string): boolean => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return dow === 0 || dow === 6;
  };

  it('an off weekend (unfilled) does NOT break a Friday→Monday streak', () => {
    // Filled Fri + Mon, weekend empty. Today = Monday. Without the pont this
    // would be 1 (Sat breaks it); with weekends off it is 2.
    const days: CheckinDay[] = [day('2026-06-08'), day('2026-06-05')];
    expect(computeStreak(days, '2026-06-08', isWeekend)).toBe(2);
    // Sanity: WITHOUT the pont the same input breaks at Sunday → 1.
    expect(computeStreak(days, '2026-06-08')).toBe(1);
  });

  it('an off weekend does not break the streak when today (Monday) is not filled yet', () => {
    // Filled through Friday, weekend off, Monday empty. The streak is the run
    // ending Friday (1), the weekend is stepped over, Monday is graced as today.
    const days: CheckinDay[] = [day('2026-06-05'), day('2026-06-04')];
    expect(computeStreak(days, '2026-06-08', isWeekend)).toBe(2);
  });

  it('an explicit off day in the MIDDLE is stepped over (streak continues)', () => {
    // Wed 06-10 declared off + empty; Tue + Thu filled. Today = Thursday.
    const explicitOff = new Set(['2026-06-10']);
    const isOff = (d: string): boolean => explicitOff.has(d);
    const days: CheckinDay[] = [day('2026-06-11'), day('2026-06-09')];
    expect(computeStreak(days, '2026-06-11', isOff)).toBe(2);
    // Without the pont the empty Wednesday breaks it → 1.
    expect(computeStreak(days, '2026-06-11')).toBe(1);
  });

  it('a check-in FILLED on an off day still counts (the rempli wins)', () => {
    // The member filled the off Saturday too — it counts on top of Fri + Sun.
    const days: CheckinDay[] = [day('2026-06-07'), day('2026-06-06'), day('2026-06-05')];
    expect(computeStreak(days, '2026-06-07', isWeekend)).toBe(3);
  });

  it('weekendsOff=false (no day ever off) is byte-identical to the base behaviour', () => {
    const neverOff = (): boolean => false;
    const days: CheckinDay[] = [day('2026-06-08'), day('2026-06-05')];
    // The empty weekend breaks it exactly like the no-predicate call.
    expect(computeStreak(days, '2026-06-08', neverOff)).toBe(1);
    expect(computeStreak(days, '2026-06-08')).toBe(1);
  });

  it('still breaks on an unfilled WORKING day even with the pont active', () => {
    // Thu 06-11 filled, Wed 06-10 empty + NOT off (a working day) → break.
    const days: CheckinDay[] = [day('2026-06-11'), day('2026-06-09')];
    expect(computeStreak(days, '2026-06-11', isWeekend)).toBe(1);
  });
});

/**
 * S9.1 "wave wow" — milestone detection is the SSOT shared by /checkin
 * (FirstCheckin/DoneBanner branch) and StreakCard. Exact-match by design:
 * the calm celebration fires only on the day the streak LANDS on an anchor,
 * never as a recurring "you're past 7" nag.
 */
describe('crossedMilestone', () => {
  it('returns the milestone when the streak lands exactly on 7 / 14 / 30 / 100', () => {
    expect(crossedMilestone(7)).toBe(7);
    expect(crossedMilestone(14)).toBe(14);
    expect(crossedMilestone(30)).toBe(30);
    expect(crossedMilestone(100)).toBe(100);
  });

  it('returns null one step before or after each milestone', () => {
    expect(crossedMilestone(6)).toBeNull();
    expect(crossedMilestone(8)).toBeNull();
    expect(crossedMilestone(15)).toBeNull();
    expect(crossedMilestone(31)).toBeNull();
    expect(crossedMilestone(99)).toBeNull();
    expect(crossedMilestone(101)).toBeNull();
  });

  it('returns null for a 0 streak (no celebration before the first anchor)', () => {
    expect(crossedMilestone(0)).toBeNull();
  });

  it('exposes the canonical milestone anchors in ascending order', () => {
    expect(STREAK_MILESTONES).toEqual([7, 14, 30, 100]);
  });
});
