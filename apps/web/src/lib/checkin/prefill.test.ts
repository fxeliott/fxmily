import { describe, expect, it } from 'vitest';

import { toEveningPrefill, toMorningPrefill } from './prefill';
import type { SerializedCheckin } from './service';

/**
 * A fully-populated serialized check-in. Individual tests override the fields
 * they exercise so each assertion stays focused (the wizard shapes are wide).
 */
function makeCheckin(overrides: Partial<SerializedCheckin> = {}): SerializedCheckin {
  return {
    id: 'ci_1',
    userId: 'usr_1',
    date: '2026-07-02',
    slot: 'morning',
    sleepHours: '7.5',
    sleepQuality: 8,
    morningRoutineCompleted: true,
    marketAnalysisDone: false,
    meditationMin: 12,
    sportType: 'Course',
    sportDurationMin: 45,
    intention: 'Trader uniquement Londres',
    planRespectedToday: true,
    hedgeRespectedToday: false,
    intentionKept: true,
    formationFollowed: false,
    caffeineMl: 250,
    waterLiters: '2.5',
    stressScore: 4,
    gratitudeItems: ['soleil', 'café', 'sport'],
    moodScore: 7,
    emotionTags: ['calm', 'focused'],
    journalNote: 'Bonne session, discipline tenue.',
    lateJustification: null,
    backfilledAt: null,
    submittedAt: '2026-07-02T07:00:00.000Z',
    createdAt: '2026-07-02T07:00:00.000Z',
    updatedAt: '2026-07-02T07:00:00.000Z',
    ...overrides,
  };
}

describe('toMorningPrefill', () => {
  it('maps a fully-populated morning check-in field-by-field', () => {
    const prefill = toMorningPrefill(makeCheckin());
    expect(prefill).toEqual({
      sleepHours: '7.5',
      sleepQuality: 8,
      morningRoutineCompleted: true,
      marketAnalysisDone: false,
      meditationMin: '12',
      sportType: 'Course',
      sportDurationMin: '45',
      moodScore: 7,
      emotionTags: ['calm', 'focused'],
      intention: 'Trader uniquement Londres',
    });
  });

  it('serializes nullable numbers to empty strings, not "null"', () => {
    const prefill = toMorningPrefill(
      makeCheckin({ meditationMin: null, sportDurationMin: null, sleepHours: null }),
    );
    expect(prefill.meditationMin).toBe('');
    expect(prefill.sportDurationMin).toBe('');
    expect(prefill.sleepHours).toBe('');
  });

  it('keeps null yes/no toggles as null so the wizard re-asks them', () => {
    const prefill = toMorningPrefill(
      makeCheckin({ morningRoutineCompleted: null, marketAnalysisDone: null }),
    );
    expect(prefill.morningRoutineCompleted).toBeNull();
    expect(prefill.marketAnalysisDone).toBeNull();
  });

  it('falls back to in-range slider defaults when scores are null', () => {
    const prefill = toMorningPrefill(makeCheckin({ sleepQuality: null, moodScore: null }));
    expect(prefill.sleepQuality).toBe(6);
    expect(prefill.moodScore).toBe(6);
  });

  it('drops emotion slugs the picker no longer knows', () => {
    const prefill = toMorningPrefill(
      makeCheckin({ emotionTags: ['calm', 'retired_slug', 'focused'] }),
    );
    expect(prefill.emotionTags).toEqual(['calm', 'focused']);
  });

  it('serializes a null intention/sportType to empty strings', () => {
    const prefill = toMorningPrefill(makeCheckin({ intention: null, sportType: null }));
    expect(prefill.intention).toBe('');
    expect(prefill.sportType).toBe('');
  });

  it('clamps a legacy over-bound meditation to the domain cap so the edit form stays savable', () => {
    // Regression guard (J5.2 cross-surface fix): a meditation stored under the
    // old 240 cap must not seed the wizard with a value its now-180 validation
    // rejects — that would block the WHOLE morning form on an untouched field.
    // Clamping converges the legacy value onto the bound TRACK already shows.
    expect(toMorningPrefill(makeCheckin({ meditationMin: 200 })).meditationMin).toBe('180');
    expect(toMorningPrefill(makeCheckin({ meditationMin: 240 })).meditationMin).toBe('180');
    // An in-bound value passes through untouched.
    expect(toMorningPrefill(makeCheckin({ meditationMin: 180 })).meditationMin).toBe('180');
    expect(toMorningPrefill(makeCheckin({ meditationMin: 45 })).meditationMin).toBe('45');
  });
});

describe('toEveningPrefill', () => {
  it('maps a fully-populated evening check-in field-by-field', () => {
    const prefill = toEveningPrefill(makeCheckin({ slot: 'evening' }));
    expect(prefill).toEqual({
      planRespectedToday: true,
      hedgeRespectedToday: 'false',
      intentionKept: 'true',
      formationFollowed: 'false',
      caffeineMl: '250',
      waterLiters: '2.5',
      stressScore: 4,
      moodScore: 7,
      emotionTags: ['calm', 'focused'],
      journalNote: 'Bonne session, discipline tenue.',
      gratitudeItems: ['soleil', 'café', 'sport'],
    });
  });

  it('maps nullable tri-states to the empty (unanswered) string', () => {
    const prefill = toEveningPrefill(
      makeCheckin({
        slot: 'evening',
        hedgeRespectedToday: null,
        intentionKept: null,
        formationFollowed: null,
      }),
    );
    expect(prefill.hedgeRespectedToday).toBe('');
    expect(prefill.intentionKept).toBe('');
    expect(prefill.formationFollowed).toBe('');
  });

  it('keeps a null plan toggle as null so the wizard re-asks it', () => {
    const prefill = toEveningPrefill(makeCheckin({ slot: 'evening', planRespectedToday: null }));
    expect(prefill.planRespectedToday).toBeNull();
  });

  it('pads a short gratitude array to a fixed 3-tuple', () => {
    const prefill = toEveningPrefill(makeCheckin({ slot: 'evening', gratitudeItems: ['un'] }));
    expect(prefill.gratitudeItems).toEqual(['un', '', '']);
  });

  it('handles an empty gratitude array', () => {
    const prefill = toEveningPrefill(makeCheckin({ slot: 'evening', gratitudeItems: [] }));
    expect(prefill.gratitudeItems).toEqual(['', '', '']);
  });

  it('serializes nullable numbers and text to empty strings', () => {
    const prefill = toEveningPrefill(
      makeCheckin({ slot: 'evening', caffeineMl: null, waterLiters: null, journalNote: null }),
    );
    expect(prefill.caffeineMl).toBe('');
    expect(prefill.waterLiters).toBe('');
    expect(prefill.journalNote).toBe('');
  });
});
