import { describe, expect, it } from 'vitest';

import { aggregateRiskDiscipline, aggregateSetupQuality } from './setup-quality';

describe('aggregateSetupQuality', () => {
  it('returns zeros when there are no trades', () => {
    expect(aggregateSetupQuality([])).toEqual({ A: 0, B: 0, C: 0, captured: 0 });
  });

  it('ignores trades with null tradeQuality', () => {
    const r = aggregateSetupQuality([{ tradeQuality: null }, { tradeQuality: null }]);
    expect(r.captured).toBe(0);
  });

  it('counts A/B/C and captured correctly', () => {
    const r = aggregateSetupQuality([
      { tradeQuality: 'A' },
      { tradeQuality: 'A' },
      { tradeQuality: 'B' },
      { tradeQuality: 'C' },
      { tradeQuality: null },
    ]);
    expect(r).toEqual({ A: 2, B: 1, C: 1, captured: 4 });
  });
});

describe('aggregateRiskDiscipline', () => {
  it('returns nulls when no trade carries a riskPct', () => {
    const r = aggregateRiskDiscipline([{ riskPct: null }, { riskPct: null }]);
    expect(r).toEqual({ overTwoCount: 0, median: null, capturedCount: 0 });
  });

  it('treats exactly 2.00 % as respected (strict > 2 breach)', () => {
    const r = aggregateRiskDiscipline([
      { riskPct: '1.00' },
      { riskPct: '2.00' },
      { riskPct: '2.50' },
      { riskPct: '3.00' },
    ]);
    expect(r.overTwoCount).toBe(2);
    expect(r.capturedCount).toBe(4);
  });

  it('computes the median on an even count', () => {
    expect(aggregateRiskDiscipline([{ riskPct: '1.00' }, { riskPct: '2.00' }]).median).toBe(1.5);
  });

  it('computes the median on an odd count', () => {
    const r = aggregateRiskDiscipline([
      { riskPct: '1.00' },
      { riskPct: '1.50' },
      { riskPct: '2.50' },
    ]);
    expect(r.median).toBe(1.5);
  });

  it('ignores non-finite riskPct strings', () => {
    const r = aggregateRiskDiscipline([{ riskPct: 'NaN' }, { riskPct: '1.00' }]);
    expect(r.capturedCount).toBe(1);
  });
});
