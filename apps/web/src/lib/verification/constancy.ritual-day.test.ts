import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2 hardening — pins the ISO-week bucketing fix for the daily ritual scan.
 *
 * Bug: ritual ScoreEvents were created without an explicit `createdAt`, so
 * Prisma stamped them with the scan time (the morning AFTER the ritual day).
 * The weekly fold buckets events by `createdAt` over the ISO week, so a Sunday
 * ritual (scanned Monday) leaked into the next week — every Monday the week's
 * constancy score omitted its own Sunday and was polluted by the prior one.
 *
 * Fix: stamp `createdAt = yesterdayDate` (the Paris civil midnight of the
 * ritual day). This test proves every emitted event carries the ritual day,
 * not the scan instant.
 */

const m = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  checkinFindMany: vi.fn(),
  offDayFindMany: vi.fn(),
  discrepancyFindFirst: vi.fn(),
  discrepancyCreate: vi.fn(),
  scoreEventCreateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: m.userFindMany },
    dailyCheckin: { findMany: m.checkinFindMany },
    memberOffDay: { findMany: m.offDayFindMany },
    discrepancy: { findFirst: m.discrepancyFindFirst, create: m.discrepancyCreate },
    scoreEvent: { createMany: m.scoreEventCreateMany },
  },
}));

vi.mock('@/lib/observability', () => ({ reportError: vi.fn() }));

import { scanRitualsForAllMembers } from './constancy';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { reportError } from '@/lib/observability';

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  // Tour 14 — default: no explicit off day declared. Off-day cases override it.
  m.offDayFindMany.mockResolvedValue([]);
});

describe('scanRitualsForAllMembers — ritual-day timestamping', () => {
  it('stamps every ritual ScoreEvent with the ritual day (Paris), not the scan time', async () => {
    // Scan running Monday 2026-06-15 08:00 Paris (06:00Z, CEST +2) → the ritual
    // day is the previous civil day, Sunday 2026-06-14.
    const now = new Date('2026-06-15T06:00:00.000Z');
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: false }]);
    m.checkinFindMany.mockResolvedValue([]); // fully blank day → two forgot events
    m.discrepancyFindFirst.mockResolvedValue(null);
    m.discrepancyCreate.mockResolvedValue({ id: 'disc1' });
    m.scoreEventCreateMany.mockResolvedValue({ count: 2 });

    await scanRitualsForAllMembers({ now });

    expect(m.scoreEventCreateMany).toHaveBeenCalledTimes(1);
    const arg = m.scoreEventCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ createdAt: Date; reason: string }>;
    };
    const ritualDay = parseLocalDate('2026-06-14');
    expect(arg.data).toHaveLength(2);
    for (const ev of arg.data) {
      expect(ev.createdAt).toEqual(ritualDay);
    }
  });

  it('stamps filled events with the ritual day too', async () => {
    const now = new Date('2026-06-15T06:00:00.000Z');
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: false }]);
    m.checkinFindMany.mockResolvedValue([
      { userId: 'memberA', slot: 'morning' },
      { userId: 'memberA', slot: 'evening' },
    ]);
    m.scoreEventCreateMany.mockResolvedValue({ count: 2 });

    await scanRitualsForAllMembers({ now });

    const arg = m.scoreEventCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ createdAt: Date; reason: string }>;
    };
    const ritualDay = parseLocalDate('2026-06-14');
    expect(arg.data.every((ev) => ev.reason === 'filled')).toBe(true);
    for (const ev of arg.data) {
      expect(ev.createdAt).toEqual(ritualDay);
    }
    // A fully filled day raises no blank-day discrepancy.
    expect(m.discrepancyCreate).not.toHaveBeenCalled();
  });
});

/**
 * CONC1-A — the blank-day discrepancy create is read-then-created with no
 * transaction; two interleaved passes (daily cron + event-driven batch) could
 * both read « none » and both INSERT. The partial unique index
 * `discrepancies_blank_day_uniq` makes the loser raise P2002; the app folds it
 * to a no-op by re-reading the winner so the day's `forgot` events still point
 * at the single surviving excusable discrepancy. These tests lock that fold.
 */
