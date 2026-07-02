import { describe, expect, it } from 'vitest';

import {
  CALENDAR_SLOTS,
  CALENDAR_WEEKDAYS,
  CALENDAR_WEEKEND_DAYS,
} from '@/lib/calendar/instrument-v1';

import {
  daySlotsSchema,
  submitWeeklyScheduleInputSchema,
  weekdayAvailabilitySchema,
  weekendAvailabilitySchema,
  weeklyScheduleResponsesSchema,
  type WeeklyScheduleResponses,
} from './weekly-schedule-questionnaire';

const FULL_SLOTS = { morning: true, afternoon: false, evening: true };
const EMPTY_SLOTS = { morning: false, afternoon: false, evening: false };

function validResponses(): Record<string, unknown> {
  return {
    profile: 'salarie',
    sessionGoal: 3,
    weekdayAvailability: {
      monday: FULL_SLOTS,
      tuesday: FULL_SLOTS,
      wednesday: EMPTY_SLOTS,
      thursday: FULL_SLOTS,
      friday: FULL_SLOTS,
    },
    weekendAvailability: {
      saturday: FULL_SLOTS,
      sunday: EMPTY_SLOTS,
    },
    sleep: 'standard',
    energyPeak: 'morning',
    meetingCommitment: 'occasional',
    practiceFocus: 'balanced',
    constraint: 'travel',
  };
}

describe('weeklyScheduleResponsesSchema', () => {
  it('accepts a fully valid answer set', () => {
    const parsed = weeklyScheduleResponsesSchema.parse(validResponses());
    expect(parsed.profile).toBe('salarie');
    expect(parsed.sessionGoal).toBe(3);
    expect(parsed.constraint).toBe('travel');
  });

  it('defaults constraint to "none" when the optional item is omitted', () => {
    const input = validResponses();
    delete input.constraint;
    const parsed = weeklyScheduleResponsesSchema.parse(input);
    expect(parsed.constraint).toBe('none');
  });

  it('accepts the v2 « work » constraint (F8)', () => {
    const parsed = weeklyScheduleResponsesSchema.parse({ ...validResponses(), constraint: 'work' });
    expect(parsed.constraint).toBe('work');
  });

  it('rejects an unknown constraint value (closed enum)', () => {
    const res = weeklyScheduleResponsesSchema.safeParse({
      ...validResponses(),
      constraint: 'holiday',
    });
    expect(res.success).toBe(false);
  });

  it('rejects an unknown profile value', () => {
    const input = { ...validResponses(), profile: 'pro_trader' };
    expect(weeklyScheduleResponsesSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a session goal below 1 or above 7', () => {
    expect(
      weeklyScheduleResponsesSchema.safeParse({ ...validResponses(), sessionGoal: 0 }).success,
    ).toBe(false);
    expect(
      weeklyScheduleResponsesSchema.safeParse({ ...validResponses(), sessionGoal: 8 }).success,
    ).toBe(false);
  });

  it('rejects a non-integer session goal', () => {
    expect(
      weeklyScheduleResponsesSchema.safeParse({ ...validResponses(), sessionGoal: 3.5 }).success,
    ).toBe(false);
  });

  it('rejects an extra top-level key (.strict)', () => {
    const input = { ...validResponses(), realizedR: 2.5 };
    const res = weeklyScheduleResponsesSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  it('rejects a missing weekday in the availability grid', () => {
    const input = validResponses();
    delete (input.weekdayAvailability as Record<string, unknown>).monday;
    expect(weeklyScheduleResponsesSchema.safeParse(input).success).toBe(false);
  });

  it('rejects an extra slot key inside a day (.strict)', () => {
    const input = validResponses();
    (input.weekdayAvailability as Record<string, unknown>).monday = {
      ...FULL_SLOTS,
      night: true,
    };
    expect(weeklyScheduleResponsesSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a non-boolean slot value', () => {
    const input = validResponses();
    (input.weekendAvailability as Record<string, unknown>).saturday = {
      morning: 'yes',
      afternoon: false,
      evening: false,
    };
    expect(weeklyScheduleResponsesSchema.safeParse(input).success).toBe(false);
  });

  it('rejects an invalid energy-peak slot', () => {
    expect(
      weeklyScheduleResponsesSchema.safeParse({ ...validResponses(), energyPeak: 'night' }).success,
    ).toBe(false);
  });
});

describe('submitWeeklyScheduleInputSchema', () => {
  it('accepts a YYYY-MM-DD weekStart with valid responses', () => {
    const res = submitWeeklyScheduleInputSchema.safeParse({
      weekStart: '2026-06-08',
      responses: validResponses(),
    });
    expect(res.success).toBe(true);
  });

  it('rejects a malformed weekStart', () => {
    for (const weekStart of ['2026-6-8', '08/06/2026', '2026-06-08T00:00:00Z', 'lundi']) {
      const res = submitWeeklyScheduleInputSchema.safeParse({
        weekStart,
        responses: validResponses(),
      });
      expect(res.success, weekStart).toBe(false);
    }
  });

  it('rejects an extra top-level key (.strict)', () => {
    const res = submitWeeklyScheduleInputSchema.safeParse({
      weekStart: '2026-06-08',
      responses: validResponses(),
      userId: 'smuggled',
    });
    expect(res.success).toBe(false);
  });

  it('exposes the inferred type through parse', () => {
    const parsed = submitWeeklyScheduleInputSchema.parse({
      weekStart: '2026-06-08',
      responses: validResponses(),
    });
    const responses: WeeklyScheduleResponses = parsed.responses;
    expect(responses.practiceFocus).toBe('balanced');
  });
});

describe('schema ↔ instrument key integrity (v2 drift guard)', () => {
  // The availability grids hardcode their keys (for precise static typing).
  // These assertions FAIL if a future instrument version adds/removes a slot or
  // a day without the Zod schema following — preventing a silent validation gap
  // (security/code-review TIER 2).
  it('day-slot keys mirror CALENDAR_SLOTS exactly', () => {
    expect(Object.keys(daySlotsSchema.shape).sort()).toEqual([...CALENDAR_SLOTS].sort());
  });

  it('weekday grid keys mirror CALENDAR_WEEKDAYS exactly', () => {
    expect(Object.keys(weekdayAvailabilitySchema.shape).sort()).toEqual(
      [...CALENDAR_WEEKDAYS].sort(),
    );
  });

  it('weekend grid keys mirror CALENDAR_WEEKEND_DAYS exactly', () => {
    expect(Object.keys(weekendAvailabilitySchema.shape).sort()).toEqual(
      [...CALENDAR_WEEKEND_DAYS].sort(),
    );
  });
});
