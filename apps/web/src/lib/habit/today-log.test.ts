import { describe, expect, it } from 'vitest';

import type { SerializedHabitLog } from './service';
import {
  caffeinePrefillFromLog,
  findTodayHabitLog,
  meditationPrefillFromLog,
  nutritionPrefillFromLog,
  sleepPrefillFromLog,
  sportPrefillFromLog,
} from './today-log';

/**
 * P3 fix — pure "already logged today" prefill helpers. The whole value of the
 * fix is (a) matching TODAY's log for the RIGHT kind and (b) shaping its JSON
 * back into the wizard's editable fields without ever crashing on a corrupt /
 * older row. Both are pure and testable without the DB.
 */

function makeLog(overrides: Partial<SerializedHabitLog> = {}): SerializedHabitLog {
  return {
    id: 'hl-1',
    userId: 'user-1',
    date: '2026-07-02',
    kind: 'sleep',
    value: { durationMin: 420, quality: 7 },
    notes: null,
    createdAt: '2026-07-02T08:00:00.000Z',
    updatedAt: '2026-07-02T08:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findTodayHabitLog
// ---------------------------------------------------------------------------

describe('findTodayHabitLog', () => {
  it('matches on BOTH date and kind', () => {
    const logs = [
      makeLog({ kind: 'sleep', date: '2026-07-02' }),
      makeLog({ id: 'hl-2', kind: 'sport', date: '2026-07-02', value: {} }),
    ];
    expect(findTodayHabitLog(logs, '2026-07-02', 'sleep')?.kind).toBe('sleep');
    expect(findTodayHabitLog(logs, '2026-07-02', 'sport')?.id).toBe('hl-2');
  });

  it('returns null when the same kind exists only for a PRIOR day', () => {
    // A Paris member just past midnight can still carry yesterday's row in the
    // 1-day rolling window — the date equality is what pins it to today.
    const logs = [makeLog({ kind: 'sleep', date: '2026-07-01' })];
    expect(findTodayHabitLog(logs, '2026-07-02', 'sleep')).toBeNull();
  });

  it('returns null when today has that day but not that kind', () => {
    const logs = [makeLog({ kind: 'sleep', date: '2026-07-02' })];
    expect(findTodayHabitLog(logs, '2026-07-02', 'caffeine')).toBeNull();
  });

  it('returns null on an empty list', () => {
    expect(findTodayHabitLog([], '2026-07-02', 'sleep')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sleepPrefillFromLog
// ---------------------------------------------------------------------------

describe('sleepPrefillFromLog', () => {
  it('formats whole hours without a decimal and carries quality + notes', () => {
    const log = makeLog({ value: { durationMin: 480, quality: 8 }, notes: 'Bien dormi.' });
    expect(sleepPrefillFromLog(log)).toEqual({
      sleepHours: '8',
      sleepQuality: 8,
      notes: 'Bien dormi.',
    });
  });

  it('formats fractional hours with a FR comma decimal', () => {
    const log = makeLog({ value: { durationMin: 450 }, notes: null });
    expect(sleepPrefillFromLog(log)).toEqual({
      sleepHours: '7,5',
      sleepQuality: 6, // neutral default when quality omitted
      notes: '',
    });
  });

  it('returns null when the value JSON does not match the sleep schema', () => {
    expect(sleepPrefillFromLog(makeLog({ value: { cups: 2 } }))).toBeNull();
    expect(sleepPrefillFromLog(makeLog({ value: null }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// nutritionPrefillFromLog
// ---------------------------------------------------------------------------

describe('nutritionPrefillFromLog', () => {
  it('shapes meals count + quality tag', () => {
    const log = makeLog({
      kind: 'nutrition',
      value: { mealsCount: 3, quality: 'good' },
      notes: 'Dejeuner saute.',
    });
    expect(nutritionPrefillFromLog(log)).toEqual({
      mealsCount: '3',
      quality: 'good',
      notes: 'Dejeuner saute.',
    });
  });

  it('defaults quality to empty string when omitted', () => {
    const log = makeLog({ kind: 'nutrition', value: { mealsCount: 2 } });
    expect(nutritionPrefillFromLog(log)?.quality).toBe('');
  });

  it('returns null on a shape mismatch', () => {
    expect(nutritionPrefillFromLog(makeLog({ kind: 'nutrition', value: { cups: 2 } }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// caffeinePrefillFromLog
// ---------------------------------------------------------------------------

describe('caffeinePrefillFromLog', () => {
  it('shapes cups + last-drink time', () => {
    const log = makeLog({
      kind: 'caffeine',
      value: { cups: 4, lastDrinkAtUtc: '16:30' },
      notes: null,
    });
    expect(caffeinePrefillFromLog(log)).toEqual({
      cups: '4',
      lastDrinkAt: '16:30',
      notes: '',
    });
  });

  it('defaults last-drink to empty string when omitted', () => {
    const log = makeLog({ kind: 'caffeine', value: { cups: 1 } });
    expect(caffeinePrefillFromLog(log)?.lastDrinkAt).toBe('');
  });

  it('returns null on a shape mismatch', () => {
    expect(
      caffeinePrefillFromLog(makeLog({ kind: 'caffeine', value: { durationMin: 5 } })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sportPrefillFromLog
// ---------------------------------------------------------------------------

describe('sportPrefillFromLog', () => {
  it('shapes type + duration + intensity', () => {
    const log = makeLog({
      kind: 'sport',
      value: { type: 'strength', durationMin: 60, intensityRating: 8 },
      notes: 'Jambes.',
    });
    expect(sportPrefillFromLog(log)).toEqual({
      sportType: 'strength',
      durationMin: '60',
      intensity: 8,
      notes: 'Jambes.',
    });
  });

  it('defaults intensity to the neutral 5 when omitted', () => {
    const log = makeLog({ kind: 'sport', value: { type: 'cardio', durationMin: 30 } });
    expect(sportPrefillFromLog(log)?.intensity).toBe(5);
  });

  it('returns null on a shape mismatch (unknown sport type)', () => {
    expect(
      sportPrefillFromLog(makeLog({ kind: 'sport', value: { type: 'yoga', durationMin: 30 } })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// meditationPrefillFromLog
// ---------------------------------------------------------------------------

describe('meditationPrefillFromLog', () => {
  it('shapes duration + quality', () => {
    const log = makeLog({
      kind: 'meditation',
      value: { durationMin: 15, quality: 7 },
      notes: null,
    });
    expect(meditationPrefillFromLog(log)).toEqual({
      durationMin: '15',
      quality: 7,
      notes: '',
    });
  });

  it('defaults quality to the neutral 6 when omitted', () => {
    const log = makeLog({ kind: 'meditation', value: { durationMin: 10 } });
    expect(meditationPrefillFromLog(log)?.quality).toBe(6);
  });

  it('returns null on a shape mismatch (over max duration)', () => {
    expect(
      meditationPrefillFromLog(makeLog({ kind: 'meditation', value: { durationMin: 9999 } })),
    ).toBeNull();
  });
});
