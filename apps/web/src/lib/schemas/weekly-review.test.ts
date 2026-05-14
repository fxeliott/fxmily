import { describe, expect, it } from 'vitest';

import {
  REVIEW_TEXT_MAX_CHARS,
  buildReviewCorpus,
  weekEndFromWeekStart,
  weeklyReviewSchema,
} from './weekly-review';

/**
 * Helper — pick a Monday `YYYY-MM-DD` within the validation window. We anchor
 * on "today (UTC)" then walk back to the most recent Monday. This keeps the
 * tests stable across CI clocks without hard-coding a date that will fall out
 * of the 35-day window over time.
 */
function lastMondayUTC(): string {
  const d = new Date();
  // 1 = Monday in JS. Walk back to Monday (0 if today is Monday).
  const dayUtc = d.getUTCDay();
  const offset = (dayUtc + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Helper — a Monday that pre-dates the validation window. Walk back ~6 weeks
 * to guarantee `>35d` regardless of which weekday we're running on.
 */
function ancientMondayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7 * 6);
  // Snap to Monday by walking back (Mon=1).
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

const baseInput = {
  weekStart: lastMondayUTC(),
  biggestWin: 'Closed at TP per plan despite tempting trail.',
  biggestMistake: 'Skipped pre-trade checklist on Tuesday London open.',
  bestPractice: 'Held my hedge rule even when down -0.5R on the hour.',
  lessonLearned: 'Trust the plan; the checklist is the plan.',
  nextWeekFocus: 'Run the full checklist before EVERY trade entry.',
};

describe('weeklyReviewSchema', () => {
  it('accepts a valid submission with all five fields', () => {
    const result = weeklyReviewSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bestPractice).not.toBeNull();
      expect(result.data.biggestWin).toContain('Closed at TP');
    }
  });

  it('accepts an omitted bestPractice (transforms to null)', () => {
    const { bestPractice: _unused, ...rest } = baseInput;
    void _unused;
    const result = weeklyReviewSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bestPractice).toBeNull();
    }
  });

  it('rejects a weekStart that is not a Monday', () => {
    // Build a Tuesday: take last Monday and shift +1 day.
    const tuesday = new Date(`${lastMondayUTC()}T00:00:00Z`);
    tuesday.setUTCDate(tuesday.getUTCDate() + 1);
    const result = weeklyReviewSchema.safeParse({
      ...baseInput,
      weekStart: tuesday.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /lundi/i.test(i.message))).toBe(true);
    }
  });

  it('rejects a weekStart older than the past horizon (>35 d)', () => {
    const result = weeklyReviewSchema.safeParse({
      ...baseInput,
      weekStart: ancientMondayUTC(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a required field shorter than the min char count', () => {
    const result = weeklyReviewSchema.safeParse({ ...baseInput, biggestWin: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects a required field longer than the max char count', () => {
    const result = weeklyReviewSchema.safeParse({
      ...baseInput,
      lessonLearned: 'a'.repeat(REVIEW_TEXT_MAX_CHARS + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects bidi/zero-width control characters in any field', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE inside an otherwise-valid string.
    const trojan = `Innocent text‮XYZ trojan content padding here.`;
    const result = weeklyReviewSchema.safeParse({ ...baseInput, biggestMistake: trojan });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /contr[oô]le/i.test(i.message))).toBe(true);
    }
  });

  it('NFC-normalizes and trims text before persistence', () => {
    // "café" composed (1 codepoint) vs decomposed (e + combining acute = 2)
    // — both must round-trip to the NFC-composed form after the transform.
    const decomposed = `   ${'café'} is great and so is process focus.   `;
    const result = weeklyReviewSchema.safeParse({ ...baseInput, biggestWin: decomposed });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.biggestWin.startsWith('café')).toBe(true); // NFC form
      expect(result.data.biggestWin.endsWith('focus.')).toBe(true); // trimmed
    }
  });
});

describe('weekEndFromWeekStart', () => {
  it('returns the Sunday six days after the Monday weekStart', () => {
    const weekStart = '2026-05-11'; // Monday
    const weekEnd = weekEndFromWeekStart(weekStart);
    expect(weekEnd.toISOString().slice(0, 10)).toBe('2026-05-17'); // Sunday
    expect(weekEnd.getUTCDay()).toBe(0); // 0 = Sunday
  });
});

describe('buildReviewCorpus', () => {
  it('concatenates all five fields in deterministic order with newlines', () => {
    const corpus = buildReviewCorpus({
      weekStart: '2026-05-11',
      biggestWin: 'win',
      biggestMistake: 'mistake',
      bestPractice: 'practice',
      lessonLearned: 'lesson',
      nextWeekFocus: 'focus',
    });
    expect(corpus).toBe('win\nmistake\npractice\nlesson\nfocus');
  });

  it('substitutes empty string when bestPractice is null', () => {
    const corpus = buildReviewCorpus({
      weekStart: '2026-05-11',
      biggestWin: 'win',
      biggestMistake: 'mistake',
      bestPractice: null,
      lessonLearned: 'lesson',
      nextWeekFocus: 'focus',
    });
    expect(corpus).toBe('win\nmistake\n\nlesson\nfocus');
  });
});
