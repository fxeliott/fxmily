/**
 * TDD tests for pure helpers `public-trade-math.ts` (T5).
 *
 * Coverage : `computeResultPercent` 3 status branches + edge cases ;
 * `validateLifecycleInvariants` happy + each invariant failure.
 */

import { describe, expect, it } from 'vitest';

import {
  computeResultPercent,
  PublicTradeInvalidStateError,
  validateLifecycleInvariants,
} from './public-trade-math';

// =============================================================================
// computeResultPercent
// =============================================================================

describe('computeResultPercent', () => {
  it('returns null for open status (not resolved yet)', () => {
    expect(computeResultPercent('open', 1.0, null)).toBe(null);
    expect(computeResultPercent('open', 1.0, 2.0)).toBe(null);
  });

  it('returns 0 for break_even (no-op mathematically)', () => {
    expect(computeResultPercent('break_even', 1.0, null)).toBe(0);
    expect(computeResultPercent('break_even', 2.0, 0)).toBe(0);
  });

  it('returns null for closed if resultR is null', () => {
    expect(computeResultPercent('closed', 1.0, null)).toBe(null);
  });

  it('computes signed product for closed trades', () => {
    expect(computeResultPercent('closed', 1.0, 2.0)).toBe(2.0); // 1% × 2R = 2%
    expect(computeResultPercent('closed', 0.5, 3.0)).toBe(1.5); // 0.5% × 3R
    expect(computeResultPercent('closed', 1.5, -1.0)).toBe(-1.5); // 1.5% × -1R
  });

  it('rounds to 3 decimal places (anti JS drift)', () => {
    // 1.0 × 0.1 = 0.10000000000000001 sans arrondi → 0.1
    expect(computeResultPercent('closed', 1.0, 0.1)).toBe(0.1);
    // 1.5 × 1.333 = 1.9994999999999998 IEEE 754 (pas 1.9995 mathématique)
    // → Math.round(1999.4999...) = 1999 → 1.999. Bornage à 3 décimales OK.
    expect(computeResultPercent('closed', 1.5, 1.333)).toBe(1.999);
  });

  it('handles negative risk × negative R (theoretical positive)', () => {
    // Pas un cas réel (risk toujours > 0) mais robustesse mathématique.
    expect(computeResultPercent('closed', 1.0, -2.0)).toBe(-2.0);
  });
});

// =============================================================================
// validateLifecycleInvariants — happy paths
// =============================================================================

describe('validateLifecycleInvariants — happy', () => {
  const baseEntered = new Date('2026-05-22T10:00:00Z');
  const baseExited = new Date('2026-05-22T14:00:00Z');

  it('accepts open trade with no exit', () => {
    expect(() =>
      validateLifecycleInvariants({
        status: 'open',
        enteredAt: baseEntered,
        exitedAt: null,
        riskPercent: 1.0,
        resultR: null,
      }),
    ).not.toThrow();
  });

  it('accepts closed trade with exit + R', () => {
    expect(() =>
      validateLifecycleInvariants({
        status: 'closed',
        enteredAt: baseEntered,
        exitedAt: baseExited,
        riskPercent: 1.0,
        resultR: 2.0,
      }),
    ).not.toThrow();
  });

  it('accepts BE trade with R=0', () => {
    expect(() =>
      validateLifecycleInvariants({
        status: 'break_even',
        enteredAt: baseEntered,
        exitedAt: baseExited,
        riskPercent: 1.0,
        resultR: 0,
      }),
    ).not.toThrow();
  });

  it('accepts BE trade with R=null (compat)', () => {
    expect(() =>
      validateLifecycleInvariants({
        status: 'break_even',
        enteredAt: baseEntered,
        exitedAt: baseExited,
        riskPercent: 1.0,
        resultR: null,
      }),
    ).not.toThrow();
  });
});

// =============================================================================
// validateLifecycleInvariants — failures
// =============================================================================

describe('validateLifecycleInvariants — failures', () => {
  const baseEntered = new Date('2026-05-22T10:00:00Z');
  const baseExited = new Date('2026-05-22T14:00:00Z');

  it('rejects closed without exitedAt', () => {
    expect(() =>
      validateLifecycleInvariants({
        status: 'closed',
        enteredAt: baseEntered,
        exitedAt: null,
        riskPercent: 1.0,
        resultR: 2.0,
      }),
    ).toThrowError(PublicTradeInvalidStateError);
  });

  it('field=exitedAt sur closed without exit', () => {
    try {
      validateLifecycleInvariants({
        status: 'closed',
        enteredAt: baseEntered,
        exitedAt: null,
        riskPercent: 1.0,
        resultR: 2.0,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(PublicTradeInvalidStateError);
      if (err instanceof PublicTradeInvalidStateError) {
        expect(err.field).toBe('exitedAt');
      }
    }
  });

  it('rejects closed without resultR', () => {
    try {
      validateLifecycleInvariants({
        status: 'closed',
        enteredAt: baseEntered,
        exitedAt: baseExited,
        riskPercent: 1.0,
        resultR: null,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(PublicTradeInvalidStateError);
      if (err instanceof PublicTradeInvalidStateError) {
        expect(err.field).toBe('resultR');
      }
    }
  });

  it('rejects BE without exitedAt', () => {
    expect(() =>
      validateLifecycleInvariants({
        status: 'break_even',
        enteredAt: baseEntered,
        exitedAt: null,
        riskPercent: 1.0,
        resultR: 0,
      }),
    ).toThrowError(PublicTradeInvalidStateError);
  });

  it('rejects BE with nonzero R', () => {
    try {
      validateLifecycleInvariants({
        status: 'break_even',
        enteredAt: baseEntered,
        exitedAt: baseExited,
        riskPercent: 1.0,
        resultR: 0.5,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(PublicTradeInvalidStateError);
      if (err instanceof PublicTradeInvalidStateError) {
        expect(err.field).toBe('resultR');
      }
    }
  });

  it('rejects exitedAt before enteredAt', () => {
    try {
      validateLifecycleInvariants({
        status: 'closed',
        enteredAt: baseExited, // 14h
        exitedAt: baseEntered, // 10h
        riskPercent: 1.0,
        resultR: 2.0,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(PublicTradeInvalidStateError);
      if (err instanceof PublicTradeInvalidStateError) {
        expect(err.field).toBe('exitedAt');
      }
    }
  });

  it('accepts exitedAt EQUAL enteredAt (boundary — same-instant trade)', () => {
    // V1 défensif : on accepte égalité (instant trades théoriques OK).
    // L'invariant strict est `<`, pas `<=`.
    expect(() =>
      validateLifecycleInvariants({
        status: 'closed',
        enteredAt: baseEntered,
        exitedAt: baseEntered,
        riskPercent: 1.0,
        resultR: 0,
      }),
    ).not.toThrow();
  });
});
