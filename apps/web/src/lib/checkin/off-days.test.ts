/**
 * Off-day helpers (Tour 14).
 *
 * Pure predicates first (`isWeekendLocalDate` / `isOffDay`) then the DB-backed
 * `getOffDaySet` (Prisma-mocked). Semantics under test: weekends are off by
 * default, an explicit declaration is always off, `weekendsOff=false` disables
 * the weekend rule, and dates outside the queried window are irrelevant to the
 * predicate (the SET is the only source — the query bounds are asserted).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    memberOffDay: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import { getOffDaySet, isOffDay, isWeekendLocalDate } from './off-days';

describe('isWeekendLocalDate', () => {
  it('is true for Saturday and Sunday', () => {
    // 2026-06-06 = Saturday, 2026-06-07 = Sunday.
    expect(isWeekendLocalDate('2026-06-06')).toBe(true);
    expect(isWeekendLocalDate('2026-06-07')).toBe(true);
  });

  it('is false Monday through Friday', () => {
    // 2026-06-08 (Mon) … 2026-06-12 (Fri).
    for (const d of ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12']) {
      expect(isWeekendLocalDate(d)).toBe(false);
    }
  });
});

describe('isOffDay', () => {
  const NO_EXPLICIT = new Set<string>();

  it('weekendsOff=true → a weekend day is off', () => {
    expect(isOffDay('2026-06-06', { weekendsOff: true, explicitDates: NO_EXPLICIT })).toBe(true);
  });

  it('weekendsOff=true → a weekday is NOT off unless declared', () => {
    expect(isOffDay('2026-06-10', { weekendsOff: true, explicitDates: NO_EXPLICIT })).toBe(false);
  });

  it('weekendsOff=false → a weekend day is NOT off (member trades weekends)', () => {
    expect(isOffDay('2026-06-06', { weekendsOff: false, explicitDates: NO_EXPLICIT })).toBe(false);
  });

  it('an explicit declaration is off regardless of weekday or weekend flag', () => {
    const explicit = new Set(['2026-06-10']);
    expect(isOffDay('2026-06-10', { weekendsOff: true, explicitDates: explicit })).toBe(true);
    expect(isOffDay('2026-06-10', { weekendsOff: false, explicitDates: explicit })).toBe(true);
  });

  it('a date not in the explicit set and not a weekend is not off', () => {
    const explicit = new Set(['2026-06-10']);
    expect(isOffDay('2026-06-11', { weekendsOff: false, explicitDates: explicit })).toBe(false);
  });
});

describe('getOffDaySet', () => {
  beforeEach(() => {
    vi.mocked(db.user.findUnique).mockReset();
    vi.mocked(db.memberOffDay.findMany).mockReset();
  });

  it('resolves the weekend flag + explicit dates and bounds the query to the window', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ weekendsOff: true } as never);
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([
      { date: new Date('2026-06-10T00:00:00.000Z') },
      { date: new Date('2026-06-12T00:00:00.000Z') },
    ] as never);

    const ctx = await getOffDaySet('user-1', '2026-06-01', '2026-06-30');

    expect(ctx.weekendsOff).toBe(true);
    expect([...ctx.explicitDates].sort()).toEqual(['2026-06-10', '2026-06-12']);

    const call = vi.mocked(db.memberOffDay.findMany).mock.calls[0]?.[0] as {
      where?: { userId?: string; date?: { gte?: Date; lte?: Date } };
    };
    expect(call.where?.userId).toBe('user-1');
    expect(call.where?.date?.gte).toEqual(new Date('2026-06-01T00:00:00.000Z'));
    expect(call.where?.date?.lte).toEqual(new Date('2026-06-30T00:00:00.000Z'));
  });

  it('defaults weekendsOff to true when the user row is missing', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([] as never);

    const ctx = await getOffDaySet('ghost', '2026-06-01', '2026-06-30');

    expect(ctx.weekendsOff).toBe(true);
    expect(ctx.explicitDates.size).toBe(0);
  });

  it('honours weekendsOff=false from the user row', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ weekendsOff: false } as never);
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([] as never);

    const ctx = await getOffDaySet('user-2', '2026-06-01', '2026-06-30');

    expect(ctx.weekendsOff).toBe(false);
  });
});
