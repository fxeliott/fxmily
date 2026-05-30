/**
 * V1.7 §30 — Meeting window boundary tests (J-M1, pure module).
 *
 * The single 30-day window (SPEC §30.7) bounds declaration + rate + engagement.
 * `meetingWindowStart` must natively handle a member who joined mid-period
 * (T3-1) by snapping to Paris-local midnight of their join day, never counting
 * meetings held before they existed.
 */

import { describe, expect, it } from 'vitest';

import { MEETING_WINDOW_DAYS, meetingWindowStart } from './window';

describe('MEETING_WINDOW_DAYS', () => {
  it('is 30 (single window for declaration + rate + engagement, §30.7)', () => {
    expect(MEETING_WINDOW_DAYS).toBe(30);
  });
});

describe('meetingWindowStart', () => {
  const NOW = new Date('2026-05-30T10:00:00.000Z'); // CEST

  it('uses now − 30j when the member joined long ago', () => {
    const joinedAt = new Date('2026-01-01T10:00:00.000Z');
    expect(meetingWindowStart(NOW, joinedAt).toISOString()).toBe('2026-04-30T10:00:00.000Z');
  });

  it('uses Paris-local start-of-day(joinedAt) when joined within 30j', () => {
    // joined 2026-05-29 14:00Z → Paris day 2026-05-29 (CEST) → midnight = 2026-05-28T22:00Z.
    const joinedAt = new Date('2026-05-29T14:00:00.000Z');
    expect(meetingWindowStart(NOW, joinedAt).toISOString()).toBe('2026-05-28T22:00:00.000Z');
  });

  it('snaps joinedAt to Paris midnight — a member who joined at 14h gets the full day', () => {
    // joined 2026-05-20 14:00Z (10 days ago) → Paris day 2026-05-20 → midnight 2026-05-19T22:00Z.
    const joinedAt = new Date('2026-05-20T14:00:00.000Z');
    expect(meetingWindowStart(NOW, joinedAt).toISOString()).toBe('2026-05-19T22:00:00.000Z');
  });

  it('uses the 30j floor when join-day-midnight is older than it (boundary)', () => {
    // joined exactly 31 days before NOW → join-floor is older than now−30j → floor wins.
    const joinedAt = new Date('2026-04-29T08:00:00.000Z'); // 31 days ago
    expect(meetingWindowStart(NOW, joinedAt).toISOString()).toBe('2026-04-30T10:00:00.000Z');
  });
});
