/**
 * V1.7 §30 — Meeting attendance rate tests (J-M1, pure module).
 *
 * Honesty doctrine (carbone pre-trade/analytics): the `insufficient_data`
 * branch (scheduledCount=0) STRUCTURALLY has no `rate` — never a fake "0 %"
 * when no meeting was held (SPEC §30.4). A 0/5 rate IS a real signal (member
 * had meetings but validated none) and must surface as `ok` rate 0, distinct
 * from "no data". This distinction is what keeps the J-M4 engagement skip
 * correct (keyed on scheduledCount, not completedCount).
 */

import { describe, expect, it } from 'vitest';

import { computeMeetingAttendanceRate } from './attendance-rate';

describe('computeMeetingAttendanceRate', () => {
  it('scheduledCount=0 → insufficient_data (no_meetings), structurally no rate', () => {
    const r = computeMeetingAttendanceRate(0, 0);
    expect(r.kind).toBe('insufficient_data');
    if (r.kind === 'insufficient_data') {
      expect(r.reason).toBe('no_meetings');
      expect(r.scheduledCount).toBe(0);
    }
    expect('rate' in r).toBe(false);
  });

  it('scheduled>0 but completed=0 → ok rate 0 (a real signal, NOT insufficient)', () => {
    expect(computeMeetingAttendanceRate(5, 0)).toEqual({
      kind: 'ok',
      scheduledCount: 5,
      completedCount: 0,
      rate: 0,
    });
  });

  it('full attendance → rate 1', () => {
    expect(computeMeetingAttendanceRate(5, 5)).toEqual({
      kind: 'ok',
      scheduledCount: 5,
      completedCount: 5,
      rate: 1,
    });
  });

  it('partial attendance → exact fraction', () => {
    expect(computeMeetingAttendanceRate(4, 1)).toEqual({
      kind: 'ok',
      scheduledCount: 4,
      completedCount: 1,
      rate: 0.25,
    });
  });

  it('clamps completed > scheduled to rate 1 (defensive — caller bug surfaces as 100 %, never >1)', () => {
    const r = computeMeetingAttendanceRate(2, 3);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.rate).toBe(1);
      expect(r.completedCount).toBe(3);
    }
  });

  it('negative completedCount is floored to 0', () => {
    const r = computeMeetingAttendanceRate(4, -2);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.rate).toBe(0);
      expect(r.completedCount).toBe(0);
    }
  });

  it('negative / non-finite scheduledCount → insufficient_data (defensive)', () => {
    expect(computeMeetingAttendanceRate(-1, 0).kind).toBe('insufficient_data');
    expect(computeMeetingAttendanceRate(Number.NaN, 0).kind).toBe('insufficient_data');
  });
});
