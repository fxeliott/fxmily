import { describe, expect, it } from 'vitest';

import { eveningCheckinSchema, localDateSchema, morningCheckinSchema } from './checkin';

/**
 * Zod schemas for the daily check-in flows (J5, SPEC §6.4 + §7.4).
 *
 * The DB allows mostly-nullable columns to share a single table across both
 * slots. The schemas tighten validation per flow:
 *   - morning: sleep block + mood + intention required, evening fields absent.
 *   - evening: discipline + stress + emotion + journal/gratitude (optional).
 *
 * Both flows accept FormData-style string inputs (`z.coerce`) so they can be
 * re-used by the Server Action without manual conversion.
 */

const validMorning = {
  date: '2026-05-06',
  sleepHours: '7.5',
  sleepQuality: '8',
  morningRoutineCompleted: 'true',
  meditationMin: '10',
  sportType: '',
  sportDurationMin: '',
  moodScore: '7',
  intention: 'Trader uniquement à Londres, pas avant.',
  emotionTags: ['rested', 'focused'],
};

const validEvening = {
  date: '2026-05-06',
  planRespectedToday: 'true',
  hedgeRespectedToday: 'na',
  caffeineMl: '500',
  waterLiters: '2',
  stressScore: '4',
  moodScore: '6',
  emotionTags: ['calm'],
  journalNote: 'Bonne discipline, deux setups manqués.',
  gratitudeItems: ['ma routine', 'le calme du matin'],
};

describe('localDateSchema', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(localDateSchema.parse('2026-05-06')).toBe('2026-05-06');
  });
  it('rejects malformed', () => {
    expect(localDateSchema.safeParse('06/05/2026').success).toBe(false);
    expect(localDateSchema.safeParse('').success).toBe(false);
    expect(localDateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(localDateSchema.safeParse('2026-02-30').success).toBe(false);
  });
});

