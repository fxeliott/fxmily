import { describe, expect, it } from 'vitest';

import {
  CALENDAR_INSTRUMENT_V1,
  CALENDAR_INSTRUMENT_V2,
  CALENDAR_INSTRUMENTS,
  CALENDAR_SLOTS,
  CURRENT_CALENDAR_INSTRUMENT,
  CURRENT_CALENDAR_INSTRUMENT_VERSION,
  getCalendarInstrument,
  type CalendarInstrument,
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
  it('is version 1 and stays a resolvable historical version after the v2 bump', () => {
    expect(CALENDAR_INSTRUMENT_V1.version).toBe(1);
    // F8 shipped v2 → v1 is no longer CURRENT but remains resolvable so stored
    // v1 answer sets read back against the exact instrument they were captured with.
    expect(CURRENT_CALENDAR_INSTRUMENT).not.toBe(CALENDAR_INSTRUMENT_V1);
    expect(getCalendarInstrument(1)).toBe(CALENDAR_INSTRUMENT_V1);
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
  it('CALENDAR_INSTRUMENTS contains every shipped version (v1 + v2)', () => {
    expect(CALENDAR_INSTRUMENTS).toContain(CALENDAR_INSTRUMENT_V1);
    expect(CALENDAR_INSTRUMENTS).toContain(CALENDAR_INSTRUMENT_V2);
  });

  it('getCalendarInstrument resolves shipped versions and refuses unknown ones', () => {
    expect(getCalendarInstrument(1)).toBe(CALENDAR_INSTRUMENT_V1);
    expect(getCalendarInstrument(2)).toBe(CALENDAR_INSTRUMENT_V2);
    expect(getCalendarInstrument(0)).toBeUndefined();
    expect(getCalendarInstrument(3)).toBeUndefined();
    expect(getCalendarInstrument(999)).toBeUndefined();
  });
});

describe('CALENDAR_INSTRUMENT_V2 — F8 « travail » constraint (bump)', () => {
  const constraintOf = (instrument: CalendarInstrument): CalendarSingleChoiceItem => {
    const item = instrument.items.find((i) => i.id === 'constraint');
    if (!item || item.kind !== 'single_choice') throw new Error('constraint item missing');
    return item;
  };

  it('is version 2 and is the current instrument', () => {
    expect(CALENDAR_INSTRUMENT_V2.version).toBe(2);
    expect(CURRENT_CALENDAR_INSTRUMENT).toBe(CALENDAR_INSTRUMENT_V2);
    expect(CURRENT_CALENDAR_INSTRUMENT_VERSION).toBe(2);
  });

  it('keeps the frozen 9-item order + ids of v1', () => {
    expect(CALENDAR_INSTRUMENT_V2.items.map((i) => i.id)).toEqual([...EXPECTED_ITEM_IDS]);
  });

  it('reuses items 1-8 from v1 by reference (only the constraint item changed)', () => {
    for (const v1Item of CALENDAR_INSTRUMENT_V1.items) {
      if (v1Item.id === 'constraint') continue;
      expect(CALENDAR_INSTRUMENT_V2.items.find((i) => i.id === v1Item.id)).toBe(v1Item);
    }
  });

  it('adds the distinct `work` option — v2 constraint is a superset of v1', () => {
    const v1Values = constraintOf(CALENDAR_INSTRUMENT_V1).options.map((o) => o.value);
    const v2Values = constraintOf(CALENDAR_INSTRUMENT_V2).options.map((o) => o.value);
    expect(v1Values).toEqual(['none', 'travel', 'exams', 'reduced']);
    expect(v2Values).toEqual(['none', 'travel', 'work', 'exams', 'reduced']);
    // Longitudinal-validity §27.7: every v1 value survives; `work` is NEW (no reuse).
    for (const v of v1Values) expect(v2Values).toContain(v);
    expect(v1Values).not.toContain('work');
  });

  it('the `work` option carries the expected non-empty FR label', () => {
    const work = constraintOf(CALENDAR_INSTRUMENT_V2).options.find((o) => o.value === 'work');
    expect(work?.label.trim()).toBe('Semaine chargée au travail');
  });

  it('posture guard (§2): the v2 constraint text leaks no market reference', () => {
    const banned = /march[ée]|setup|tendance|pr[ée]vision|pip|résultat|gain|perte|\bP&L\b/i;
    expect(banned.test(constraintOf(CALENDAR_INSTRUMENT_V2).text)).toBe(false);
  });
});
