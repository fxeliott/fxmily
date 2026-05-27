/**
 * V2.3 ext #2 — Session HH backend (Dashboard analytics widget) pure module tests.
 *
 * TDD-first per `feedback_backend_first_workflow.md` (Eliot canon).
 *
 * Honesty structurelle (carbone V2.1.3 habit-trade-correlation) :
 *   - `MIN_SAMPLE_PRE_TRADE_ANALYTICS = 8` floor → below = insufficient_data
 *   - Discriminated union `{kind: 'ok'} | {kind: 'insufficient_data', reason}` — branch
 *     `insufficient_data` n'expose PAS de `distribution`/`rate` (impossible de mentir avec n=4)
 *   - Empty input → `reason: 'no_checks'` distinct de `'below_threshold'` (≥1 ∧ <8)
 *
 * Window filtering = service-layer concern. Ce module reçoit l'array déjà filtré 30j.
 * Pure functions : 0 DB, 0 I/O, 0 Date.now(), 0 imports server-only.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_SAMPLE_PRE_TRADE_ANALYTICS,
  computePlanAlignmentRate,
  computeReasonDistribution,
  computeStopLossPredefinedRate,
  type PreTradeAnalyticsInput,
} from './analytics';

function mk(
  reasonToTrade: PreTradeAnalyticsInput['reasonToTrade'],
  planAlignment: boolean,
  stopLossPredefined: boolean,
): PreTradeAnalyticsInput {
  return { reasonToTrade, planAlignment, stopLossPredefined };
}

describe('MIN_SAMPLE_PRE_TRADE_ANALYTICS', () => {
  it('is 8 (aligned V2.1.3 habit-trade-correlation MIN_CORRELATION_PAIRS)', () => {
    expect(MIN_SAMPLE_PRE_TRADE_ANALYTICS).toBe(8);
  });
});

describe('computeReasonDistribution', () => {
  it('empty array → insufficient_data with reason no_checks', () => {
    const result = computeReasonDistribution([]);
    expect(result.kind).toBe('insufficient_data');
    if (result.kind === 'insufficient_data') {
      expect(result.sampleSize).toBe(0);
      expect(result.reason).toBe('no_checks');
    }
  });

  it('1 check → insufficient_data with reason below_threshold', () => {
    const result = computeReasonDistribution([mk('edge', true, true)]);
    expect(result.kind).toBe('insufficient_data');
    if (result.kind === 'insufficient_data') {
      expect(result.sampleSize).toBe(1);
      expect(result.reason).toBe('below_threshold');
    }
  });

  it('7 checks → insufficient_data with reason below_threshold (just under floor)', () => {
    const checks = Array.from({ length: 7 }, () => mk('edge', true, true));
    const result = computeReasonDistribution(checks);
    expect(result.kind).toBe('insufficient_data');
    if (result.kind === 'insufficient_data') {
      expect(result.sampleSize).toBe(7);
      expect(result.reason).toBe('below_threshold');
    }
  });

  it('8 checks all edge → ok with {edge: 8, fomo: 0, revenge: 0, boredom: 0} (threshold OK)', () => {
    const checks = Array.from({ length: 8 }, () => mk('edge', true, true));
    const result = computeReasonDistribution(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.sampleSize).toBe(8);
      expect(result.distribution).toEqual({ edge: 8, fomo: 0, revenge: 0, boredom: 0 });
    }
  });

  it('10 mixed checks → counts canonical 4 reasons', () => {
    const checks: PreTradeAnalyticsInput[] = [
      mk('edge', true, true),
      mk('edge', true, true),
      mk('edge', false, true),
      mk('fomo', false, false),
      mk('fomo', true, false),
      mk('revenge', false, false),
      mk('revenge', false, false),
      mk('boredom', false, true),
      mk('boredom', false, true),
      mk('boredom', true, false),
    ];
    const result = computeReasonDistribution(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.sampleSize).toBe(10);
      expect(result.distribution).toEqual({ edge: 3, fomo: 2, revenge: 2, boredom: 3 });
    }
  });

  it('100 checks all boredom → no cap, returns full distribution', () => {
    const checks = Array.from({ length: 100 }, () => mk('boredom', false, false));
    const result = computeReasonDistribution(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.sampleSize).toBe(100);
      expect(result.distribution).toEqual({ edge: 0, fomo: 0, revenge: 0, boredom: 100 });
    }
  });
});

describe('computePlanAlignmentRate', () => {
  it('empty array → insufficient_data no_checks', () => {
    const result = computePlanAlignmentRate([]);
    expect(result.kind).toBe('insufficient_data');
    if (result.kind === 'insufficient_data') {
      expect(result.sampleSize).toBe(0);
      expect(result.reason).toBe('no_checks');
    }
  });

  it('7 checks → insufficient_data below_threshold', () => {
    const checks = Array.from({ length: 7 }, () => mk('edge', true, true));
    const result = computePlanAlignmentRate(checks);
    expect(result.kind).toBe('insufficient_data');
    if (result.kind === 'insufficient_data') {
      expect(result.reason).toBe('below_threshold');
    }
  });

  it('8 all planAlignment=true → rate 1.0', () => {
    const checks = Array.from({ length: 8 }, () => mk('edge', true, true));
    const result = computePlanAlignmentRate(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.sampleSize).toBe(8);
      expect(result.rate).toBe(1);
    }
  });

  it('8 all planAlignment=false → rate 0.0 (distinct from insufficient_data)', () => {
    const checks = Array.from({ length: 8 }, () => mk('edge', false, true));
    const result = computePlanAlignmentRate(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.sampleSize).toBe(8);
      expect(result.rate).toBe(0);
    }
  });

  it('8 with 4 true → rate 0.5', () => {
    const checks: PreTradeAnalyticsInput[] = [
      mk('edge', true, true),
      mk('edge', true, true),
      mk('edge', true, true),
      mk('edge', true, true),
      mk('edge', false, true),
      mk('edge', false, true),
      mk('edge', false, true),
      mk('edge', false, true),
    ];
    const result = computePlanAlignmentRate(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.rate).toBe(0.5);
    }
  });

  it('10 with 7 true → rate 0.7', () => {
    const checks: PreTradeAnalyticsInput[] = [
      ...Array.from({ length: 7 }, () => mk('edge', true, true)),
      ...Array.from({ length: 3 }, () => mk('fomo', false, false)),
    ];
    const result = computePlanAlignmentRate(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.sampleSize).toBe(10);
      expect(result.rate).toBe(0.7);
    }
  });
});

describe('computeStopLossPredefinedRate', () => {
  it('empty → insufficient_data no_checks', () => {
    const result = computeStopLossPredefinedRate([]);
    expect(result.kind).toBe('insufficient_data');
    if (result.kind === 'insufficient_data') {
      expect(result.reason).toBe('no_checks');
    }
  });

  it('7 → insufficient_data below_threshold', () => {
    const checks = Array.from({ length: 7 }, () => mk('edge', true, true));
    const result = computeStopLossPredefinedRate(checks);
    expect(result.kind).toBe('insufficient_data');
    if (result.kind === 'insufficient_data') {
      expect(result.reason).toBe('below_threshold');
    }
  });

  it('8 all stopLossPredefined=true → rate 1.0', () => {
    const checks = Array.from({ length: 8 }, () => mk('edge', true, true));
    const result = computeStopLossPredefinedRate(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.rate).toBe(1);
    }
  });

  it('8 all stopLossPredefined=false → rate 0.0', () => {
    const checks = Array.from({ length: 8 }, () => mk('edge', true, false));
    const result = computeStopLossPredefinedRate(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.rate).toBe(0);
    }
  });

  it('10 with 3 true → rate 0.3', () => {
    const checks: PreTradeAnalyticsInput[] = [
      mk('edge', true, true),
      mk('edge', true, true),
      mk('edge', true, true),
      mk('edge', true, false),
      mk('edge', true, false),
      mk('edge', true, false),
      mk('edge', true, false),
      mk('edge', true, false),
      mk('edge', true, false),
      mk('edge', true, false),
    ];
    const result = computeStopLossPredefinedRate(checks);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.sampleSize).toBe(10);
      expect(result.rate).toBe(0.3);
    }
  });
});

describe('discriminated union narrowing', () => {
  it('kind ok → distribution accessible, no reason field on the ok branch', () => {
    const checks = Array.from({ length: 8 }, () => mk('edge', true, true));
    const result = computeReasonDistribution(checks);
    if (result.kind === 'ok') {
      expect(result.distribution.edge).toBe(8);
      // TypeScript narrowing : `reason` doit exister UNIQUEMENT sur 'insufficient_data'
      // (le test runtime ne peut pas vérifier ça, mais le type-check du fichier le fera).
      expect('reason' in result).toBe(false);
    }
  });

  it('kind insufficient_data → reason accessible, no rate field on the insufficient branch', () => {
    const result = computePlanAlignmentRate([]);
    if (result.kind === 'insufficient_data') {
      expect(result.reason).toBe('no_checks');
      expect('rate' in result).toBe(false);
      expect('distribution' in result).toBe(false);
    }
  });
});
