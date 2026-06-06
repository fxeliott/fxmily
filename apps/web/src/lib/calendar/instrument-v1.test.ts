import { describe, expect, it } from 'vitest';

import {
  CALENDAR_INSTRUMENT_V1,
  CALENDAR_INSTRUMENTS,
  CALENDAR_SLOTS,
  CURRENT_CALENDAR_INSTRUMENT,
  CURRENT_CALENDAR_INSTRUMENT_VERSION,
  getCalendarInstrument,
  type CalendarSingleChoiceItem,
} from './instrument-v1';

/**
 * §26 — frozen, versioned questionnaire contract. These assertions are the
 * longitudinal-validity guard (carbone V1.5 mindset §27.7): they FAIL if a
 * future edit silently mutates v1 (renamed id, changed item count, broken
 * option set) instead of shipping a new version. Also a posture guard (§2): no
 * item asks for a market view / setup / trade decision.
 */

const EXPECTED_ITEM_IDS = [
  'profile',
  'session_goal',
  'weekday_availability',
  'weekend_availability',
  'sleep',
  'energy_peak',
  'meeting_commitment',
  'practice_focus',
  'constraint',
] as const;

describe('CALENDAR_INSTRUMENT_V1 — frozen contract', () => {
  it('is version 1 and is the current instrument', () => {
    expect(CALENDAR_INSTRUMENT_V1.version).toBe(1);
    expect(CURRENT_CALENDAR_INSTRUMENT).toBe(CALENDAR_INSTRUMENT_V1);
    expect(CURRENT_CALENDAR_INSTRUMENT_VERSION).toBe(1);
  });

  it('has exactly 9 items in the frozen order, ids unique', () => {
    const ids = CALENDAR_INSTRUMENT_V1.items.map((i) => i.id);
    expect(ids).toEqual([...EXPECTED_ITEM_IDS]);
    expect(new Set(ids).size).toBe(9);
  });

  it('every item has a non-empty FR question text', () => {
    for (const item of CALENDAR_INSTRUMENT_V1.items) {
      expect(item.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('only the constraint item is optional', () => {
    for (const item of CALENDAR_INSTRUMENT_V1.items) {
      expect(item.optional).toBe(item.id === 'constraint');
    }
  });

  it('single-choice items have ≥2 options with unique values and non-empty labels', () => {
    const choiceItems = CALENDAR_INSTRUMENT_V1.items.filter(
      (i): i is CalendarSingleChoiceItem => i.kind === 'single_choice',
    );
    expect(choiceItems.length).toBe(6);
    for (const item of choiceItems) {
      expect(item.options.length).toBeGreaterThanOrEqual(2);
      const values = item.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      for (const opt of item.options) {
        expect(opt.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('the integer item (session_goal) has a valid 1..7 range', () => {
    const item = CALENDAR_INSTRUMENT_V1.items.find((i) => i.id === 'session_goal');
    expect(item?.kind).toBe('integer');
    if (item?.kind === 'integer') {
      expect(item.min).toBe(1);
      expect(item.max).toBe(7);
      expect(item.min).toBeLessThan(item.max);
    }
  });

  it('availability grids cover the right days and exactly the 3 slots', () => {
    const weekday = CALENDAR_INSTRUMENT_V1.items.find((i) => i.id === 'weekday_availability');
    const weekend = CALENDAR_INSTRUMENT_V1.items.find((i) => i.id === 'weekend_availability');
    expect(weekday?.kind).toBe('availability_grid');
    expect(weekend?.kind).toBe('availability_grid');
    if (weekday?.kind === 'availability_grid') {
      expect(weekday.days).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
      expect(weekday.slots).toEqual([...CALENDAR_SLOTS]);
    }
    if (weekend?.kind === 'availability_grid') {
      expect(weekend.days).toEqual(['saturday', 'sunday']);
      expect(weekend.slots).toEqual([...CALENDAR_SLOTS]);
    }
  });

  it('energy_peak option values are exactly the CalendarSlot vocabulary', () => {
    const item = CALENDAR_INSTRUMENT_V1.items.find((i) => i.id === 'energy_peak');
    expect(item?.kind).toBe('single_choice');
    if (item?.kind === 'single_choice') {
      expect(item.options.map((o) => o.value)).toEqual([...CALENDAR_SLOTS]);
    }
  });

  it('posture guard (§2): no item text asks for a market view / setup / P&L', () => {
    const banned =
      /march[ée]|setup|tendance|pr[ée]vision|pip|résultat|gain|perte|\bP&L\b|paire à trader/i;
    for (const item of CALENDAR_INSTRUMENT_V1.items) {
      expect(banned.test(item.text), `item "${item.id}" leaks a market reference`).toBe(false);
    }
  });
});

describe('calendar instrument registry', () => {
  it('CALENDAR_INSTRUMENTS contains v1', () => {
    expect(CALENDAR_INSTRUMENTS).toContain(CALENDAR_INSTRUMENT_V1);
  });

  it('getCalendarInstrument resolves a shipped version and refuses unknown ones', () => {
    expect(getCalendarInstrument(1)).toBe(CALENDAR_INSTRUMENT_V1);
    expect(getCalendarInstrument(0)).toBeUndefined();
    expect(getCalendarInstrument(2)).toBeUndefined();
    expect(getCalendarInstrument(999)).toBeUndefined();
  });
});
