import { describe, expect, it } from 'vitest';

import {
  caffeineValueSchema,
  habitKindSchema,
  habitLogInputSchema,
  meditationValueSchema,
  nutritionValueSchema,
  sleepValueSchema,
  sportValueSchema,
} from './habit-log';

/**
 * V2.0 TRACK — Zod schema coverage for the discriminated `HabitLogInput`
 * + each per-kind value shape. Targets boundary cases : valid happy paths,
 * out-of-range numbers, extra properties (strict mode), date-window refine.
 */

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC today

describe('habitKindSchema', () => {
  it('accepts the 5 canonical kinds', () => {
    for (const kind of ['sleep', 'nutrition', 'caffeine', 'sport', 'meditation']) {
      expect(habitKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects unknown kinds', () => {
    expect(() => habitKindSchema.parse('alcohol')).toThrow();
    expect(() => habitKindSchema.parse('')).toThrow();
  });
});

describe('sleepValueSchema', () => {
  it('accepts a valid duration + optional quality', () => {
    expect(sleepValueSchema.parse({ durationMin: 420 })).toEqual({ durationMin: 420 });
    expect(sleepValueSchema.parse({ durationMin: 420, quality: 7 })).toEqual({
      durationMin: 420,
      quality: 7,
    });
  });

  it('rejects out-of-range duration', () => {
    expect(() => sleepValueSchema.parse({ durationMin: -1 })).toThrow();
    expect(() => sleepValueSchema.parse({ durationMin: 1441 })).toThrow();
  });

  it('rejects out-of-range quality', () => {
    expect(() => sleepValueSchema.parse({ durationMin: 420, quality: 0 })).toThrow();
    expect(() => sleepValueSchema.parse({ durationMin: 420, quality: 11 })).toThrow();
  });

  it('rejects unknown extra properties (strict)', () => {
    expect(() =>
      sleepValueSchema.parse({ durationMin: 420, extraField: 'bad' } as never),
    ).toThrow();
  });
});

describe('nutritionValueSchema', () => {
  it('accepts a valid meals count + optional quality tag', () => {
    expect(nutritionValueSchema.parse({ mealsCount: 3 })).toEqual({ mealsCount: 3 });
    expect(nutritionValueSchema.parse({ mealsCount: 3, quality: 'good' })).toEqual({
      mealsCount: 3,
      quality: 'good',
    });
  });

  it('rejects an unknown quality enum', () => {
    expect(() =>
      nutritionValueSchema.parse({ mealsCount: 3, quality: 'mediocre' as never }),
    ).toThrow();
  });
});

describe('caffeineValueSchema', () => {
  it('accepts a valid cup count + optional HH:MM time', () => {
    expect(caffeineValueSchema.parse({ cups: 2 })).toEqual({ cups: 2 });
    expect(caffeineValueSchema.parse({ cups: 2, lastDrinkAtUtc: '14:30' })).toEqual({
      cups: 2,
      lastDrinkAtUtc: '14:30',
    });
  });

  it('rejects an invalid time format', () => {
    expect(() => caffeineValueSchema.parse({ cups: 2, lastDrinkAtUtc: '2:30 PM' })).toThrow();
    expect(() => caffeineValueSchema.parse({ cups: 2, lastDrinkAtUtc: '25:00' })).toThrow();
    expect(() => caffeineValueSchema.parse({ cups: 2, lastDrinkAtUtc: '12:60' })).toThrow();
  });

  it('rejects out-of-range cups', () => {
    expect(() => caffeineValueSchema.parse({ cups: -1 })).toThrow();
    expect(() => caffeineValueSchema.parse({ cups: 21 })).toThrow();
  });
});

describe('sportValueSchema', () => {
  it('accepts each canonical type', () => {
    for (const type of ['cardio', 'strength', 'mixed', 'flexibility', 'other']) {
      expect(sportValueSchema.parse({ type, durationMin: 30 })).toEqual({ type, durationMin: 30 });
    }
  });

  it('rejects unknown sport types', () => {
    expect(() => sportValueSchema.parse({ type: 'fencing' as never, durationMin: 30 })).toThrow();
  });

  it('clamps duration in [0, 600]', () => {
    expect(() => sportValueSchema.parse({ type: 'cardio', durationMin: -1 })).toThrow();
    expect(() => sportValueSchema.parse({ type: 'cardio', durationMin: 601 })).toThrow();
  });
});

describe('meditationValueSchema', () => {
  it('clamps duration in [0, 180]', () => {
    expect(meditationValueSchema.parse({ durationMin: 0 })).toEqual({ durationMin: 0 });
    expect(meditationValueSchema.parse({ durationMin: 180 })).toEqual({ durationMin: 180 });
    expect(() => meditationValueSchema.parse({ durationMin: 181 })).toThrow();
    expect(() => meditationValueSchema.parse({ durationMin: -1 })).toThrow();
  });
});

describe('habitLogInputSchema (discriminated union)', () => {
  it('accepts a sleep input matching the sleep value shape', () => {
    const parsed = habitLogInputSchema.parse({
      kind: 'sleep',
      date: today,
      value: { durationMin: 420, quality: 7 },
      notes: 'Bien dormi.',
    });
    expect(parsed.kind).toBe('sleep');
  });

  it('rejects a sleep input where value matches the wrong kind shape', () => {
    expect(() =>
      habitLogInputSchema.parse({
        kind: 'sleep',
        date: today,
        value: { cups: 2 } as never, // caffeine shape — should fail
      }),
    ).toThrow();
  });

  it('rejects a date out of the [-14d, +1d] window', () => {
    expect(() =>
      habitLogInputSchema.parse({
        kind: 'sleep',
        date: '2025-01-01',
        value: { durationMin: 420 },
      }),
    ).toThrow(/hors fenêtre/);
  });

  it('rejects a malformed date string', () => {
    expect(() =>
      habitLogInputSchema.parse({
        kind: 'sleep',
        date: '13-05-2026',
        value: { durationMin: 420 },
      }),
    ).toThrow();
  });

  it('rejects notes exceeding the 500-char cap', () => {
    expect(() =>
      habitLogInputSchema.parse({
        kind: 'sport',
        date: today,
        value: { type: 'cardio', durationMin: 30 },
        notes: 'x'.repeat(501),
      }),
    ).toThrow();
  });

  it('V1.9 R2 H2 — rejects notes containing bidi / zero-width Trojan Source chars', () => {
    // U+202E Right-to-Left Override (Trojan Source attack on weekly digest pipeline).
    expect(() =>
      habitLogInputSchema.parse({
        kind: 'sport',
        date: today,
        value: { type: 'cardio', durationMin: 30 },
        notes: 'Normal text ‮hidden-rtl',
      }),
    ).toThrow(/Caractères de contrôle interdits/);

    // U+200B Zero-Width Space (LLM tokeniser confusion).
    expect(() =>
      habitLogInputSchema.parse({
        kind: 'meditation',
        date: today,
        value: { durationMin: 10 },
        notes: 'inv​isible-space',
      }),
    ).toThrow(/Caractères de contrôle interdits/);
  });

  it('V1.9 R2 H2 — NFC-normalises notes via safeFreeText transform', () => {
    // NFD form (decomposed) : 'e' + U+0301 combining acute = `é` rendered.
    // After NFC normalise, the 2-codepoint sequence collapses to U+00E9 (1 cp).
    const nfdInput = `Caf${'é'}`; // 5 codepoints : C-a-f-e-(U+0301)
    expect(nfdInput.length).toBe(5);
    const parsed = habitLogInputSchema.parse({
      kind: 'sleep',
      date: today,
      value: { durationMin: 420 },
      notes: nfdInput,
    });
    if (parsed.kind !== 'sleep') throw new Error('expected sleep kind');
    expect(parsed.notes?.length).toBe(4); // C-a-f-é (1 cp for é)
    expect(parsed.notes).toBe('Café');
    // No standalone combining acute should remain.
    expect(parsed.notes?.includes('́')).toBe(false);
  });

  it('discriminated union enforces per-kind value shape', () => {
    // Caffeine + sport value = invalid
    expect(() =>
      habitLogInputSchema.parse({
        kind: 'caffeine',
        date: today,
        value: { type: 'cardio', durationMin: 30 } as never,
      }),
    ).toThrow();
  });
});
