import { describe, expect, it } from 'vitest';

import {
  CURRENT_MINDSET_INSTRUMENT,
  CURRENT_MINDSET_INSTRUMENT_VERSION,
  getMindsetInstrument,
  MINDSET_INSTRUMENT_V1,
  MINDSET_INSTRUMENTS,
  MINDSET_LIKERT_MAX,
  MINDSET_LIKERT_MIN,
} from './instrument';

/**
 * SPEC §27.3/§27.7 — frozen versioned instrument contract. These assertions
 * are the longitudinal-validity guard: they FAIL if a future edit silently
 * mutates v1 (renamed id, changed dimension count, broken scale) instead of
 * shipping a new version. Also a light posture guard (§2): no item references
 * P&L / the Lhedge system / market analysis.
 */

const EXPECTED_DIMENSION_IDS = [
  'uncertainty_acceptance',
  'ego_result_detachment',
  'discipline_plan_adherence',
  'emotional_regulation',
  'confidence_calibration',
  'patience_anti_fomo',
] as const;

describe('MINDSET_INSTRUMENT_V1 — frozen contract', () => {
  it('is version 1 and is the current instrument', () => {
    expect(MINDSET_INSTRUMENT_V1.version).toBe(1);
    expect(CURRENT_MINDSET_INSTRUMENT).toBe(MINDSET_INSTRUMENT_V1);
    expect(CURRENT_MINDSET_INSTRUMENT_VERSION).toBe(1);
  });

  it('has exactly the 6 expected dimensions, ids unique', () => {
    const ids = MINDSET_INSTRUMENT_V1.dimensions.map((d) => d.id);
    expect(ids).toEqual([...EXPECTED_DIMENSION_IDS]);
    expect(new Set(ids).size).toBe(6);
    for (const d of MINDSET_INSTRUMENT_V1.dimensions) {
      expect(d.label.trim().length).toBeGreaterThan(0);
      expect(d.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('has exactly 12 items, ids unique, each mapped to a known dimension', () => {
    const items = MINDSET_INSTRUMENT_V1.items;
    expect(items).toHaveLength(12);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(12);
    const dimIds = new Set<string>(EXPECTED_DIMENSION_IDS);
    for (const it of items) {
      expect(dimIds.has(it.dimensionId)).toBe(true);
      expect(it.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('has exactly 2 items per dimension (locked §27.3)', () => {
    for (const dim of EXPECTED_DIMENSION_IDS) {
      const n = MINDSET_INSTRUMENT_V1.items.filter((i) => i.dimensionId === dim).length;
      expect(n).toBe(2);
    }
  });

  it('Likert scale is exactly 5 ascending anchors 1..5 with non-empty labels', () => {
    const scale = MINDSET_INSTRUMENT_V1.likertScale;
    expect(scale.map((a) => a.value)).toEqual([1, 2, 3, 4, 5]);
    expect(MINDSET_LIKERT_MIN).toBe(1);
    expect(MINDSET_LIKERT_MAX).toBe(5);
    for (const a of scale) expect(a.label.trim().length).toBeGreaterThan(0);
  });

  it('preamble exists and frames "no right answer" (§27.2 no-judgement)', () => {
    expect(MINDSET_INSTRUMENT_V1.preamble.trim().length).toBeGreaterThan(0);
    expect(MINDSET_INSTRUMENT_V1.preamble.toLowerCase()).toContain('pas de bonne');
  });

  it('posture guard (§2): no item mentions P&L / pips / R:R / the Lhedge system', () => {
    const banned = /lhedge|\bP&L\b|\bpips?\b|\bR:R\b|\bprofit\b|\bpnl\b/i;
    for (const it of MINDSET_INSTRUMENT_V1.items) {
      expect(banned.test(it.label)).toBe(false);
    }
  });
});

describe('instrument registry', () => {
  it('MINDSET_INSTRUMENTS contains v1', () => {
    expect(MINDSET_INSTRUMENTS).toContain(MINDSET_INSTRUMENT_V1);
  });

  it('getMindsetInstrument resolves a shipped version and refuses unknown ones', () => {
    expect(getMindsetInstrument(1)).toBe(MINDSET_INSTRUMENT_V1);
    expect(getMindsetInstrument(0)).toBeUndefined();
    expect(getMindsetInstrument(2)).toBeUndefined();
    expect(getMindsetInstrument(999)).toBeUndefined();
  });
});
