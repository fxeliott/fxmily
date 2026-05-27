/**
 * V2.3 ext #2 — Session HH frontend pure formatters tests.
 *
 * RTL-free : these are pure functions, no React. Tests cover the canonical
 * outputs FR + edge cases (clamp, division by zero, empty branches).
 */

import { describe, expect, it } from 'vitest';

import {
  REASON_LABEL_FR,
  REASON_ORDER,
  REASON_TONE,
  distributionPercents,
  emptyCopyForReason,
  formatRMagnitude,
  formatRatePercent,
  formatSampleSize,
} from './format-analytics';

describe('REASON_LABEL_FR', () => {
  it('maps 4 canonical reasons to FR labels', () => {
    expect(REASON_LABEL_FR.edge).toBe('Edge');
    expect(REASON_LABEL_FR.fomo).toBe('FOMO');
    expect(REASON_LABEL_FR.revenge).toBe('Revanche');
    expect(REASON_LABEL_FR.boredom).toBe('Ennui');
  });
});

describe('REASON_TONE', () => {
  it('only `edge` is accented (lime), the 3 others are mute (slate)', () => {
    expect(REASON_TONE.edge).toBe('acc');
    expect(REASON_TONE.fomo).toBe('mute');
    expect(REASON_TONE.revenge).toBe('mute');
    expect(REASON_TONE.boredom).toBe('mute');
  });
});

describe('REASON_ORDER', () => {
  it('places edge first, then fomo → revenge → boredom (ADR-003 narrative)', () => {
    expect(REASON_ORDER).toEqual(['edge', 'fomo', 'revenge', 'boredom']);
  });
});

describe('formatRatePercent', () => {
  it('formats 0.78 → "78 %" FR', () => {
    // FR uses NBSP between number and percent sign.
    const out = formatRatePercent(0.78);
    expect(out).toMatch(/^78\s%$/);
  });

  it('formats 0 → "0 %"', () => {
    const out = formatRatePercent(0);
    expect(out).toMatch(/^0\s%$/);
  });

  it('formats 1 → "100 %"', () => {
    const out = formatRatePercent(1);
    expect(out).toMatch(/^100\s%$/);
  });

  it('clamps below 0 → "0 %" (defensive)', () => {
    const out = formatRatePercent(-0.5);
    expect(out).toMatch(/^0\s%$/);
  });

  it('clamps above 1 → "100 %" (defensive)', () => {
    const out = formatRatePercent(1.5);
    expect(out).toMatch(/^100\s%$/);
  });

  it('rounds 0.785 → "79 %" (banker rounding via Intl)', () => {
    const out = formatRatePercent(0.785);
    // Intl uses half-up by default in modern engines; 78 or 79 both acceptable
    // (no contractual rounding mode). We assert it's one of the two.
    expect(out).toMatch(/^(78|79)\s%$/);
  });
});

describe('formatSampleSize', () => {
  it('formats 23 → "n = 23" with NBSP', () => {
    expect(formatSampleSize(23)).toBe('n = 23');
  });

  it('formats 0 → "n = 0"', () => {
    expect(formatSampleSize(0)).toBe('n = 0');
  });

  it('formats 999+ → "n ≥ 999" with NBSP', () => {
    expect(formatSampleSize(1000)).toBe('n ≥ 999');
    expect(formatSampleSize(999)).toBe('n ≥ 999');
  });
});

