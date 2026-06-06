import { describe, expect, it } from 'vitest';

import {
  adaptiveCalendarOutputSchema,
  deriveDominantBlockCategory,
  type AdaptiveCalendarOutput,
} from './adaptive-calendar';

const OVERVIEW =
  'Cette semaine, on structure ton temps de pratique autour de tes créneaux disponibles : des sessions ciblées, du backtest, un peu de Mark Douglas et du repos.';
const WEEKLY_FOCUS =
  'Souviens-toi que chaque trade a une issue incertaine : suis ton process, pas le résultat immédiat.';

function block(
  category = 'backtest',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slot: 'morning',
    category,
    durationMin: 60,
    label: 'Session de backtest',
    priority: 'medium',
    ...overrides,
  };
}

/** Build a calendar where each of the 7 days gets the blocks at its index. */
function outputWithDayBlocks(daysBlocks: Record<string, unknown>[][]): Record<string, unknown> {
  const days = daysBlocks.map((blocks, i) => ({
    date: `2026-06-${String(8 + i).padStart(2, '0')}`,
    dayLabel: `Jour ${i + 1}`,
    blocks,
  }));
  return {
    weekStart: '2026-06-08',
    overview: OVERVIEW,
    days,
    weeklyFocus: WEEKLY_FOCUS,
    warnings: [],
  };
}

/** A valid calendar: 7 days, one backtest block each. */
function validOutput(): Record<string, unknown> {
  return outputWithDayBlocks(Array.from({ length: 7 }, () => [block()]));
}

/** Same valid calendar but day 0's blocks are replaced (immutable). */
function withFirstDayBlocks(blocks: Record<string, unknown>[]): Record<string, unknown> {
  return outputWithDayBlocks(Array.from({ length: 7 }, (_v, i) => (i === 0 ? blocks : [block()])));
}

describe('adaptiveCalendarOutputSchema', () => {
  it('accepts a valid 7-day calendar', () => {
    expect(adaptiveCalendarOutputSchema.safeParse(validOutput()).success).toBe(true);
  });

  it('rejects an extra top-level key (.strict — hallucinated field)', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse({ ...validOutput(), confidence: 0.9 }).success,
    ).toBe(false);
  });

  it('requires exactly 7 days', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse(
        outputWithDayBlocks(Array.from({ length: 6 }, () => [block()])),
      ).success,
    ).toBe(false);
    expect(
      adaptiveCalendarOutputSchema.safeParse(
        outputWithDayBlocks(Array.from({ length: 8 }, () => [block()])),
      ).success,
    ).toBe(false);
  });

  it('rejects a block duration outside 15..120', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse(
        withFirstDayBlocks([block('backtest', { durationMin: 10 })]),
      ).success,
    ).toBe(false);
    expect(
      adaptiveCalendarOutputSchema.safeParse(
        withFirstDayBlocks([block('backtest', { durationMin: 150 })]),
      ).success,
    ).toBe(false);
  });

  it('rejects an unknown block category / slot / priority', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse(withFirstDayBlocks([block('market_analysis')]))
        .success,
    ).toBe(false);
    expect(
      adaptiveCalendarOutputSchema.safeParse(
        withFirstDayBlocks([block('backtest', { slot: 'night' })]),
      ).success,
    ).toBe(false);
    expect(
      adaptiveCalendarOutputSchema.safeParse(
        withFirstDayBlocks([block('backtest', { priority: 'urgent' })]),
      ).success,
    ).toBe(false);
  });

  it('rejects an overview that is too short or too long', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse({ ...validOutput(), overview: 'trop court' }).success,
    ).toBe(false);
    expect(
      adaptiveCalendarOutputSchema.safeParse({ ...validOutput(), overview: 'x'.repeat(301) })
        .success,
    ).toBe(false);
  });

  it('rejects a weeklyFocus outside 50..200 chars', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse({ ...validOutput(), weeklyFocus: 'court' }).success,
    ).toBe(false);
    expect(
      adaptiveCalendarOutputSchema.safeParse({ ...validOutput(), weeklyFocus: 'x'.repeat(201) })
        .success,
    ).toBe(false);
  });

  it('rejects more than 3 warnings', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse({ ...validOutput(), warnings: ['a', 'b', 'c', 'd'] })
        .success,
    ).toBe(false);
  });

  it('rejects a bidi / zero-width control char in a free-text field', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse({ ...validOutput(), weeklyFocus: `${WEEKLY_FOCUS}‮` })
        .success,
    ).toBe(false);
  });

  it('applies safeFreeText (trims) to free-text fields', () => {
    const res = adaptiveCalendarOutputSchema.parse({
      ...validOutput(),
      weeklyFocus: `   ${WEEKLY_FOCUS}   `,
    });
    expect(res.weeklyFocus).toBe(WEEKLY_FOCUS);
  });

  it('rejects a block label longer than 60 chars', () => {
    expect(
      adaptiveCalendarOutputSchema.safeParse(
        withFirstDayBlocks([block('backtest', { label: 'x'.repeat(61) })]),
      ).success,
    ).toBe(false);
  });
});

describe('deriveDominantBlockCategory', () => {
  it('returns the most frequent block category', () => {
    const parsed = adaptiveCalendarOutputSchema.parse(validOutput()) as AdaptiveCalendarOutput;
    expect(deriveDominantBlockCategory(parsed)).toBe('backtest');
  });

  it('returns null for a schedule with no blocks at all', () => {
    const parsed = adaptiveCalendarOutputSchema.parse(
      outputWithDayBlocks(Array.from({ length: 7 }, () => [])),
    ) as AdaptiveCalendarOutput;
    expect(deriveDominantBlockCategory(parsed)).toBeNull();
  });

  it('breaks ties by declaration order (live_trading before rest)', () => {
    const daysBlocks: Record<string, unknown>[][] = Array.from({ length: 7 }, () => []);
    daysBlocks[0] = [block('rest')];
    daysBlocks[1] = [block('live_trading')];
    const parsed = adaptiveCalendarOutputSchema.parse(
      outputWithDayBlocks(daysBlocks),
    ) as AdaptiveCalendarOutput;
    expect(deriveDominantBlockCategory(parsed)).toBe('live_trading');
  });
});
