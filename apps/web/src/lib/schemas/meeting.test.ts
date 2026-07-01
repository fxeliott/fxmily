/**
 * V1.7 §30 — Meeting attendance declaration schema tests (J-M1).
 *
 * Server is the only authority (carbone pre-trade-check). `.strict()` rejects
 * unknown keys; `meetingId` is UNTRUSTED member input and is length-capped.
 */

import { describe, expect, it } from 'vitest';

import {
  MEETING_ATTENDANCE_MODES,
  meetingAbsenceDeclarationSchema,
  meetingAttendanceDeclarationSchema,
} from './meeting';

describe('MEETING_ATTENDANCE_MODES', () => {
  it('is exactly [live, replay] (anti-regression)', () => {
    expect(MEETING_ATTENDANCE_MODES).toEqual(['live', 'replay']);
  });
});

describe('meetingAttendanceDeclarationSchema', () => {
  const valid = {
    meetingId: 'clmeeting000000000000abcd',
    attendanceMode: 'live',
    contentReviewed: true,
  } as const;

  it('accepts a valid live + content-reviewed declaration', () => {
    expect(meetingAttendanceDeclarationSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts replay + contentReviewed=false (a partial declaration is valid input)', () => {
    const r = meetingAttendanceDeclarationSchema.safeParse({
      ...valid,
      attendanceMode: 'replay',
      contentReviewed: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown attendanceMode', () => {
    expect(
      meetingAttendanceDeclarationSchema.safeParse({ ...valid, attendanceMode: 'in-person' })
        .success,
    ).toBe(false);
  });

  it('rejects a non-boolean contentReviewed (no string coercion at the schema)', () => {
    expect(
      meetingAttendanceDeclarationSchema.safeParse({ ...valid, contentReviewed: 'yes' }).success,
    ).toBe(false);
  });

  it('rejects an empty meetingId', () => {
    expect(meetingAttendanceDeclarationSchema.safeParse({ ...valid, meetingId: '' }).success).toBe(
      false,
    );
  });

  it('rejects an over-long meetingId (>40, anti heap-amplification)', () => {
    expect(
      meetingAttendanceDeclarationSchema.safeParse({ ...valid, meetingId: 'x'.repeat(41) }).success,
    ).toBe(false);
  });

  it('.strict() rejects unknown keys (defense-in-depth)', () => {
    expect(
      meetingAttendanceDeclarationSchema.safeParse({ ...valid, attendedLive: true }).success,
    ).toBe(false);
  });
});

describe('meetingAbsenceDeclarationSchema (F4)', () => {
  it('accepts a bare valid meetingId (an absence carries no mode/content)', () => {
    expect(
      meetingAbsenceDeclarationSchema.safeParse({ meetingId: 'clmeeting000000000000abcd' }).success,
    ).toBe(true);
  });

  it('rejects an empty meetingId', () => {
    expect(meetingAbsenceDeclarationSchema.safeParse({ meetingId: '' }).success).toBe(false);
  });

  it('rejects an over-long meetingId (>40, anti heap-amplification)', () => {
    expect(meetingAbsenceDeclarationSchema.safeParse({ meetingId: 'x'.repeat(41) }).success).toBe(
      false,
    );
  });

  it('.strict() rejects any extra field (no mode/content on an absence)', () => {
    expect(
      meetingAbsenceDeclarationSchema.safeParse({
        meetingId: 'clmeeting000000000000abcd',
        attendanceMode: 'live',
      }).success,
    ).toBe(false);
  });
});
