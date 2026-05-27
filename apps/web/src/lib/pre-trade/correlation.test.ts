/**
 * V2.3 ext #4 — Session II backend (pre-trade × outcome correlation) pure module tests.
 *
 * **Différenciateur Fxmily** : révélateur empirique du pattern "edge vs
 * fomo/revenge/boredom" sur la performance réelle (win-rate + R réalisé moyen).
 *
 * Honesty doctrine carbone V2.1.3 habit-trade-correlation + Session HH analytics :
 *   - `MIN_SAMPLE_PER_REASON_CORRELATION = 8` floor PER REASON (pas global)
 *   - Discriminated union `{kind: 'ok'} | {kind: 'insufficient_data', reason}`
 *   - `avgRealizedR` exclut les trades `realizedRSource='estimated'` (carbone J6
 *     expectancy + V2.1.3 — magnitudes ≠ win-rate). `avgRSampleSize` distincte
 *     de `sampleSize` pour transparence.
 *   - `reason: 'no_linked_trades'` (n=0) distinct de `'below_threshold'`
 *     (1 ≤ n < 8) pour différencier les empty states UI.
 *
 * Posture Mark Douglas neutre : output fact-only "edge: 60% win rate, +0.8R
 * avg, n=12". AUCUNE comparaison ("edge > fomo") au niveau du module pur —
 * c'est au membre d'interpréter.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_SAMPLE_PER_REASON_CORRELATION,
  computeCorrelationByReason,
  type LinkedPreTradeOutcome,
} from './correlation';

function mk(
  reasonToTrade: LinkedPreTradeOutcome['reasonToTrade'],
  outcome: LinkedPreTradeOutcome['outcome'],
  realizedR: number | null = null,
): LinkedPreTradeOutcome {
  return { reasonToTrade, outcome, realizedR };
}

describe('MIN_SAMPLE_PER_REASON_CORRELATION', () => {
  it('is 8 (aligned V2.1.3 + Session HH analytics floor)', () => {
    expect(MIN_SAMPLE_PER_REASON_CORRELATION).toBe(8);
  });
});

describe('computeCorrelationByReason — empty + below threshold', () => {
  it('empty array → all 4 reasons insufficient_data with reason no_linked_trades', () => {
    const result = computeCorrelationByReason([]);
    for (const reason of ['edge', 'fomo', 'revenge', 'boredom'] as const) {
      const stats = result[reason];
      expect(stats.kind).toBe('insufficient_data');
      if (stats.kind === 'insufficient_data') {
        expect(stats.sampleSize).toBe(0);
        expect(stats.reason).toBe('no_linked_trades');
      }
    }
  });

  it('1 edge trade only → edge below_threshold, 3 others no_linked_trades', () => {
    const result = computeCorrelationByReason([mk('edge', 'win', 1.5)]);
    expect(result.edge.kind).toBe('insufficient_data');
    if (result.edge.kind === 'insufficient_data') {
      expect(result.edge.sampleSize).toBe(1);
      expect(result.edge.reason).toBe('below_threshold');
    }
    for (const reason of ['fomo', 'revenge', 'boredom'] as const) {
      const stats = result[reason];
      expect(stats.kind).toBe('insufficient_data');
      if (stats.kind === 'insufficient_data') {
        expect(stats.reason).toBe('no_linked_trades');
      }
    }
  });

  it('7 edge trades → edge below_threshold (just under floor)', () => {
    const outcomes = Array.from({ length: 7 }, () => mk('edge', 'win', 1));
    const result = computeCorrelationByReason(outcomes);
    expect(result.edge.kind).toBe('insufficient_data');
    if (result.edge.kind === 'insufficient_data') {
      expect(result.edge.sampleSize).toBe(7);
      expect(result.edge.reason).toBe('below_threshold');
    }
  });
});

describe('computeCorrelationByReason — happy path single reason', () => {
  it('8 edge all win with realizedR=1.5 → winRate 1.0, avgR 1.5, n=8', () => {
    const outcomes = Array.from({ length: 8 }, () => mk('edge', 'win', 1.5));
    const result = computeCorrelationByReason(outcomes);
    expect(result.edge.kind).toBe('ok');
    if (result.edge.kind === 'ok') {
      expect(result.edge.sampleSize).toBe(8);
      expect(result.edge.winRate).toBe(1);
      expect(result.edge.lossRate).toBe(0);
      expect(result.edge.breakEvenRate).toBe(0);
      expect(result.edge.avgRealizedR).toBe(1.5);
      expect(result.edge.avgRSampleSize).toBe(8);
    }
  });

  it('8 edge with 5W 3L → winRate 0.625, lossRate 0.375', () => {
    const outcomes: LinkedPreTradeOutcome[] = [
      ...Array.from({ length: 5 }, () => mk('edge', 'win', 2)),
      ...Array.from({ length: 3 }, () => mk('edge', 'loss', -1)),
    ];
    const result = computeCorrelationByReason(outcomes);
    expect(result.edge.kind).toBe('ok');
    if (result.edge.kind === 'ok') {
      expect(result.edge.winRate).toBe(0.625);
      expect(result.edge.lossRate).toBe(0.375);
      expect(result.edge.breakEvenRate).toBe(0);
    }
  });

  it('8 fomo all break_even → winRate 0, lossRate 0, breakEvenRate 1', () => {
    const outcomes = Array.from({ length: 8 }, () => mk('fomo', 'break_even', 0));
    const result = computeCorrelationByReason(outcomes);
    expect(result.fomo.kind).toBe('ok');
    if (result.fomo.kind === 'ok') {
      expect(result.fomo.winRate).toBe(0);
      expect(result.fomo.lossRate).toBe(0);
      expect(result.fomo.breakEvenRate).toBe(1);
      expect(result.fomo.avgRealizedR).toBe(0);
      expect(result.fomo.avgRSampleSize).toBe(8);
    }
  });
});

describe('computeCorrelationByReason — avgRealizedR honesty (estimated vs computed)', () => {
  it('8 trades all realizedR=null → avgRealizedR null, avgRSampleSize 0', () => {
    const outcomes = Array.from({ length: 8 }, () => mk('edge', 'win', null));
    const result = computeCorrelationByReason(outcomes);
    expect(result.edge.kind).toBe('ok');
    if (result.edge.kind === 'ok') {
      expect(result.edge.sampleSize).toBe(8);
      expect(result.edge.winRate).toBe(1);
      expect(result.edge.avgRealizedR).toBeNull();
      expect(result.edge.avgRSampleSize).toBe(0);
    }
  });

  it('8 trades mixed realizedR (5 numeric, 3 null) → avgR computed on 5, avgRSampleSize=5', () => {
    const outcomes: LinkedPreTradeOutcome[] = [
      mk('edge', 'win', 1.0),
      mk('edge', 'win', 2.0),
      mk('edge', 'win', 1.5),
      mk('edge', 'loss', -0.5),
      mk('edge', 'loss', -1.0),
      mk('edge', 'win', null), // estimated, excluded from avgR
      mk('edge', 'loss', null), // estimated, excluded
      mk('edge', 'win', null), // estimated, excluded
    ];
    const result = computeCorrelationByReason(outcomes);
    expect(result.edge.kind).toBe('ok');
    if (result.edge.kind === 'ok') {
      expect(result.edge.sampleSize).toBe(8);
      // mean of [1.0, 2.0, 1.5, -0.5, -1.0] = 0.6
      expect(result.edge.avgRealizedR).toBeCloseTo(0.6, 5);
      expect(result.edge.avgRSampleSize).toBe(5);
      // winRate uses ALL 8 (including the estimated ones)
      // 5 wins (3 computed + 2 estimated) / 8 = 0.625
      expect(result.edge.winRate).toBe(0.625);
    }
  });

  it('8 trades with negative avgR (losing pattern, posture neutre)', () => {
    const outcomes = Array.from({ length: 8 }, () => mk('fomo', 'loss', -1.2));
    const result = computeCorrelationByReason(outcomes);
    expect(result.fomo.kind).toBe('ok');
    if (result.fomo.kind === 'ok') {
      expect(result.fomo.winRate).toBe(0);
      expect(result.fomo.lossRate).toBe(1);
      expect(result.fomo.avgRealizedR).toBeCloseTo(-1.2, 5);
    }
  });
});

describe('computeCorrelationByReason — mixed reasons', () => {
  it('32 trades across 4 reasons (8 each) → all 4 ok with distinct stats', () => {
    const outcomes: LinkedPreTradeOutcome[] = [
      // edge : 6W 2L, avg +1.0R
      ...Array.from({ length: 6 }, () => mk('edge', 'win', 2)),
      ...Array.from({ length: 2 }, () => mk('edge', 'loss', -2)),
      // fomo : 2W 6L, avg -0.5R
      ...Array.from({ length: 2 }, () => mk('fomo', 'win', 1)),
      ...Array.from({ length: 6 }, () => mk('fomo', 'loss', -1)),
      // revenge : 1W 7L, avg -1.0R
      ...Array.from({ length: 1 }, () => mk('revenge', 'win', 1)),
      ...Array.from({ length: 7 }, () => mk('revenge', 'loss', -1.3)),
      // boredom : 4W 4L, avg 0R
      ...Array.from({ length: 4 }, () => mk('boredom', 'win', 1)),
      ...Array.from({ length: 4 }, () => mk('boredom', 'loss', -1)),
    ];
    const result = computeCorrelationByReason(outcomes);

    expect(result.edge.kind).toBe('ok');
    if (result.edge.kind === 'ok') {
      expect(result.edge.sampleSize).toBe(8);
      expect(result.edge.winRate).toBe(0.75);
      // (2*6 + (-2)*2) / 8 = (12 - 4) / 8 = 1.0
      expect(result.edge.avgRealizedR).toBeCloseTo(1, 5);
    }

    expect(result.fomo.kind).toBe('ok');
    if (result.fomo.kind === 'ok') {
      expect(result.fomo.winRate).toBe(0.25);
      // (1*2 + (-1)*6) / 8 = -0.5
      expect(result.fomo.avgRealizedR).toBeCloseTo(-0.5, 5);
    }

    expect(result.revenge.kind).toBe('ok');
    if (result.revenge.kind === 'ok') {
      expect(result.revenge.sampleSize).toBe(8);
      expect(result.revenge.winRate).toBe(0.125);
    }

    expect(result.boredom.kind).toBe('ok');
    if (result.boredom.kind === 'ok') {
      expect(result.boredom.winRate).toBe(0.5);
      expect(result.boredom.avgRealizedR).toBeCloseTo(0, 5);
    }
  });

  it('asymmetric : 10 edge + 4 fomo → edge ok, fomo below_threshold', () => {
    const outcomes: LinkedPreTradeOutcome[] = [
      ...Array.from({ length: 10 }, () => mk('edge', 'win', 1)),
      ...Array.from({ length: 4 }, () => mk('fomo', 'loss', -1)),
    ];
    const result = computeCorrelationByReason(outcomes);
    expect(result.edge.kind).toBe('ok');
    if (result.edge.kind === 'ok') {
      expect(result.edge.sampleSize).toBe(10);
    }
    expect(result.fomo.kind).toBe('insufficient_data');
    if (result.fomo.kind === 'insufficient_data') {
      expect(result.fomo.sampleSize).toBe(4);
      expect(result.fomo.reason).toBe('below_threshold');
    }
  });
});

describe('computeCorrelationByReason — invariants', () => {
  it('rates sum to 1 (win + loss + breakEven) within floating tolerance', () => {
    const outcomes: LinkedPreTradeOutcome[] = [
      mk('edge', 'win', 1),
      mk('edge', 'win', 1),
      mk('edge', 'win', 1),
      mk('edge', 'loss', -1),
      mk('edge', 'loss', -1),
      mk('edge', 'break_even', 0),
      mk('edge', 'break_even', 0),
      mk('edge', 'break_even', 0),
    ];
    const result = computeCorrelationByReason(outcomes);
    expect(result.edge.kind).toBe('ok');
    if (result.edge.kind === 'ok') {
      const total = result.edge.winRate + result.edge.lossRate + result.edge.breakEvenRate;
      expect(total).toBeCloseTo(1, 10);
      expect(result.edge.winRate).toBe(3 / 8);
      expect(result.edge.lossRate).toBe(2 / 8);
      expect(result.edge.breakEvenRate).toBe(3 / 8);
    }
  });

  it('avgRSampleSize ≤ sampleSize always (computed subset of all)', () => {
    const outcomes: LinkedPreTradeOutcome[] = [
      ...Array.from({ length: 5 }, () => mk('edge', 'win', 1)),
      ...Array.from({ length: 3 }, () => mk('edge', 'win', null)),
    ];
    const result = computeCorrelationByReason(outcomes);
    if (result.edge.kind === 'ok') {
      expect(result.edge.avgRSampleSize).toBeLessThanOrEqual(result.edge.sampleSize);
      expect(result.edge.avgRSampleSize).toBe(5);
      expect(result.edge.sampleSize).toBe(8);
    }
  });
});

describe('computeCorrelationByReason — discriminated union narrowing', () => {
  it('ok branch exposes winRate + lossRate + breakEvenRate + avgRealizedR + avgRSampleSize', () => {
    const outcomes = Array.from({ length: 8 }, () => mk('edge', 'win', 1));
    const result = computeCorrelationByReason(outcomes);
    if (result.edge.kind === 'ok') {
      // All these accesses MUST type-check (compile-time guarantee).
      expect(typeof result.edge.winRate).toBe('number');
      expect(typeof result.edge.lossRate).toBe('number');
      expect(typeof result.edge.breakEvenRate).toBe('number');
      expect(typeof result.edge.avgRSampleSize).toBe('number');
      expect('reason' in result.edge).toBe(false);
    }
  });

  it('insufficient_data branch exposes reason, no winRate', () => {
    const result = computeCorrelationByReason([]);
    if (result.edge.kind === 'insufficient_data') {
      expect(result.edge.reason).toBe('no_linked_trades');
      expect('winRate' in result.edge).toBe(false);
      expect('avgRealizedR' in result.edge).toBe(false);
    }
  });
});
