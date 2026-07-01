import { describe, expect, it } from 'vitest';

import type { WeeklyScheduleResponses } from '@/lib/schemas/weekly-schedule-questionnaire';

import {
  buildCalendarSnapshot,
  type CalendarActivityCounts,
  type CalendarSnapshotInput,
} from './snapshot';

function responses(overrides: Partial<WeeklyScheduleResponses> = {}): WeeklyScheduleResponses {
  const on = { morning: true, afternoon: true, evening: true };
  const off = { morning: false, afternoon: false, evening: false };
  return {
    profile: 'salarie',
    sessionGoal: 3,
    weekdayAvailability: { monday: on, tuesday: off, wednesday: on, thursday: off, friday: on },
    weekendAvailability: { saturday: on, sunday: off },
    sleep: 'standard',
    energyPeak: 'morning',
    meetingCommitment: 'occasional',
    practiceFocus: 'balanced',
    constraint: 'none',
    ...overrides,
  };
}

function activity(overrides: Partial<CalendarActivityCounts> = {}): CalendarActivityCounts {
  return {
    tradesLast30d: 12,
    checkinsLast14d: 9,
    trainingSessionsLast14d: 4,
    lastMindsetCheckDate: '2026-06-01',
    ...overrides,
  };
}

function input(overrides: Partial<CalendarSnapshotInput> = {}): CalendarSnapshotInput {
  return {
    pseudonymLabel: 'member-ABCD1234',
    weekStart: '2026-06-08',
    instrumentVersion: 1,
    profileSummary: 'Salarié motivé, travaille sur sa discipline.',
    responses: responses(),
    activity: activity(),
    ...overrides,
  };
}

describe('buildCalendarSnapshot — pure assembler', () => {
  it('carries the identity fields through verbatim', () => {
    const snap = buildCalendarSnapshot(input());
    expect(snap.pseudonymLabel).toBe('member-ABCD1234');
    expect(snap.weekStart).toBe('2026-06-08');
    expect(snap.instrumentVersion).toBe(1);
  });

  it('D3: passes the adaptive dimensions through verbatim when present', () => {
    const snap = buildCalendarSnapshot(
      input({ learningStage: 'subjective', coachingRegister: 'socratique' }),
    );
    expect(snap.learningStage).toBe('subjective');
    expect(snap.coachingRegister).toBe('socratique');
  });

  it('D3: normalises omitted adaptive dimensions to null (stable shape)', () => {
    const snap = buildCalendarSnapshot(input());
    expect(snap.learningStage).toBeNull();
    expect(snap.coachingRegister).toBeNull();
  });

  it('D3: normalises an explicit null adaptive dimension to null', () => {
    const snap = buildCalendarSnapshot(input({ learningStage: null, coachingRegister: null }));
    expect(snap.learningStage).toBeNull();
    expect(snap.coachingRegister).toBeNull();
  });

  it('carries the responses object verbatim', () => {
    const r = responses({ sessionGoal: 5, practiceFocus: 'backtest' });
    const snap = buildCalendarSnapshot(input({ responses: r }));
    expect(snap.responses).toEqual(r);
  });

  it('carries the activity counters verbatim', () => {
    const a = activity({ tradesLast30d: 0, checkinsLast14d: 14 });
    const snap = buildCalendarSnapshot(input({ activity: a }));
    expect(snap.activity).toEqual(a);
  });

  it('counts available slots across both grids (4 weekday + 3 weekend = 7)', () => {
    // 3 weekdays "on" × 3 slots = 9 + 1 weekend day "on" × 3 = 3 → 12.
    const snap = buildCalendarSnapshot(input());
    expect(snap.availableSlotsCount).toBe(12);
  });

  it('returns 0 available slots when every day is fully off', () => {
    const off = { morning: false, afternoon: false, evening: false };
    const r = responses({
      weekdayAvailability: {
        monday: off,
        tuesday: off,
        wednesday: off,
        thursday: off,
        friday: off,
      },
      weekendAvailability: { saturday: off, sunday: off },
    });
    expect(buildCalendarSnapshot(input({ responses: r })).availableSlotsCount).toBe(0);
  });

  it('counts partial-day availability correctly', () => {
    const r = responses({
      weekdayAvailability: {
        monday: { morning: true, afternoon: false, evening: false },
        tuesday: { morning: false, afternoon: false, evening: false },
        wednesday: { morning: false, afternoon: false, evening: false },
        thursday: { morning: false, afternoon: false, evening: false },
        friday: { morning: false, afternoon: false, evening: false },
      },
      weekendAvailability: {
        saturday: { morning: true, afternoon: true, evening: false },
        sunday: { morning: false, afternoon: false, evening: false },
      },
    });
    expect(buildCalendarSnapshot(input({ responses: r })).availableSlotsCount).toBe(3);
  });

  it('preserves a null lastMindsetCheckDate', () => {
    const snap = buildCalendarSnapshot(
      input({ activity: activity({ lastMindsetCheckDate: null }) }),
    );
    expect(snap.activity.lastMindsetCheckDate).toBeNull();
  });

  it('preserves a null profileSummary', () => {
    const snap = buildCalendarSnapshot(input({ profileSummary: null }));
    expect(snap.profileSummary).toBeNull();
  });

  it('is deterministic: same input → equal output', () => {
    const i = input();
    expect(buildCalendarSnapshot(i)).toEqual(buildCalendarSnapshot(i));
  });

  it('ISOLATION §2/§21.5: the activity payload carries ONLY count-only keys (no P&L)', () => {
    const snap = buildCalendarSnapshot(input());
    expect(Object.keys(snap.activity).sort()).toEqual(
      [
        'checkinsLast14d',
        'lastMindsetCheckDate',
        'tradesLast30d',
        'trainingSessionsLast14d',
      ].sort(),
    );
    // Defensive: no P&L field ever surfaces, whatever the input shape.
    for (const banned of ['realizedR', 'outcome', 'plannedRR', 'resultR', 'pnl', 'costEur']) {
      expect(banned in snap.activity).toBe(false);
    }
  });
});
