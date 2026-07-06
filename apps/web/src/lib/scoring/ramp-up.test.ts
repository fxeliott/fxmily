/**
 * Tour 15 — `isMemberInRampUp` onboarding-window predicate.
 *
 * Pure duration arithmetic (30 days from `joinedAt`). Boundary matters: exactly
 * 30 days elapsed is NO LONGER ramp-up; a future `joinedAt` (clock skew) stays
 * ramp-up (a brand-new member is the whole point).
 */

import { describe, expect, it } from 'vitest';

import { isMemberInRampUp, RAMP_UP_DAYS } from './ramp-up';

const NOW = new Date('2026-06-30T12:00:00.000Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('isMemberInRampUp', () => {
  it('is true for a member who joined today', () => {
    expect(isMemberInRampUp(NOW, NOW)).toBe(true);
  });

  it('is true just inside the window (29 days ago)', () => {
    expect(isMemberInRampUp(daysBefore(29), NOW)).toBe(true);
  });

  it('is false exactly RAMP_UP_DAYS ago (boundary is exclusive)', () => {
    expect(isMemberInRampUp(daysBefore(RAMP_UP_DAYS), NOW)).toBe(false);
  });

  it('is false for a long-standing member (90 days ago)', () => {
    expect(isMemberInRampUp(daysBefore(90), NOW)).toBe(false);
  });

  it('treats a future joinedAt (clock skew) as ramp-up', () => {
    expect(isMemberInRampUp(new Date(NOW.getTime() + 60_000), NOW)).toBe(true);
  });

  it('exposes a 30-day window', () => {
    expect(RAMP_UP_DAYS).toBe(30);
  });
});
