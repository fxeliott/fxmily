/**
 * S10 §30.8 — Meeting attendance gap tests (recoupement admin↔membre, pure).
 *
 * Exhaustive truth table over (adminPresent ∈ {null,false,true}) ×
 * (memberComplete ∈ {false,true}) × (memberDeclaredSomething ∈ {false,true}),
 * with the impossible row (memberComplete=true ⇒ memberDeclaredSomething=true)
 * excluded — a complete attendance has, by definition, declared something.
 *
 * The single scoring voie (`attendanceCountsAsComplete`) is also pinned: an
 * over-claim (admin absent vs member complete) does NOT count, everything else
 * trusts the member. Auto-healing is implicit: the verdict is a pure function of
 * the current two facts, so a corrected admin mark instantly clears the gap.
 */

import { describe, expect, it } from 'vitest';

import {
  attendanceCountsAsComplete,
  computeAttendanceGap,
  isScoringGap,
  type AttendanceGap,
} from './attendance-gap';

describe('computeAttendanceGap', () => {
  it('adminPresent=null → always none (admin said nothing, byte-identical pre-S10)', () => {
    expect(computeAttendanceGap(null, false, false)).toBe('none');
    expect(computeAttendanceGap(null, false, true)).toBe('none');
    expect(computeAttendanceGap(null, true, true)).toBe('none');
  });

  it('adminPresent=false + member complete → admin_absent_member_present (over-claim)', () => {
    expect(computeAttendanceGap(false, true, true)).toBe('admin_absent_member_present');
  });

  it('adminPresent=false + member not complete → none (confirmed absence, no écart)', () => {
    expect(computeAttendanceGap(false, false, false)).toBe('none');
    // member declared a partial then admin says absent: not an over-claim of a
    // COMPLETE attendance → no scoring écart (the partial earns no credit anyway).
    expect(computeAttendanceGap(false, false, true)).toBe('none');
  });

  it('adminPresent=true + member complete → none (full agreement)', () => {
    expect(computeAttendanceGap(true, true, true)).toBe('none');
  });

  it('adminPresent=true + member declared partial → admin_present_member_partial (benign nudge)', () => {
    expect(computeAttendanceGap(true, false, true)).toBe('admin_present_member_partial');
  });

  it('adminPresent=true + member declared nothing → admin_present_member_absent (benign nudge)', () => {
    expect(computeAttendanceGap(true, false, false)).toBe('admin_present_member_absent');
  });

  it('undefined adminPresent is treated like null (defensive totality)', () => {
    expect(computeAttendanceGap(undefined as unknown as null, true, true)).toBe('none');
  });
});

describe('attendanceCountsAsComplete (single scoring voie)', () => {
  it('not complete → never counts, whatever the admin says', () => {
    expect(attendanceCountsAsComplete(false, null)).toBe(false);
    expect(attendanceCountsAsComplete(false, true)).toBe(false);
    expect(attendanceCountsAsComplete(false, false)).toBe(false);
  });

  it('complete + admin null/true → counts (admin said nothing, or confirms)', () => {
    expect(attendanceCountsAsComplete(true, null)).toBe(true);
    expect(attendanceCountsAsComplete(true, true)).toBe(true);
  });

  it('complete + admin false → does NOT count (over-claim, honest accounting)', () => {
    expect(attendanceCountsAsComplete(true, false)).toBe(false);
  });
});

describe('isScoringGap', () => {
  it('only the over-claim is a scoring gap', () => {
    const all: AttendanceGap[] = [
      'none',
      'admin_absent_member_present',
      'admin_present_member_absent',
      'admin_present_member_partial',
    ];
    expect(all.filter(isScoringGap)).toEqual(['admin_absent_member_present']);
  });

  it('a scoring gap implies the completion is dropped from the numerator', () => {
    // The two pure fns agree: when the gap is the over-claim, the completion is
    // not counted; when there is no gap on a complete report, it is counted.
    expect(isScoringGap(computeAttendanceGap(false, true, true))).toBe(true);
    expect(attendanceCountsAsComplete(true, false)).toBe(false);
    expect(isScoringGap(computeAttendanceGap(true, true, true))).toBe(false);
    expect(attendanceCountsAsComplete(true, true)).toBe(true);
  });
});
