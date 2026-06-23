import { describe, expect, it } from 'vitest';

import { coerceAxes, pickWeeklyAxis } from './coaching-axis';

/**
 * S24 — pure coaching-axis derivation. The axes are member-authored free text
 * persisted as Prisma JSON (`unknown`), so coercion must be defensive; the weekly
 * pick must be deterministic (no `Math.random`) and rotate through every axis.
 */

describe('coerceAxes', () => {
  it('keeps clean string axes, trimmed', () => {
    expect(coerceAxes(['  Tenir mon plan  ', 'Réduire le FOMO'])).toEqual([
      'Tenir mon plan',
      'Réduire le FOMO',
    ]);
  });

  it('returns [] for non-array input (null / object / string)', () => {
    expect(coerceAxes(null)).toEqual([]);
    expect(coerceAxes(undefined)).toEqual([]);
    expect(coerceAxes('Tenir mon plan')).toEqual([]);
    expect(coerceAxes({ 0: 'x' })).toEqual([]);
  });

  it('drops non-string entries without inventing anything', () => {
    expect(coerceAxes(['Plan', 42, null, { a: 1 }, 'FOMO'])).toEqual(['Plan', 'FOMO']);
  });

  it('drops a zero-width/whitespace-only axis (would render blank)', () => {
    // U+200B zero-width space only → safeFreeText strips to "" → dropped.
    expect(coerceAxes(['​​', '   ', 'Réel'])).toEqual(['Réel']);
  });

  it('caps the list at 5 axes', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(coerceAxes(six)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('caps each axis at 200 chars', () => {
    const long = 'x'.repeat(250);
    const [only] = coerceAxes([long]);
    expect(only).toHaveLength(200);
  });
});

describe('pickWeeklyAxis', () => {
  it('returns null for an empty list', () => {
    expect(pickWeeklyAxis([])).toBeNull();
  });

  it('is deterministic for a given instant', () => {
    const axes = ['A', 'B', 'C'];
    const now = new Date('2026-06-24T10:00:00Z');
    expect(pickWeeklyAxis(axes, now)).toBe(pickWeeklyAxis(axes, now));
  });

  it('rotates to the next axis the following week', () => {
    const axes = ['A', 'B', 'C'];
    const w0 = new Date('2026-06-24T10:00:00Z');
    const w1 = new Date(w0.getTime() + 7 * 86_400_000);
    const w2 = new Date(w0.getTime() + 14 * 86_400_000);
    const p0 = pickWeeklyAxis(axes, w0);
    const p1 = pickWeeklyAxis(axes, w1);
    const p2 = pickWeeklyAxis(axes, w2);
    // Consecutive weeks advance by one index (mod length) — never stuck.
    const idx = (v: string | null) => axes.indexOf(v as string);
    expect(idx(p1)).toBe((idx(p0) + 1) % axes.length);
    expect(idx(p2)).toBe((idx(p0) + 2) % axes.length);
  });

  it('wraps around after the last axis (every axis is reachable)', () => {
    const axes = ['A', 'B'];
    const seen = new Set<string>();
    const base = new Date('2026-06-24T10:00:00Z').getTime();
    for (let w = 0; w < 4; w++) {
      const pick = pickWeeklyAxis(axes, new Date(base + w * 7 * 86_400_000));
      if (pick) seen.add(pick);
    }
    expect(seen).toEqual(new Set(['A', 'B']));
  });

  it('handles a single axis (always that one)', () => {
    expect(pickWeeklyAxis(['solo'], new Date('2026-06-24T10:00:00Z'))).toBe('solo');
  });
});
