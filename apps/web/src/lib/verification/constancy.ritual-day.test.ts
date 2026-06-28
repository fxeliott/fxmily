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
  discrepancyFindFirst: vi.fn(),
  discrepancyCreate: vi.fn(),
  scoreEventCreateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: m.userFindMany },
    dailyCheckin: { findMany: m.checkinFindMany },
    discrepancy: { findFirst: m.discrepancyFindFirst, create: m.discrepancyCreate },
    scoreEvent: { createMany: m.scoreEventCreateMany },
  },
}));

vi.mock('@/lib/observability', () => ({ reportError: vi.fn() }));

import { scanRitualsForAllMembers } from './constancy';
import { parseLocalDate } from '@/lib/checkin/timezone';

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('scanRitualsForAllMembers — ritual-day timestamping', () => {
  it('stamps every ritual ScoreEvent with the ritual day (Paris), not the scan time', async () => {
    // Scan running Monday 2026-06-15 08:00 Paris (06:00Z, CEST +2) → the ritual
    // day is the previous civil day, Sunday 2026-06-14.
    const now = new Date('2026-06-15T06:00:00.000Z');
    m.userFindMany.mockResolvedValue([{ id: 'memberA' }]);
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
    m.userFindMany.mockResolvedValue([{ id: 'memberA' }]);
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
