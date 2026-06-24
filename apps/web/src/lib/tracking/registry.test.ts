import { describe, expect, it } from 'vitest';

import {
  getCurrentInstrument,
  getCurrentInstruments,
  getInstrument,
  TRACKING_INSTRUMENT_KEYS,
  TRACKING_INSTRUMENTS,
} from './registry';

describe('tracking instrument registry', () => {
  it('has unique (key, version) pairs', () => {
    const pairs = TRACKING_INSTRUMENTS.map((i) => `${i.key}@${i.version}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('every instrument has at least one question with unique ids', () => {
    for (const inst of TRACKING_INSTRUMENTS) {
      expect(inst.questions.length).toBeGreaterThan(0);
      const ids = inst.questions.map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every instrument axis is a known taxonomy axis', () => {
    for (const inst of TRACKING_INSTRUMENTS) {
      expect(typeof inst.axis).toBe('string');
      expect(inst.axis.length).toBeGreaterThan(0);
    }
  });

  it('getInstrument resolves an exact (key, version), undefined otherwise', () => {
    expect(getInstrument('process-fidelity', 'v1')?.key).toBe('process-fidelity');
    expect(getInstrument('process-fidelity', 'v999')).toBeUndefined();
    expect(getInstrument('nope', 'v1')).toBeUndefined();
  });

  it('getCurrentInstrument returns one instrument per key', () => {
    for (const key of TRACKING_INSTRUMENT_KEYS) {
      expect(getCurrentInstrument(key)?.key).toBe(key);
    }
    expect(getCurrentInstruments()).toHaveLength(TRACKING_INSTRUMENT_KEYS.length);
  });
});
