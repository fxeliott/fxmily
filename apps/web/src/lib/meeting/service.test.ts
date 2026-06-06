/**
 * V1.7 §30 — meeting service tests (Prisma-mocked).
 *
 * J-M1: countMeetingAttendance (denominator/numerator coherence, SPEC §30.4).
 * J-M2: listMeetingsForMember (window 30j + display states + neutral rate) and
 *       declareMeetingAttendance (upsert + HARD guard MeetingNotDeclarableError
 *       on cancelled / future / out-of-window, SPEC §30.7).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    meeting: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    meetingAttendance: { count: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import {
  cancelMeeting,
  countMeetingAttendance,
  declareMeetingAttendance,
  generateMeetingsForWindow,
  listMeetingAttendanceForMember,
  listMeetingsForAdmin,
  listMeetingsForMember,
  MeetingNotDeclarableError,
  MeetingNotFoundError,
  uncancelMeeting,
} from './service';

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

// J-M2 ----------------------------------------------------------------------

const NOW = new Date('2026-05-30T10:00:00.000Z');
// joinedAt long ago → windowStart = now − 30d = 2026-04-30T10:00:00.000Z
// (the now−30d floor wins over the older startOfDayParis(joinedAt) floor).
const JOINED_AT = new Date('2026-01-01T00:00:00.000Z');
const WINDOW_START = new Date('2026-04-30T10:00:00.000Z');

function meetingRow(
  id: string,
  slot: 'midday' | 'evening',
  scheduledAt: string,
  status: 'scheduled' | 'cancelled',
  attendances: { attendanceMode: 'live' | 'replay' | null; contentReviewed: boolean }[],
) {
  return { id, slot, scheduledAt: new Date(scheduledAt), status, attendances };
}

describe('listMeetingsForMember', () => {
  it('maps display states, computes the neutral rate, and queries the 30d window', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ joinedAt: JOINED_AT } as never);
    vi.mocked(db.meeting.findMany).mockResolvedValue([
      meetingRow('m1', 'midday', '2026-05-29T10:00:00.000Z', 'scheduled', [
        { attendanceMode: 'live', contentReviewed: true },
      ]), // complete
      meetingRow('m2', 'evening', '2026-05-28T18:00:00.000Z', 'scheduled', [
        { attendanceMode: 'replay', contentReviewed: false },
      ]), // partielle (mode set, content not read)
      meetingRow('m3', 'midday', '2026-05-27T10:00:00.000Z', 'scheduled', []), // en_attente
      meetingRow('m4', 'evening', '2026-05-26T18:00:00.000Z', 'cancelled', []), // cancelled
    ] as never);

    const result = await listMeetingsForMember('user-1', NOW);

    // Window query: half-open [windowStart, now), newest-first, attendance
    // left-joined for THIS user only.
    const call = vi.mocked(db.meeting.findMany).mock.calls[0];
    if (!call) throw new Error('expected meeting.findMany');
    const arg = call[0] as {
      where: { scheduledAt: Record<string, unknown> };
      orderBy: unknown;
      select: { attendances: { where: { userId: string } } };
    };
    expect(arg.where.scheduledAt).toEqual({ gte: WINDOW_START, lt: NOW });
    expect(arg.orderBy).toEqual({ scheduledAt: 'desc' });
    expect(arg.select.attendances.where).toEqual({ userId: 'user-1' });

    // user.findUnique selects only joinedAt.
    const uCall = vi.mocked(db.user.findUnique).mock.calls[0];
    if (!uCall) throw new Error('expected user.findUnique');
    const uArg = uCall[0] as { where: { id: string }; select: Record<string, unknown> };
    expect(uArg.where).toEqual({ id: 'user-1' });
    expect(Object.keys(uArg.select)).toEqual(['joinedAt']);

    expect(result.meetings).toHaveLength(4);
    expect(result.meetings.map((m) => [m.id, m.displayState, m.declarable])).toEqual([
      ['m1', 'complete', true],
      ['m2', 'partielle', true],
      ['m3', 'en_attente', true],
      ['m4', 'cancelled', false],
    ]);
    // Current declaration surfaced for the form prefill.
    expect(result.meetings[0]?.attendanceMode).toBe('live');
    expect(result.meetings[0]?.contentReviewed).toBe(true);
    expect(result.meetings[0]?.scheduledAt).toBe('2026-05-29T10:00:00.000Z');
    expect(result.meetings[0]?.slot).toBe('midday');

    // Rate: denominator = 3 scheduled, numerator = 1 complete. Cancelled m4
    // excluded from BOTH (SPEC §30.4).
    expect(result.rate.kind).toBe('ok');
    if (result.rate.kind === 'ok') {
      expect(result.rate.scheduledCount).toBe(3);
      expect(result.rate.completedCount).toBe(1);
      expect(result.rate.rate).toBeCloseTo(1 / 3, 10);
    }
  });

  it('returns an insufficient_data rate (no_meetings) when the window is empty', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ joinedAt: JOINED_AT } as never);
    vi.mocked(db.meeting.findMany).mockResolvedValue([] as never);

    const result = await listMeetingsForMember('user-1', NOW);

    expect(result.meetings).toEqual([]);
    expect(result.rate.kind).toBe('insufficient_data');
    if (result.rate.kind === 'insufficient_data') {
      expect(result.rate.reason).toBe('no_meetings');
    }
  });

  it('only-cancelled window → no fake 0% (denominator excludes cancelled)', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ joinedAt: JOINED_AT } as never);
    vi.mocked(db.meeting.findMany).mockResolvedValue([
      meetingRow('mc', 'midday', '2026-05-29T10:00:00.000Z', 'cancelled', []),
    ] as never);

    const result = await listMeetingsForMember('user-1', NOW);

    expect(result.meetings).toHaveLength(1);
    expect(result.meetings[0]?.displayState).toBe('cancelled');
    // Denominator 0 (the only meeting is cancelled) → insufficient_data, NEVER 0%.
    expect(result.rate.kind).toBe('insufficient_data');
  });

  it('returns empty defensively when the user vanished mid-flight', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);

    const result = await listMeetingsForMember('ghost', NOW);

    expect(result.meetings).toEqual([]);
    expect(result.rate.kind).toBe('insufficient_data');
    expect(vi.mocked(db.meeting.findMany)).not.toHaveBeenCalled();
  });
});

describe('declareMeetingAttendance — HARD guard (SPEC §30.7)', () => {
  const INPUT = { meetingId: 'm1', attendanceMode: 'live', contentReviewed: true } as const;

  function mockMeeting(scheduledAt: string, status: 'scheduled' | 'cancelled') {
    vi.mocked(db.user.findUnique).mockResolvedValue({ joinedAt: JOINED_AT } as never);
    vi.mocked(db.meeting.findUnique).mockResolvedValue({
      id: 'm1',
      status,
      scheduledAt: new Date(scheduledAt),
    } as never);
  }

  it('upserts a past, in-window, scheduled meeting (re-declaration safe)', async () => {
    mockMeeting('2026-05-29T10:00:00.000Z', 'scheduled');
    vi.mocked(db.meetingAttendance.upsert).mockResolvedValue({
      id: 'att1',
      meetingId: 'm1',
      attendanceMode: 'live',
      contentReviewed: true,
    } as never);

    const result = await declareMeetingAttendance('user-1', INPUT, NOW);

    const call = vi.mocked(db.meetingAttendance.upsert).mock.calls[0];
    if (!call) throw new Error('expected upsert');
    const arg = call[0] as {
      where: { meetingId_userId: { meetingId: string; userId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(arg.where.meetingId_userId).toEqual({ meetingId: 'm1', userId: 'user-1' });
    expect(arg.create).toMatchObject({
      meetingId: 'm1',
      userId: 'user-1',
      attendanceMode: 'live',
      contentReviewed: true,
      declaredAt: NOW,
    });
    expect(arg.update).toMatchObject({
      attendanceMode: 'live',
      contentReviewed: true,
      declaredAt: NOW,
    });
    expect(result).toEqual({
      id: 'att1',
      meetingId: 'm1',
      attendanceMode: 'live',
      contentReviewed: true,
    });
  });

  it('REFUSES a cancelled meeting (reason=cancelled), never upserts', async () => {
    mockMeeting('2026-05-29T10:00:00.000Z', 'cancelled');

    await expect(declareMeetingAttendance('user-1', INPUT, NOW)).rejects.toMatchObject({
      name: 'MeetingNotDeclarableError',
      reason: 'cancelled',
    });
    expect(vi.mocked(db.meetingAttendance.upsert)).not.toHaveBeenCalled();
  });

  it('REFUSES a future meeting (reason=future)', async () => {
    mockMeeting('2026-05-31T10:00:00.000Z', 'scheduled'); // after NOW

    const err = await declareMeetingAttendance('user-1', INPUT, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(MeetingNotDeclarableError);
    expect(err.reason).toBe('future');
    expect(vi.mocked(db.meetingAttendance.upsert)).not.toHaveBeenCalled();
  });

  it('REFUSES an out-of-window meeting (reason=out_of_window)', async () => {
    mockMeeting('2026-04-29T10:00:00.000Z', 'scheduled'); // before WINDOW_START

    const err = await declareMeetingAttendance('user-1', INPUT, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(MeetingNotDeclarableError);
    expect(err.reason).toBe('out_of_window');
    expect(vi.mocked(db.meetingAttendance.upsert)).not.toHaveBeenCalled();
  });

  it('REFUSES an unknown meeting id (reason=not_found)', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ joinedAt: JOINED_AT } as never);
    vi.mocked(db.meeting.findUnique).mockResolvedValue(null as never);

    const err = await declareMeetingAttendance('user-1', INPUT, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(MeetingNotDeclarableError);
    expect(err.reason).toBe('not_found');
    expect(vi.mocked(db.meetingAttendance.upsert)).not.toHaveBeenCalled();
  });
});

// J-M3 — admin surface + cron generation -------------------------------------

describe('generateMeetingsForWindow (idempotent createMany)', () => {
  it('materialises the occurrences with skipDuplicates and returns {generated, skipped}', async () => {
    // Mon 2026-06-01 → +2 days = Mon + Tue = 4 occurrences (2 slots × 2 days).
    vi.mocked(db.meeting.createMany).mockResolvedValue({ count: 4 } as never);

    const result = await generateMeetingsForWindow('2026-06-01', 2);

    const call = vi.mocked(db.meeting.createMany).mock.calls[0];
    if (!call) throw new Error('expected createMany');
    const arg = call[0] as {
      data: { date: Date; slot: string; scheduledAt: Date }[];
      skipDuplicates: boolean;
    };
    // Idempotence guard: skipDuplicates on @@unique(date, slot) (SPEC §30.7).
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(4);
    // Mon then Tue, each midday + evening, chronological.
    expect(arg.data.map((d) => d.slot)).toEqual(['midday', 'evening', 'midday', 'evening']);
    // `date` is a UTC-midnight Date for the @db.Date column.
    expect(arg.data[0]?.date.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    // DST-aware scheduledAt: 2026-06-01 is CEST → 12h Paris = 10:00 UTC.
    expect(arg.data[0]?.scheduledAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');

    expect(result).toEqual({ generated: 4, skipped: 0 });
  });

  it('re-run with all rows present → generated 0, skipped = occurrence count', async () => {
    vi.mocked(db.meeting.createMany).mockResolvedValue({ count: 0 } as never);

    // Mon 2026-06-01 → +1 day = Mon only = 2 occurrences.
    const result = await generateMeetingsForWindow('2026-06-01', 1);

    expect(result).toEqual({ generated: 0, skipped: 2 });
  });

  it('skips a weekend-only window without touching the DB', async () => {
    // Sat 2026-06-06 + Sun 2026-06-07 → 0 weekday occurrences.
    const result = await generateMeetingsForWindow('2026-06-06', 2);

    expect(result).toEqual({ generated: 0, skipped: 0 });
    expect(vi.mocked(db.meeting.createMany)).not.toHaveBeenCalled();
  });
});

describe('cancelMeeting / uncancelMeeting', () => {
  it('cancel: flips status to cancelled and safeFreeText-sanitises the reason', async () => {
    vi.mocked(db.meeting.findUnique).mockResolvedValue({ id: 'm1' } as never);
    vi.mocked(db.meeting.update).mockResolvedValue({ id: 'm1', status: 'cancelled' } as never);

    // Reason carries a zero-width char (U+200B) — must be stripped by safeFreeText.
    const result = await cancelMeeting('m1', 'Pas​ dispo');

    const call = vi.mocked(db.meeting.update).mock.calls[0];
    if (!call) throw new Error('expected update');
    const arg = call[0] as {
      where: { id: string };
      data: { status: string; cancelledReason: string | null };
    };
    expect(arg.where).toEqual({ id: 'm1' });
    expect(arg.data.status).toBe('cancelled');
    // Zero-width stripped + NFC normalised (SPEC §30.6).
    expect(arg.data.cancelledReason).toBe('Pas dispo');
    expect(result).toEqual({ id: 'm1', status: 'cancelled' });
  });

  it('cancel without a reason stores null (no note)', async () => {
    vi.mocked(db.meeting.findUnique).mockResolvedValue({ id: 'm1' } as never);
    vi.mocked(db.meeting.update).mockResolvedValue({ id: 'm1', status: 'cancelled' } as never);

    await cancelMeeting('m1');

    const arg = vi.mocked(db.meeting.update).mock.calls[0]?.[0] as {
      data: { cancelledReason: string | null };
    };
    expect(arg.data.cancelledReason).toBeNull();
  });

  it('uncancel: back to scheduled, clears the reason', async () => {
    vi.mocked(db.meeting.findUnique).mockResolvedValue({ id: 'm1' } as never);
    vi.mocked(db.meeting.update).mockResolvedValue({ id: 'm1', status: 'scheduled' } as never);

    const result = await uncancelMeeting('m1');

    const arg = vi.mocked(db.meeting.update).mock.calls[0]?.[0] as {
      data: { status: string; cancelledReason: string | null };
    };
    expect(arg.data).toEqual({ status: 'scheduled', cancelledReason: null });
    expect(result).toEqual({ id: 'm1', status: 'scheduled' });
  });

  it('throws MeetingNotFoundError on an unknown id (never updates)', async () => {
    vi.mocked(db.meeting.findUnique).mockResolvedValue(null as never);

    await expect(cancelMeeting('ghost')).rejects.toBeInstanceOf(MeetingNotFoundError);
    expect(vi.mocked(db.meeting.update)).not.toHaveBeenCalled();

    await expect(uncancelMeeting('ghost')).rejects.toBeInstanceOf(MeetingNotFoundError);
    expect(vi.mocked(db.meeting.update)).not.toHaveBeenCalled();
  });
});

describe('listMeetingsForAdmin', () => {
  it('returns slots with per-meeting counts + isPast, window centred on now', async () => {
    vi.mocked(db.meeting.findMany).mockResolvedValue([
      // Past, scheduled: 2 complete, 1 partial → completedCount 2, declaredCount 3.
      {
        id: 'm1',
        slot: 'midday',
        scheduledAt: new Date('2026-05-29T10:00:00.000Z'),
        status: 'scheduled',
        attendances: [
          { attendanceMode: 'live', contentReviewed: true },
          { attendanceMode: 'replay', contentReviewed: true },
          { attendanceMode: 'live', contentReviewed: false }, // partial
        ],
      },
      // Future, cancelled, no attendance.
      {
        id: 'm2',
        slot: 'evening',
        scheduledAt: new Date('2026-05-31T18:00:00.000Z'),
        status: 'cancelled',
        attendances: [],
      },
    ] as never);

    const result = await listMeetingsForAdmin(NOW); // NOW = 2026-05-30T10:00Z

    // Window: [now-14d, now+14d).
    const call = vi.mocked(db.meeting.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany');
    const arg = call[0] as { where: { scheduledAt: { gte: Date; lt: Date } }; orderBy: unknown };
    expect(arg.orderBy).toEqual({ scheduledAt: 'desc' });
    expect(arg.where.scheduledAt.gte.getTime()).toBeLessThan(NOW.getTime());
    expect(arg.where.scheduledAt.lt.getTime()).toBeGreaterThan(NOW.getTime());

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'm1',
      status: 'scheduled',
      isPast: true,
      completedCount: 2,
      declaredCount: 3,
    });
    expect(result[1]).toMatchObject({
      id: 'm2',
      status: 'cancelled',
      isPast: false,
      completedCount: 0,
      declaredCount: 0,
    });
  });
});

describe('listMeetingAttendanceForMember (rate excludes cancelled)', () => {
  it('maps admin states + computes a rate that excludes cancelled slots', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ joinedAt: JOINED_AT } as never);
    vi.mocked(db.meeting.findMany).mockResolvedValue([
      meetingRow('m1', 'midday', '2026-05-29T10:00:00.000Z', 'scheduled', [
        { attendanceMode: 'live', contentReviewed: true },
      ]), // complete
      meetingRow('m2', 'evening', '2026-05-28T18:00:00.000Z', 'scheduled', [
        { attendanceMode: 'replay', contentReviewed: false },
      ]), // partielle
      meetingRow('m3', 'midday', '2026-05-27T10:00:00.000Z', 'scheduled', []), // absent
      meetingRow('m4', 'evening', '2026-05-26T18:00:00.000Z', 'cancelled', []), // cancelled
    ] as never);

    const result = await listMeetingAttendanceForMember('user-1', NOW);

    // attendances left-joined for THIS member only (admin read-only).
    const call = vi.mocked(db.meeting.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany');
    const arg = call[0] as {
      where: { scheduledAt: Record<string, unknown> };
      select: { attendances: { where: { userId: string } } };
    };
    expect(arg.where.scheduledAt).toEqual({ gte: WINDOW_START, lt: NOW });
    expect(arg.select.attendances.where).toEqual({ userId: 'user-1' });

    expect(result.meetings.map((m) => [m.id, m.state])).toEqual([
      ['m1', 'complete'],
      ['m2', 'partielle'],
      ['m3', 'absent'],
      ['m4', 'cancelled'],
    ]);

    // Rate: 3 scheduled denominator, 1 complete numerator. Cancelled m4 excluded
    // from BOTH (SPEC §30.3).
    expect(result.rate.kind).toBe('ok');
    if (result.rate.kind === 'ok') {
      expect(result.rate.scheduledCount).toBe(3);
      expect(result.rate.completedCount).toBe(1);
      expect(result.rate.rate).toBeCloseTo(1 / 3, 10);
    }
  });

  it('only-cancelled window → insufficient_data (never a fake 0%)', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ joinedAt: JOINED_AT } as never);
    vi.mocked(db.meeting.findMany).mockResolvedValue([
      meetingRow('mc', 'midday', '2026-05-29T10:00:00.000Z', 'cancelled', []),
    ] as never);

    const result = await listMeetingAttendanceForMember('user-1', NOW);

    expect(result.meetings[0]?.state).toBe('cancelled');
    expect(result.rate.kind).toBe('insufficient_data');
  });

  it('returns empty defensively when the member vanished', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);

    const result = await listMeetingAttendanceForMember('ghost', NOW);

    expect(result.meetings).toEqual([]);
    expect(result.rate.kind).toBe('insufficient_data');
    expect(vi.mocked(db.meeting.findMany)).not.toHaveBeenCalled();
  });
});