describe('morningCheckinSchema', () => {
  it('accepts a complete valid payload', () => {
    const r = morningCheckinSchema.safeParse(validMorning);
    expect(r.success).toBe(true);
  });

  it('parses sleepHours and meditationMin into numbers', () => {
    const r = morningCheckinSchema.parse(validMorning);
    expect(r.sleepHours).toBe(7.5);
    expect(r.meditationMin).toBe(10);
  });

  it('clamps sleepQuality to 1-10', () => {
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepQuality: '0' }).success).toBe(
      false,
    );
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepQuality: '11' }).success).toBe(
      false,
    );
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepQuality: '1' }).success).toBe(
      true,
    );
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepQuality: '10' }).success).toBe(
      true,
    );
  });

  it('clamps sleepHours to 0-24', () => {
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepHours: '-1' }).success).toBe(
      false,
    );
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepHours: '25' }).success).toBe(
      false,
    );
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepHours: '0' }).success).toBe(true);
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleepHours: '24' }).success).toBe(
      true,
    );
  });

  it('caps meditationMin at 240', () => {
    expect(morningCheckinSchema.safeParse({ ...validMorning, meditationMin: '241' }).success).toBe(
      false,
    );
    expect(morningCheckinSchema.safeParse({ ...validMorning, meditationMin: '240' }).success).toBe(
      true,
    );
  });

  it('caps intention at 200 chars', () => {
    expect(
      morningCheckinSchema.safeParse({ ...validMorning, intention: 'a'.repeat(201) }).success,
    ).toBe(false);
    expect(
      morningCheckinSchema.safeParse({ ...validMorning, intention: 'a'.repeat(200) }).success,
    ).toBe(true);
  });

  it('treats empty intention as undefined', () => {
    const r = morningCheckinSchema.parse({ ...validMorning, intention: '' });
    expect(r.intention).toBeUndefined();
  });

  it('treats empty sportType / sportDurationMin as nulls', () => {
    const r = morningCheckinSchema.parse({ ...validMorning, sportType: '', sportDurationMin: '' });
    expect(r.sportType).toBeNull();
    expect(r.sportDurationMin).toBeNull();
  });

  it('accepts a sport object when both fields are filled', () => {
    const r = morningCheckinSchema.parse({
      ...validMorning,
      sportType: 'course',
      sportDurationMin: '45',
    });
    expect(r.sportType).toBe('course');
    expect(r.sportDurationMin).toBe(45);
  });

  it('rejects sport with only one of the two fields', () => {
    expect(
      morningCheckinSchema.safeParse({
        ...validMorning,
        sportType: 'course',
        sportDurationMin: '',
      }).success,
    ).toBe(false);
    expect(
      morningCheckinSchema.safeParse({
        ...validMorning,
        sportType: '',
        sportDurationMin: '30',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown emotion slugs', () => {
    expect(
      morningCheckinSchema.safeParse({ ...validMorning, emotionTags: ['notreal'] }).success,
    ).toBe(false);
  });

  it('rejects more than 3 emotions', () => {
    expect(
      morningCheckinSchema.safeParse({
        ...validMorning,
        emotionTags: ['rested', 'focused', 'calm', 'optimistic'],
      }).success,
    ).toBe(false);
  });

  it('allows 0 emotions (mood score is the required signal)', () => {
    expect(morningCheckinSchema.safeParse({ ...validMorning, emotionTags: [] }).success).toBe(true);
  });

  it('rejects duplicate emotion tags', () => {
    expect(
      morningCheckinSchema.safeParse({
        ...validMorning,
        emotionTags: ['calm', 'calm'],
      }).success,
    ).toBe(false);
  });

  it('coerces morningRoutineCompleted from "true" / "false"', () => {
    const yes = morningCheckinSchema.parse({ ...validMorning, morningRoutineCompleted: 'true' });
    expect(yes.morningRoutineCompleted).toBe(true);
    const no = morningCheckinSchema.parse({ ...validMorning, morningRoutineCompleted: 'false' });
    expect(no.morningRoutineCompleted).toBe(false);
  });
});

describe('eveningCheckinSchema', () => {
  it('accepts a complete valid payload', () => {
    expect(eveningCheckinSchema.safeParse(validEvening).success).toBe(true);
  });

  it('coerces tri-state hedgeRespectedToday: true/false/na', () => {
    expect(
      eveningCheckinSchema.parse({ ...validEvening, hedgeRespectedToday: 'true' })
        .hedgeRespectedToday,
    ).toBe(true);
    expect(
      eveningCheckinSchema.parse({ ...validEvening, hedgeRespectedToday: 'false' })
        .hedgeRespectedToday,
    ).toBe(false);
    expect(
      eveningCheckinSchema.parse({ ...validEvening, hedgeRespectedToday: 'na' })
        .hedgeRespectedToday,
    ).toBeNull();
  });

  it('clamps stressScore to 1-10', () => {
    expect(eveningCheckinSchema.safeParse({ ...validEvening, stressScore: '0' }).success).toBe(
      false,
    );
    expect(eveningCheckinSchema.safeParse({ ...validEvening, stressScore: '11' }).success).toBe(
      false,
    );
  });

  it('caps caffeineMl at 2000 and rejects negatives', () => {
    expect(eveningCheckinSchema.safeParse({ ...validEvening, caffeineMl: '-1' }).success).toBe(
      false,
    );
    expect(eveningCheckinSchema.safeParse({ ...validEvening, caffeineMl: '2001' }).success).toBe(
      false,
    );
    expect(eveningCheckinSchema.safeParse({ ...validEvening, caffeineMl: '2000' }).success).toBe(
      true,
    );
  });

  it('caps waterLiters at 10 and rejects negatives', () => {
    expect(eveningCheckinSchema.safeParse({ ...validEvening, waterLiters: '-0.5' }).success).toBe(
      false,
    );
    expect(eveningCheckinSchema.safeParse({ ...validEvening, waterLiters: '10.1' }).success).toBe(
      false,
    );
    expect(eveningCheckinSchema.safeParse({ ...validEvening, waterLiters: '10' }).success).toBe(
      true,
    );
  });

  it('caps journalNote at 4000 chars', () => {
    expect(
      eveningCheckinSchema.safeParse({ ...validEvening, journalNote: 'a'.repeat(4001) }).success,
    ).toBe(false);
  });

  it('caps gratitudeItems at 3 entries of 200 chars each', () => {
    expect(
      eveningCheckinSchema.safeParse({
        ...validEvening,
        gratitudeItems: ['1', '2', '3', '4'],
      }).success,
    ).toBe(false);
    expect(
      eveningCheckinSchema.safeParse({
        ...validEvening,
        gratitudeItems: ['a'.repeat(201)],
      }).success,
    ).toBe(false);
  });

  it('drops empty-string gratitude items', () => {
    const r = eveningCheckinSchema.parse({
      ...validEvening,
      gratitudeItems: ['un', '', '  ', 'deux'],
    });
    expect(r.gratitudeItems).toEqual(['un', 'deux']);
  });

  it('treats empty caffeineMl / waterLiters / journalNote as null/undefined', () => {
    const r = eveningCheckinSchema.parse({
      ...validEvening,
      caffeineMl: '',
      waterLiters: '',
      journalNote: '',
    });
    expect(r.caffeineMl).toBeNull();
    expect(r.waterLiters).toBeNull();
    expect(r.journalNote).toBeUndefined();
  });

  it('rejects unknown emotion slugs', () => {
    expect(
      eveningCheckinSchema.safeParse({ ...validEvening, emotionTags: ['notreal'] }).success,
    ).toBe(false);
  });

  it('rejects future dates beyond a 1-day drift window', () => {
    // Schema accepts TODAY+1 (UTC) to absorb timezone drift Tokyo↔NY. Reject
    // anything beyond that.
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(eveningCheckinSchema.safeParse({ ...validEvening, date: future }).success).toBe(false);
  });

  it('rejects ridiculously old dates', () => {
    expect(eveningCheckinSchema.safeParse({ ...validEvening, date: '1999-01-01' }).success).toBe(
      false,
    );
  });
});
