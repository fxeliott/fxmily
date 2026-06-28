import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    dailyCheckin: { count: vi.fn() },
    discrepancy: { groupBy: vi.fn() },
    scoreEvent: { groupBy: vi.fn() },
    alert: { count: vi.fn() },
  },
}));

vi.mock('@/lib/meeting/service', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/meeting/service')>('@/lib/meeting/service');
  return {
    // Keep the real ADMIN_MEETING_WINDOW_DAYS const (the loader surfaces it in
    // the view-model's `windows`), mock only the DB-backed list.
    ADMIN_MEETING_WINDOW_DAYS: actual.ADMIN_MEETING_WINDOW_DAYS,
    listMeetingsForAdmin: vi.fn(),
  };
});

import { db } from '@/lib/db';
import { listMeetingsForAdmin, ADMIN_MEETING_WINDOW_DAYS } from '@/lib/meeting/service';

import { getSystemHealthOverview, HEALTH_RECENT_DAYS } from './system-health-service';

beforeEach(() => {
  vi.resetAllMocks();
});

/** Grab the first-call argument of a mocked Prisma method (typed loosely). */
function firstArg(fn: unknown): Record<string, unknown> {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const call = calls[0];
  if (!call) throw new Error('expected the method to have been called');
  return call[0] as Record<string, unknown>;
}

/** Minimal AdminMeetingView shape the fold consumes. */
function meeting(
  partial: Partial<{
    completedCount: number;
    declaredCount: number;
    gapCount: number;
  }> = {},
) {
  return {
    id: 'm',
    slot: 'midday',
    scheduledAt: '2026-06-20T10:00:00.000Z',
    status: 'scheduled',
    isPast: true,
    completedCount: partial.completedCount ?? 0,
    declaredCount: partial.declaredCount ?? 0,
    gapCount: partial.gapCount ?? 0,
  };
}

describe('getSystemHealthOverview', () => {
  it('folds counts, gaps-by-status, score reasons and meeting totals into one view-model', async () => {
    vi.mocked(db.dailyCheckin.count).mockResolvedValue(12 as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([
      { status: 'open', _count: { _all: 3 } },
      { status: 'acknowledged', _count: { _all: 1 } },
      { status: 'resolved', _count: { _all: 5 } },
    ] as never);
    vi.mocked(db.scoreEvent.groupBy).mockResolvedValue([
      { reason: 'filled', _count: { _all: 20 } },
      { reason: 'forgot_no_reason', _count: { _all: 4 } },
      { reason: 'reality_gap', _count: { _all: 2 } },
      { reason: 'false_declaration', _count: { _all: 1 } },
    ] as never);
    vi.mocked(db.alert.count).mockResolvedValue(2 as never);
    vi.mocked(listMeetingsForAdmin).mockResolvedValue([
      meeting({ completedCount: 4, declaredCount: 6, gapCount: 1 }),
      meeting({ completedCount: 2, declaredCount: 3, gapCount: 0 }),
    ] as never);

    const now = new Date('2026-06-22T09:00:00.000Z');
    const out = await getSystemHealthOverview(now);

    expect(out.checkins).toEqual({ recentCheckins: 12 });
    expect(out.truthGaps).toEqual({ open: 3, acknowledged: 1, resolved: 5, total: 9 });
    expect(out.scoreMovements).toEqual({
      filled: 20,
      forgot_no_reason: 4,
      reality_gap: 2,
      false_declaration: 1,
      net: 20 - 7,
      total: 27,
    });
    expect(out.meetings).toEqual({ meetings: 2, completed: 6, declared: 9, gaps: 1 });
    expect(out.recentAlerts).toBe(2);
    expect(out.windows).toEqual({
      checkinDays: HEALTH_RECENT_DAYS,
      scoreDays: HEALTH_RECENT_DAYS,
      alertDays: HEALTH_RECENT_DAYS,
      meetingDays: ADMIN_MEETING_WINDOW_DAYS,
    });
    expect(out.computedAt).toBe(now);
  });

  it('zeroes every axis when the DB returns empty aggregates', async () => {
    vi.mocked(db.dailyCheckin.count).mockResolvedValue(0 as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.scoreEvent.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.alert.count).mockResolvedValue(0 as never);
    vi.mocked(listMeetingsForAdmin).mockResolvedValue([] as never);

    const out = await getSystemHealthOverview(new Date('2026-06-22T09:00:00.000Z'));

    expect(out.truthGaps).toEqual({ open: 0, acknowledged: 0, resolved: 0, total: 0 });
    expect(out.scoreMovements).toEqual({
      filled: 0,
      forgot_no_reason: 0,
      reality_gap: 0,
      false_declaration: 0,
      net: 0,
      total: 0,
    });
    expect(out.meetings).toEqual({ meetings: 0, completed: 0, declared: 0, gaps: 0 });
    expect(out.recentAlerts).toBe(0);
  });

  it('excludes deleted members and windows every recent read by the floor', async () => {
    vi.mocked(db.dailyCheckin.count).mockResolvedValue(0 as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.scoreEvent.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.alert.count).mockResolvedValue(0 as never);
    vi.mocked(listMeetingsForAdmin).mockResolvedValue([] as never);

    const now = new Date('2026-06-22T09:00:00.000Z');
    await getSystemHealthOverview(now);

    // Check-in floor is a UTC-midnight @db.Date pin, not a raw timestamp.
    const checkinWhere = firstArg(db.dailyCheckin.count).where as Record<string, unknown>;
    expect((checkinWhere.date as { gte: Date }).gte).toBeInstanceOf(Date);
    expect((checkinWhere.date as { gte: Date }).gte.getUTCHours()).toBe(0);

    // Truth gaps: grouped by status, deleted members excluded, no date window.
    const gapArg = firstArg(db.discrepancy.groupBy);
    expect(gapArg.by).toEqual(['status']);
    expect(gapArg.where).toEqual({ member: { status: { not: 'deleted' } } });

    // Score movements: grouped by reason, windowed + deleted-excluded.
    const scoreArg = firstArg(db.scoreEvent.groupBy);
    expect(scoreArg.by).toEqual(['reason']);
    const scoreWhere = scoreArg.where as Record<string, unknown>;
    expect((scoreWhere.createdAt as { gte: Date }).gte).toBeInstanceOf(Date);
    expect(scoreWhere.member).toEqual({ status: { not: 'deleted' } });

    // Alerts: windowed + deleted-excluded.
    const alertWhere = firstArg(db.alert.count).where as Record<string, unknown>;
    expect((alertWhere.createdAt as { gte: Date }).gte).toBeInstanceOf(Date);
    expect(alertWhere.member).toEqual({ status: { not: 'deleted' } });

    // Meeting list is queried at `now` (its own bounded ±14d window).
    expect(vi.mocked(listMeetingsForAdmin)).toHaveBeenCalledWith(now);
  });

  it('drops an unknown score reason without throwing', async () => {
    vi.mocked(db.dailyCheckin.count).mockResolvedValue(0 as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.scoreEvent.groupBy).mockResolvedValue([
      { reason: 'filled', _count: { _all: 3 } },
      { reason: 'mystery', _count: { _all: 9 } },
    ] as never);
    vi.mocked(db.alert.count).mockResolvedValue(0 as never);
    vi.mocked(listMeetingsForAdmin).mockResolvedValue([] as never);

    const out = await getSystemHealthOverview(new Date('2026-06-22T09:00:00.000Z'));

    expect(out.scoreMovements.filled).toBe(3);
    expect(out.scoreMovements.total).toBe(3);
  });
});
