import { describe, expect, it } from 'vitest';

import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';

import {
  buildTrainingDebriefCorpus,
  trainingDebriefSchema,
  type TrainingDebriefInput,
} from './training-debrief';

/**
 * SPEC §23 / §23.7 — weekStart must be a Monday in the Europe/Paris
 * `[-35d, +7d]` window (anchored via `localDateOf`, never the UTC slice),
 * `.strict()` rejects smuggled keys, free-text is Trojan-Source hardened.
 */

/** This week's Monday in Europe/Paris (deterministic from "now"). */
function thisWeekMonday(): string {
  let d = localDateOf(new Date(), 'Europe/Paris');
  // parseLocalDate → UTC-midnight; getUTCDay 1 = Monday. Walk back ≤6 days.
  for (let i = 0; i < 7; i += 1) {
    if (parseLocalDate(d).getUTCDay() === 1) return d;
    d = shiftLocalDate(d, -1);
  }
  return d;
}

const VALID: TrainingDebriefInput = {
  weekStart: thisWeekMonday(),
  processStrengthOne: 'J’ai attendu mon setup au lieu de forcer une entrée.',
  processStrengthTwo: 'J’ai journalisé chaque backtest sans en sauter.',
  microAdjustment: 'Préparer la watchlist la veille au soir.',
  transversalLesson: 'La régularité bat l’intensité ponctuelle.',
};

describe('trainingDebriefSchema — weekStart Monday + window', () => {
  it('accepts a valid current-week Monday', () => {
    expect(trainingDebriefSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects a non-Monday', () => {
    const tuesday = shiftLocalDate(thisWeekMonday(), 1);
    const r = trainingDebriefSchema.safeParse({ ...VALID, weekStart: tuesday });
    expect(r.success).toBe(false);
  });

  it('rejects a Monday older than 35 days', () => {
    // 7 Mondays back ≈ 49 days → outside the [-35d] horizon.
    let old = thisWeekMonday();
    for (let i = 0; i < 7; i += 1) old = shiftLocalDate(old, -7);
    const r = trainingDebriefSchema.safeParse({ ...VALID, weekStart: old });
    expect(r.success).toBe(false);
  });

  it('rejects a Monday more than 7 days in the future', () => {
    let future = thisWeekMonday();
    for (let i = 0; i < 3; i += 1) future = shiftLocalDate(future, 7);
    const r = trainingDebriefSchema.safeParse({ ...VALID, weekStart: future });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed date string', () => {
    expect(trainingDebriefSchema.safeParse({ ...VALID, weekStart: '2026-13-40' }).success).toBe(
      false,
    );
  });
});

describe('trainingDebriefSchema — free-text hardening + strict', () => {
  it('rejects free-text containing a bidi / zero-width control char', () => {
    const r = trainingDebriefSchema.safeParse({
      ...VALID,
      processStrengthOne: `Discipline‮malveillante mais longue assez`,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a too-short field', () => {
    const r = trainingDebriefSchema.safeParse({ ...VALID, microAdjustment: 'court' });
    expect(r.success).toBe(false);
  });

  it('trims + NFC-normalises accepted free-text', () => {
    const r = trainingDebriefSchema.safeParse({
      ...VALID,
      transversalLesson: '   La patience est une position.   ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.transversalLesson).toBe('La patience est une position.');
  });

  it('rejects a smuggled extra key (.strict())', () => {
    const r = trainingDebriefSchema.safeParse({ ...VALID, resultR: 1.8 });
    expect(r.success).toBe(false);
  });
});

describe('buildTrainingDebriefCorpus', () => {
  it('joins the 4 fields in a deterministic order', () => {
    const parsed = trainingDebriefSchema.parse(VALID);
    expect(buildTrainingDebriefCorpus(parsed)).toBe(
      [
        parsed.processStrengthOne,
        parsed.processStrengthTwo,
        parsed.microAdjustment,
        parsed.transversalLesson,
      ].join('\n'),
    );
  });
});