describe('scanRitualsForAllMembers — blank-day race (CONC1-A)', () => {
  it('🚨 RACE — a concurrent pass already created the blank day (P2002) → no-op, the forgot events still link the winner', async () => {
    const now = new Date('2026-06-15T06:00:00.000Z');
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: false }]);
    m.checkinFindMany.mockResolvedValue([]); // fully blank day
    // First read (pre-create) sees nothing; the create loses the race (P2002);
    // the catch re-reads and finds the winner row.
    m.discrepancyFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner1' });
    m.discrepancyCreate.mockRejectedValue({ code: 'P2002' });
    m.scoreEventCreateMany.mockResolvedValue({ count: 2 });

    const result = await scanRitualsForAllMembers({ now });

    // P2002 is a clean dedup, NOT a member-level failure.
    expect(result.errors).toBe(0);
    // The winning pass already counted the row — the loser must not double-count.
    expect(result.blankDayDiscrepancies).toBe(0);
    // The two forgot events reference the SURVIVOR so a « motif valable » still
    // excuses the whole day.
    expect(m.scoreEventCreateMany).toHaveBeenCalledTimes(1);
    const arg = m.scoreEventCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ reason: string; relatedDiscrepancyId: string | null }>;
    };
    const forgot = arg.data.filter((e) => e.reason === 'forgot_no_reason');
    expect(forgot).toHaveLength(2);
    for (const ev of forgot) {
      expect(ev.relatedDiscrepancyId).toBe('winner1');
    }
  });

  it('🚨 a NON-P2002 create failure is surfaced (errors + Sentry), never silently swallowed', async () => {
    const now = new Date('2026-06-15T06:00:00.000Z');
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: false }]);
    m.checkinFindMany.mockResolvedValue([]); // fully blank day
    m.discrepancyFindFirst.mockResolvedValue(null);
    m.discrepancyCreate.mockRejectedValue(new Error('db connection lost'));
    m.scoreEventCreateMany.mockResolvedValue({ count: 2 });

    // The scan must NOT throw — the member is settled as rejected and reported.
    const result = await scanRitualsForAllMembers({ now });

    expect(result.errors).toBe(1);
    expect(vi.mocked(reportError)).toHaveBeenCalledWith(
      'verification.constancy.scan',
      expect.any(Error),
      expect.objectContaining({ memberId: 'memberA' }),
    );
    // The throw happens before the events write — no score events for this member.
    expect(m.scoreEventCreateMany).not.toHaveBeenCalled();
  });
});

/**
 * Tour 14 — the off-day "pont" on the constancy ritual scan. Yesterday
 * (2026-06-14) is a Sunday. For a member who keeps weekends off, an unfilled
 * off day emits NO event and raises NO blank-day discrepancy (neutral, not
 * "excused"); a check-in actually filed on that off day still emits its
 * `filled` event (the rempli wins). An explicit weekday declaration is off too.
 */
describe('scanRitualsForAllMembers — off-day pont (Tour 14)', () => {
  it('a blank OFF day (weekend, weekendsOff=true) emits NOTHING: no forgot, no discrepancy', async () => {
    const now = new Date('2026-06-15T06:00:00.000Z'); // ritual day = Sun 2026-06-14
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: true }]);
    m.checkinFindMany.mockResolvedValue([]); // nothing filed on the off day

    const result = await scanRitualsForAllMembers({ now });

    // No blank-day discrepancy (the day is neutral, not accused).
    expect(m.discrepancyCreate).not.toHaveBeenCalled();
    expect(result.blankDayDiscrepancies).toBe(0);
    // No score events at all (the empty write is skipped).
    expect(m.scoreEventCreateMany).not.toHaveBeenCalled();
    expect(result.forgotEvents).toBe(0);
    expect(result.filledEvents).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('a check-in FILLED on an off day still emits `filled` (no forgot for the empty slot)', async () => {
    const now = new Date('2026-06-15T06:00:00.000Z');
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: true }]);
    // Morning filed on the off Sunday, evening left empty.
    m.checkinFindMany.mockResolvedValue([{ userId: 'memberA', slot: 'morning' }]);
    m.scoreEventCreateMany.mockResolvedValue({ count: 1 });

    const result = await scanRitualsForAllMembers({ now });

    expect(m.discrepancyCreate).not.toHaveBeenCalled();
    expect(m.scoreEventCreateMany).toHaveBeenCalledTimes(1);
    const arg = m.scoreEventCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ reason: string }>;
    };
    // Exactly one event, the filled morning — the empty evening emits NO forgot.
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0]?.reason).toBe('filled');
    expect(result.filledEvents).toBe(1);
    expect(result.forgotEvents).toBe(0);
  });

  it('an EXPLICITLY declared off day is off even when weekendsOff=false', async () => {
    const now = new Date('2026-06-15T06:00:00.000Z');
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: false }]);
    m.checkinFindMany.mockResolvedValue([]);
    // The member declared the ritual day (2026-06-14) off explicitly.
    m.offDayFindMany.mockResolvedValue([{ userId: 'memberA' }]);

    const result = await scanRitualsForAllMembers({ now });

    expect(m.discrepancyCreate).not.toHaveBeenCalled();
    expect(m.scoreEventCreateMany).not.toHaveBeenCalled();
    expect(result.forgotEvents).toBe(0);
  });
});
