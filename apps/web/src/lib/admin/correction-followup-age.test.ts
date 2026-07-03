import { describe, expect, it } from 'vitest';

import { CORRECTION_STALE_DAYS, ageDays, isCorrectionStale } from './correction-followup-age';

/**
 * Tour 11 (chantier G) — pure age helpers for the admin corrections panel.
 * Deterministic date math only, so we assert the day boundaries exactly.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-03T12:00:00.000Z');

/** `NOW` minus `days` (fractional allowed for boundary tests). */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe('ageDays', () => {
  it('is 0 for a same-day (fresh) row', () => {
    expect(ageDays(NOW, NOW)).toBe(0);
    expect(ageDays(daysAgo(0.5), NOW)).toBe(0);
  });

  it('floors to whole elapsed days', () => {
    expect(ageDays(daysAgo(1), NOW)).toBe(1);
    expect(ageDays(daysAgo(1.9), NOW)).toBe(1);
    expect(ageDays(daysAgo(14), NOW)).toBe(14);
    expect(ageDays(daysAgo(21), NOW)).toBe(21);
  });

  it('clamps a future createdAt (clock skew) to 0 rather than a negative age', () => {
    expect(ageDays(new Date(NOW.getTime() + 5 * DAY_MS), NOW)).toBe(0);
  });

  it('returns 0 on a non-finite delta (invalid date)', () => {
    expect(ageDays(new Date(Number.NaN), NOW)).toBe(0);
  });
});

describe('isCorrectionStale', () => {
  it('re-exports the shared 14-day threshold', () => {
    expect(CORRECTION_STALE_DAYS).toBe(14);
  });

  it('is false at or below the threshold (strict >)', () => {
    expect(isCorrectionStale(daysAgo(0), NOW)).toBe(false);
    expect(isCorrectionStale(daysAgo(10), NOW)).toBe(false);
    expect(isCorrectionStale(daysAgo(14), NOW)).toBe(false);
    // 14.5 days still floors to 14 → not yet stale (label must always show > 14).
    expect(isCorrectionStale(daysAgo(14.5), NOW)).toBe(false);
  });

  it('is true once the whole-day age exceeds the threshold', () => {
    expect(isCorrectionStale(daysAgo(15), NOW)).toBe(true);
    expect(isCorrectionStale(daysAgo(21), NOW)).toBe(true);
  });

  it('is false for a future date (clock skew)', () => {
    expect(isCorrectionStale(new Date(NOW.getTime() + DAY_MS), NOW)).toBe(false);
  });
});