describe('emptyCopyForReason', () => {
  it('no_checks → invitation au 1er check (n minimum mentionné)', () => {
    const out = emptyCopyForReason('no_checks', 0, 8);
    // Case-insensitive : titre commence par capital "Pas encore"
    expect(out.title).toMatch(/pas encore/i);
    expect(out.subtitle).toContain('8');
    expect(out.subtitle).toContain('premier');
  });

  it('below_threshold → décompte vers le seuil', () => {
    const out = emptyCopyForReason('below_threshold', 3, 8);
    expect(out.title).toContain('5'); // 8 - 3
    expect(out.title).toMatch(/check/);
    expect(out.subtitle).toContain('3');
    expect(out.subtitle).toContain('8');
  });

  it('below_threshold avec n=7 → "encore 1 check" (singulier)', () => {
    const out = emptyCopyForReason('below_threshold', 7, 8);
    expect(out.title).toMatch(/Encore 1 check\b/); // singular, no 's'
    expect(out.subtitle).toContain('7 checks');
  });

  it('below_threshold avec n=1 → "fait" singulier', () => {
    const out = emptyCopyForReason('below_threshold', 1, 8);
    expect(out.subtitle).toContain('1 check fait');
    expect(out.subtitle).not.toContain('checks faits'); // ensure singular not used as fallback
  });

  it('no_linked_trades → invitation à finir un trade après un check (Session II distinct de no_checks)', () => {
    const out = emptyCopyForReason('no_linked_trades', 0, 8);
    expect(out.title).toMatch(/pas encore de trade/i);
    expect(out.subtitle).toContain('15');
    expect(out.subtitle).toContain('8'); // minSample mentioned
  });
});

describe('formatRMagnitude', () => {
  it('null → "—" em-dash (transparence honesty : 0 trade computed)', () => {
    expect(formatRMagnitude(null)).toBe('—');
  });

  it('0 → "0R" (no sign, pas de fake "+0R")', () => {
    expect(formatRMagnitude(0)).toBe('0R');
  });

  it('positive → "+X.XR" avec sign explicite pour comparaison face aux négatifs', () => {
    expect(formatRMagnitude(1)).toBe('+1.0R');
    expect(formatRMagnitude(1.5)).toBe('+1.5R');
    expect(formatRMagnitude(0.8)).toBe('+0.8R');
  });

  it('negative → "-X.XR" sign natif toFixed', () => {
    expect(formatRMagnitude(-1)).toBe('-1.0R');
    expect(formatRMagnitude(-0.5)).toBe('-0.5R');
    expect(formatRMagnitude(-2.3)).toBe('-2.3R');
  });

  it('rounds to 1 decimal (Mark Douglas : pas de bruit cognitif au-delà)', () => {
    // 1.04 rounds to 1.0
    expect(formatRMagnitude(1.04)).toBe('+1.0R');
    // 1.05 rounds to 1.1 (banker's rounding in modern engines, but at least
    // not 1.05). We accept either 1.0 or 1.1.
    const out = formatRMagnitude(1.05);
    expect(out).toMatch(/^\+(1\.0|1\.1)R$/);
  });

  it('handles tiny positive without losing sign', () => {
    expect(formatRMagnitude(0.01)).toBe('+0.0R'); // rounded to 0.0 but sign preserved
  });
});

describe('distributionPercents', () => {
  it('balanced 4×25 → 25% each', () => {
    const out = distributionPercents({ edge: 25, fomo: 25, revenge: 25, boredom: 25 }, 100);
    expect(out.edge).toBe(25);
    expect(out.fomo).toBe(25);
    expect(out.revenge).toBe(25);
    expect(out.boredom).toBe(25);
  });

  it('all-edge → edge 100%, others 0%', () => {
    const out = distributionPercents({ edge: 8, fomo: 0, revenge: 0, boredom: 0 }, 8);
    expect(out.edge).toBe(100);
    expect(out.fomo).toBe(0);
    expect(out.revenge).toBe(0);
    expect(out.boredom).toBe(0);
  });

  it('safe division : sampleSize=0 returns all zeros (no NaN)', () => {
    const out = distributionPercents({ edge: 0, fomo: 0, revenge: 0, boredom: 0 }, 0);
    expect(out.edge).toBe(0);
    expect(Number.isNaN(out.edge)).toBe(false);
  });

  it('proper math 3/10 = 30%', () => {
    const out = distributionPercents({ edge: 3, fomo: 2, revenge: 2, boredom: 3 }, 10);
    expect(out.edge).toBe(30);
    expect(out.fomo).toBe(20);
    expect(out.revenge).toBe(20);
    expect(out.boredom).toBe(30);
  });
});
