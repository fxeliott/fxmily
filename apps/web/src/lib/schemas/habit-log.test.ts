import { describe, expect, it } from 'vitest';

import {
  caffeineValueSchema,
  HABIT_BACKFILL_WINDOW_DAYS,
  HABIT_FORWARD_WINDOW_DAYS,
  habitKindSchema,
  habitLogInputSchema,
  isHabitDateWithinLocalWindow,
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

describe('isHabitDateWithinLocalWindow (V1.9 R2 H1 — timezone-authoritative window)', () => {
  // The Zod `dateField` refine anchors the [-14d, +1d] window to UTC
  // midnight, so a member off-UTC gets up to ±13h of slop on the bounds.
  // This helper re-derives the member's CIVIL today via `localDateOf` and
  // compares ISO-date strings (lexicographic == chronological), so the
  // bound is exact in the member's timezone. The Server Action calls it
  // with `session.user.timezone || 'Europe/Paris'`.

  // 2026-05-16T23:30Z : UTC civil day = 2026-05-16, but Paris (CEST = +2)
  // civil day = 2026-05-17. UTC window  = [2026-05-02, 2026-05-17].
  //                          Paris window = [2026-05-03, 2026-05-18].
  const now = new Date('2026-05-16T23:30:00Z');

  it('closes the backfill drift: a date inside the UTC window but OUTSIDE the Paris civil window is rejected', () => {
    // 2026-05-02 passes the UTC-anchored `dateInWindow` (>= 2026-05-02)
    // but is the 15th day back in Paris civil time → must be rejected.
    expect(isHabitDateWithinLocalWindow('2026-05-02', now, 'Europe/Paris')).toBe(false);
  });

  it('corrects the forward drift: a date the UTC window wrongly rejects but valid in Paris civil is accepted', () => {
    // 2026-05-18 fails the UTC `dateInWindow` (> 2026-05-17) yet is the
    // member's real tomorrow in Paris → must be accepted (accurate, not
    // merely stricter).
    expect(isHabitDateWithinLocalWindow('2026-05-18', now, 'Europe/Paris')).toBe(true);
  });

  it('accepts the member civil today and both inclusive bounds (Paris)', () => {
    expect(isHabitDateWithinLocalWindow('2026-05-17', now, 'Europe/Paris')).toBe(true); // today
    expect(isHabitDateWithinLocalWindow('2026-05-03', now, 'Europe/Paris')).toBe(true); // today-14
    expect(isHabitDateWithinLocalWindow('2026-05-18', now, 'Europe/Paris')).toBe(true); // today+1
  });

  it('rejects just outside both Paris bounds', () => {
    expect(isHabitDateWithinLocalWindow('2026-05-02', now, 'Europe/Paris')).toBe(false); // today-15
    expect(isHabitDateWithinLocalWindow('2026-05-19', now, 'Europe/Paris')).toBe(false); // today+2
  });

  it('uses the window constants (not magic numbers)', () => {
    expect(HABIT_BACKFILL_WINDOW_DAYS).toBe(14);
    expect(HABIT_FORWARD_WINDOW_DAYS).toBe(1);
  });

  it('degrades deterministically (no throw) on an unknown/empty timezone — localDateOf falls back to UTC', () => {
    // Bad IANA string → localDateOf treats as UTC. now UTC day = 2026-05-16
    // → window [2026-05-02, 2026-05-17] computed off UTC.
    expect(isHabitDateWithinLocalWindow('2026-05-16', now, 'Not/AZone')).toBe(true);
    expect(isHabitDateWithinLocalWindow('2026-05-18', now, '')).toBe(false); // > UTC max 2026-05-17
    expect(isHabitDateWithinLocalWindow('2026-05-17', now, '')).toBe(true); // UTC today+1 bound
  });
});
