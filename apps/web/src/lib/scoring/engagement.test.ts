import { describe, expect, it } from 'vitest';

import { computeEngagementScore, type EngagementCheckinInput } from './engagement';

const M = (date: string): EngagementCheckinInput => ({
  date,
  slot: 'morning',
  journalNote: null,
});
const E = (date: string, journal: string | null = null): EngagementCheckinInput => ({
  date,
  slot: 'evening',
  journalNote: journal,
});

const day = (i: number) => `2026-01-${String(i + 1).padStart(2, '0')}`;

describe('computeEngagementScore', () => {
  it('returns no_checkins when no check-ins exist', () => {
    const r = computeEngagementScore({ checkins: [], streak: 0 });
    expect(r.score).toBeNull();
    expect(r.reason).toBe('no_checkins');
  });

  it('returns window_short when fewer than 7 days with any check-in', () => {
    const checkins = Array.from({ length: 5 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 5 });
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toBe('window_short');
    expect(r.sample.days).toBe(5);
  });

  it('returns ok with full score for a perfect 30-day dual-slot run', () => {
    const checkins: EngagementCheckinInput[] = [];
    for (let i = 0; i < 30; i++) {
      checkins.push(M(day(i)));
      checkins.push(E(day(i), 'journal'));
    }
    const r = computeEngagementScore({ checkins, streak: 30 });
    expect(r.score).toBe(100);
    expect(r.status).toBe('ok');
  });

  it('caps streak normalization at 30 days (no toxic gamification)', () => {
    const checkins: EngagementCheckinInput[] = [];
    for (let i = 0; i < 30; i++) {
      checkins.push(M(day(i)));
      checkins.push(E(day(i), 'journal'));
    }
    const r1 = computeEngagementScore({ checkins, streak: 30 });
    const r2 = computeEngagementScore({ checkins, streak: 100 });
    // Streak ≥ 30 caps the streak sub-score; both should yield the same result.
    expect(r1.parts.streakNormalized.rate).toBe(1);
    expect(r2.parts.streakNormalized.rate).toBe(1);
    expect(r1.score).toBe(r2.score);
  });

  it('rewards check-in fill rate proportionally', () => {
    // 15 / 30 days with morning only → fill 0.5
    const checkins = Array.from({ length: 15 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 0 });
    expect(r.parts.checkinFillRate.rate).toBe(0.5);
  });

  it('rewards dual-slot rate over morning-only', () => {
    const morningOnly: EngagementCheckinInput[] = [];
    const dualSlot: EngagementCheckinInput[] = [];
    for (let i = 0; i < 14; i++) {
      morningOnly.push(M(day(i)));
      dualSlot.push(M(day(i)));
      dualSlot.push(E(day(i)));
    }
    const r1 = computeEngagementScore({ checkins: morningOnly, streak: 14 });
    const r2 = computeEngagementScore({ checkins: dualSlot, streak: 14 });
    expect(r1.parts.dualSlotRate.rate).toBe(0);
    expect(r2.parts.dualSlotRate.rate).toBe(1);
    expect(r2.score).toBeGreaterThan(r1.score!);
  });

  it('skips journalDepth when no evenings exist (renormalize)', () => {
    const checkins = Array.from({ length: 14 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 14 });
    // Active sub-scores: fill (0.467 → 23.33), dualSlot (0/14=0), streak (14/30 → 9.33)
    // skipped: journalDepth, dualSlotRate kept (denom>0 → 0)
    expect(r.parts.journalDepthRate.numerator).toBe(0);
    expect(r.parts.journalDepthRate.denominator).toBe(0);
  });

  it('treats whitespace-only journal as not filled', () => {
    const checkins = Array.from({ length: 14 }, (_, i) => E(day(i), '  '));
    const r = computeEngagementScore({ checkins, streak: 14 });
    expect(r.parts.journalDepthRate.numerator).toBe(0);
    expect(r.parts.journalDepthRate.denominator).toBe(14);
    expect(r.parts.journalDepthRate.rate).toBe(0);
  });

  it('counts a single date with both slots as one day-with-any', () => {
    const checkins = [M(day(0)), E(day(0))];
    const r = computeEngagementScore({ checkins, streak: 1 });
    expect(r.sample.days).toBe(1);
    expect(r.status).toBe('insufficient_data'); // <7 days
  });

  it('respects custom windowDays parameter', () => {
    // 7 days filled out of 7-day window → fill rate = 1
    const checkins = Array.from({ length: 7 }, (_, i) => M(day(i)));
    const r = computeEngagementScore({ checkins, streak: 7, windowDays: 7 });
    expect(r.parts.checkinFillRate.rate).toBe(1);
  });
});
