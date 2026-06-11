import { describe, expect, it } from 'vitest';

import {
  MATCH_TIME_TOLERANCE_MS,
  reconcileMember,
  type ReconcilePositionInput,
  type ReconcileTradeInput,
} from './reconcile';

/**
 * S3 §33.5 — pure reconciliation core (DoD §31 #2 « un trade déclaré faux ou
 * absent est détecté comme écart »). No DB — deterministic verdicts only.
 */

const T0 = new Date('2026-06-02T09:15:00.000Z');

function trade(overrides: Partial<ReconcileTradeInput> = {}): ReconcileTradeInput {
  return {
    id: 'trade1',
    pair: 'EURUSD',
    direction: 'long',
    enteredAt: T0,
    lotSize: 0.5,
    matchStatus: null,
    ...overrides,
  };
}

function position(overrides: Partial<ReconcilePositionInput> = {}): ReconcilePositionInput {
  return {
    id: 'pos1',
    symbol: 'EURUSD',
    side: 'long',
    openTime: new Date(T0.getTime() + 5 * 60 * 1000), // déclaré ±5 min
    volume: 0.5,
    ...overrides,
  };
}

describe('reconcileMember — matching', () => {
  it('matches a declared trade to its real position (time+symbol+side+volume)', () => {
    const verdicts = reconcileMember([trade()], [position()]);
    expect(verdicts).toEqual([{ kind: 'matched', tradeId: 'trade1', positionId: 'pos1' }]);
  });

  it('🚨 never matches on price — a divergent OCR digit must not break the match', () => {
    // The position carries NO price fields at all in the matching key: a
    // probe-B-style misread (1.09065 vs 1.09085) is irrelevant by design.
    const verdicts = reconcileMember(
      [trade()],
      [position({ openTime: new Date(T0.getTime() + 30 * 60 * 1000) })],
    );
    expect(verdicts[0]?.kind).toBe('matched');
  });

  it('pairs greedily by time distance (each side used once)', () => {
    const verdicts = reconcileMember(
      [
        trade({ id: 't-near', enteredAt: T0 }),
        trade({ id: 't-far', enteredAt: new Date(T0.getTime() + 40 * 60 * 1000) }),
      ],
      [
        position({ id: 'p-near', openTime: new Date(T0.getTime() + 60 * 1000) }),
        position({ id: 'p-far', openTime: new Date(T0.getTime() + 41 * 60 * 1000) }),
      ],
    );
    const matched = verdicts.filter((v) => v.kind === 'matched');
    expect(matched).toContainEqual({ kind: 'matched', tradeId: 't-near', positionId: 'p-near' });
    expect(matched).toContainEqual({ kind: 'matched', tradeId: 't-far', positionId: 'p-far' });
  });

  it('beyond the time tolerance → no match', () => {
    const verdicts = reconcileMember(
      [trade()],
      [position({ openTime: new Date(T0.getTime() + MATCH_TIME_TOLERANCE_MS + 60_000) })],
    );
    expect(verdicts.some((v) => v.kind === 'matched')).toBe(false);
  });

  it('side mismatch is never a match (long ≠ short)', () => {
    const verdicts = reconcileMember([trade({ direction: 'long' })], [position({ side: 'short' })]);
    expect(verdicts.some((v) => v.kind === 'matched' || v.kind === 'mismatch')).toBe(false);
  });

  it('volume divergence beyond ±15% with everything else aligned → mismatch', () => {
    const verdicts = reconcileMember([trade({ lotSize: 0.5 })], [position({ volume: 1.0 })]);
    expect(verdicts).toContainEqual({ kind: 'mismatch', tradeId: 'trade1', positionId: 'pos1' });
  });
});

describe('reconcileMember — écarts (DoD §31 #2)', () => {
  it('🚨 a real position never declared → missing_declared (l’oubli)', () => {
    const verdicts = reconcileMember([], [position()]);
    expect(verdicts).toEqual([{ kind: 'missing_declared', positionId: 'pos1' }]);
  });

  it('🚨 a declared trade with no counterpart INSIDE the covered window → false_declared', () => {
    const verdicts = reconcileMember(
      [
        trade({ id: 'real', enteredAt: T0 }),
        trade({
          id: 'invented',
          pair: 'USDJPY',
          enteredAt: new Date(T0.getTime() + 60 * 60 * 1000),
        }),
      ],
      [position()],
    );
    expect(verdicts).toContainEqual({ kind: 'false_declared', tradeId: 'invented' });
  });

  it('🚨 anti-survente §33.6 — outside any proof window → uncovered, NOT false_declared', () => {
    const farAway = new Date(T0.getTime() + 30 * 24 * 60 * 60 * 1000);
    const verdicts = reconcileMember(
      [trade({ id: 'later-trade', enteredAt: farAway })],
      [position()],
    );
    expect(verdicts).toContainEqual({ kind: 'uncovered', tradeId: 'later-trade' });
    expect(verdicts.some((v) => v.kind === 'false_declared')).toBe(false);
  });

  it('no positions at all → every declared trade is uncovered (nothing to confront)', () => {
    const verdicts = reconcileMember([trade()], []);
    expect(verdicts).toEqual([{ kind: 'uncovered', tradeId: 'trade1' }]);
  });
});
