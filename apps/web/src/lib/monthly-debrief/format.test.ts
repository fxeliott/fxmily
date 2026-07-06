import { describe, expect, it } from 'vitest';

import { formatMonthInlineFr, formatMonthLabelFr } from './format';

/**
 * SPEC §25 — FR display formatters for the monthly debrief.
 * Pin the contract: valid civil months across the year (accented FR month
 * names asserted exactly), capitalisation (label vs inline), and the
 * defensive fallback — any malformed/out-of-range input returns the raw
 * input string unchanged so a hand-edited row never throws in the render.
 */

describe('formatMonthLabelFr — capitalised member-facing label', () => {
  it.each([
    ['2026-01-01', 'Janvier 2026'],
    ['2026-02-01', 'Février 2026'],
    ['2026-05-01', 'Mai 2026'],
    ['2026-08-01', 'Août 2026'], // allow-absolute-date injected-clock-anchor
    ['2026-12-01', 'Décembre 2026'], // allow-absolute-date injected-clock-anchor
    ['2027-12-01', 'Décembre 2027'], // allow-absolute-date injected-clock-anchor
  ])('formats %s as %s (accents preserved)', (iso, expected) => {
    expect(formatMonthLabelFr(iso)).toBe(expected);
  });
});

describe('formatMonthInlineFr — lowercase mid-sentence form', () => {
  it.each([
    ['2026-01-01', 'janvier 2026'],
    ['2026-02-01', 'février 2026'],
    ['2026-05-01', 'mai 2026'],
    ['2026-08-01', 'août 2026'], // allow-absolute-date injected-clock-anchor
    ['2026-12-01', 'décembre 2026'], // allow-absolute-date injected-clock-anchor
  ])('formats %s as %s (accents preserved)', (iso, expected) => {
    expect(formatMonthInlineFr(iso)).toBe(expected);
  });
});

describe('formatMonthLabelFr / formatMonthInlineFr — defensive fallback', () => {
  it('month 13 is out of range → returns the raw input unchanged', () => {
    expect(formatMonthLabelFr('2026-13-01')).toBe('2026-13-01');
    expect(formatMonthInlineFr('2026-13-01')).toBe('2026-13-01');
  });

  it('month 00 is out of range (index -1) → returns the raw input unchanged', () => {
    expect(formatMonthLabelFr('2026-00-01')).toBe('2026-00-01');
    expect(formatMonthInlineFr('2026-00-01')).toBe('2026-00-01');
  });

  it('a non-4-digit year is rejected → returns the raw input unchanged', () => {
    expect(formatMonthLabelFr('26-05-01')).toBe('26-05-01');
    expect(formatMonthInlineFr('26-05-01')).toBe('26-05-01');
  });

  it('a totally malformed string → returns the raw input unchanged', () => {
    expect(formatMonthLabelFr('garbage')).toBe('garbage');
    expect(formatMonthInlineFr('garbage')).toBe('garbage');
  });
});

describe('formatMonthLabelFr / formatMonthInlineFr — mutual consistency', () => {
  // allow-absolute-date injected-clock-anchor
  it.each(['2026-01-01', '2026-02-01', '2026-05-01', '2026-08-01', '2026-12-01'])(
    // allow-absolute-date injected-clock-anchor
    'for valid input %s the label is the capitalised form of the inline value',
    (iso) => {
      const inline = formatMonthInlineFr(iso);
      const label = formatMonthLabelFr(iso);
      const capitalised = `${inline.charAt(0).toUpperCase()}${inline.slice(1)}`;
      expect(label).toBe(capitalised);
    },
  );

  it('both functions agree on the raw fallback for a malformed input', () => {
    expect(formatMonthLabelFr('not-a-month')).toBe(formatMonthInlineFr('not-a-month'));
  });
});
