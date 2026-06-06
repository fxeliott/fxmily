/**
 * V1.7 §30 — countMeetingAttendance tests (J-M1, Prisma-mocked).
 *
 * Pins the query shape so a future edit cannot silently break the rate's
 * denominator/numerator coherence (SPEC §30.4):
 *   - denominator = scheduled meetings in the half-open window [from, to)
 *   - numerator   = COMPLETE attendances (mode != null AND contentReviewed)
 *                   joined to a SCHEDULED in-window meeting (cancelled excluded)
 *   - recency     = all-time last declaredAt, select declaredAt only
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    meeting: { count: vi.fn() },
    meetingAttendance: { count: vi.fn(), findFirst: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import { countMeetingAttendance } from './service';

const FROM = new Date('2026-04-30T10:00:00.000Z');
const TO = new Date('2026-05-30T10:00:00.000Z');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('countMeetingAttendance', () => {
  it('counts the scheduled denominator + complete numerator + last declaration', async () => {
    vi.mocked(db.meeting.count).mockResolvedValue(8 as never);
    vi.mocked(db.meetingAttendance.count).mockResolvedValue(5 as never);
    vi.mocked(db.meetingAttendance.findFirst).mockResolvedValue({
      declaredAt: new Date('2026-05-29T18:30:00.000Z'),
    } as never);

    const result = await countMeetingAttendance('user-1', FROM, TO);

    // Denominator: scheduled meetings in the half-open window [from, to).
    const mCall = vi.mocked(db.meeting.count).mock.calls[0];
    if (!mCall) throw new Error('expected meeting.count');
    const mArg = mCall[0] as { where: { status: string; scheduledAt: Record<string, unknown> } };
    expect(mArg.where.status).toBe('scheduled');
    expect(mArg.where.scheduledAt).toEqual({ gte: FROM, lt: TO });

    // Numerator: complete attendances joined to a scheduled, in-window meeting.
    const aCall = vi.mocked(db.meetingAttendance.count).mock.calls[0];
    if (!aCall) throw new Error('expected meetingAttendance.count');
    const aArg = aCall[0] as {
      where: {
        userId: string;
        attendanceMode: Record<string, unknown>;
        contentReviewed: boolean;
        meeting: { status: string; scheduledAt: Record<string, unknown> };
      };
    };
    expect(aArg.where.userId).toBe('user-1');
    expect(aArg.where.attendanceMode).toEqual({ not: null });
    expect(aArg.where.contentReviewed).toBe(true);
    // Cancelled meetings are excluded from the numerator (SPEC §30.4).
    expect(aArg.where.meeting.status).toBe('scheduled');
    expect(aArg.where.meeting.scheduledAt).toEqual({ gte: FROM, lt: TO });

    // Recency: all-time last declaration, select declaredAt only.
    const ffCall = vi.mocked(db.meetingAttendance.findFirst).mock.calls[0];
    if (!ffCall) throw new Error('expected findFirst');
    const ffArg = ffCall[0] as {
      where: { userId: string };
      orderBy: unknown;
      select: Record<string, unknown>;
    };
    expect(ffArg.where).toEqual({ userId: 'user-1' });
    expect(ffArg.orderBy).toEqual({ declaredAt: 'desc' });
    expect(Object.keys(ffArg.select)).toEqual(['declaredAt']);

    expect(result).toEqual({
      scheduledCount: 8,
      completedCount: 5,
      lastDeclaredAt: '2026-05-29T18:30:00.000Z',
    });
  });

  it('returns lastDeclaredAt=null when the member never declared', async () => {
    vi.mocked(db.meeting.count).mockResolvedValue(0 as never);
    vi.mocked(db.meetingAttendance.count).mockResolvedValue(0 as never);
    vi.mocked(db.meetingAttendance.findFirst).mockResolvedValue(null as never);

    expect(await countMeetingAttendance('user-1', FROM, TO)).toEqual({
      scheduledCount: 0,
      completedCount: 0,
      lastDeclaredAt: null,
    });
  });
});
