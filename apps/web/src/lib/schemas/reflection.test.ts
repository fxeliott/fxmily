import { describe, expect, it } from 'vitest';

import {
  REFLECTION_TEXT_MAX_CHARS,
  buildReflectionCorpus,
  reflectionEntrySchema,
} from './reflection';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgoUTC(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const baseInput = {
  date: todayUTC(),
  triggerEvent: 'Saw the NFP miss expectations by 50k jobs at 13:30 GMT.',
  beliefAuto: 'I have to chase this move now or miss everything.',
  consequence: 'Felt FOMO, broke my "no NFP first 5 min" rule, entered.',
  disputation:
    'The plan exists for high-volatility moments precisely. Skipping NFP costs me one trade; chasing it can cost me my week.',
};

describe('reflectionEntrySchema', () => {
  it('accepts a valid ABCD reflection', () => {
    const result = reflectionEntrySchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.triggerEvent).toContain('NFP');
      expect(result.data.disputation.length).toBeGreaterThan(50);
    }
  });

  it('rejects an ABCD field shorter than the min char count', () => {
    const result = reflectionEntrySchema.safeParse({ ...baseInput, beliefAuto: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects bidi/zero-width control characters in any ABCD field', () => {
    const trojan = `Innocent prefix‮XYZ visible suffix padding here for min len.`;
    const result = reflectionEntrySchema.safeParse({ ...baseInput, consequence: trojan });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /contr[oô]le/i.test(i.message))).toBe(true);
    }
  });

  it('rejects a date older than the 14-day backfill window', () => {
    const result = reflectionEntrySchema.safeParse({ ...baseInput, date: nDaysAgoUTC(20) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /ancien/i.test(i.message))).toBe(true);
    }
  });

  it('rejects a field over the max char count', () => {
    const result = reflectionEntrySchema.safeParse({
      ...baseInput,
      disputation: 'a'.repeat(REFLECTION_TEXT_MAX_CHARS + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe('buildReflectionCorpus', () => {
  it('concatenates the four ABCD fields with newline separators in canonical order', () => {
    const corpus = buildReflectionCorpus({
      date: '2026-05-13',
      triggerEvent: 'A',
      beliefAuto: 'B',
      consequence: 'C',
      disputation: 'D',
    });
    expect(corpus).toBe('A\nB\nC\nD');
  });
});
