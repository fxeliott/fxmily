import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    habitLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import {
  getHabitLogById,
  listHabitLogsByKind,
  listRecentHabitLogs,
  upsertHabitLog,
} from './service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sleepInput = {
  kind: 'sleep' as const,
  date: '2026-05-13',
  value: { durationMin: 420, quality: 7 },
  notes: 'Couché à 23h, réveil naturel.',
};

const sportInput = {
  kind: 'sport' as const,
  date: '2026-05-14',
  value: { type: 'cardio' as const, durationMin: 45, intensityRating: 6 },
};

function makeRow(
  overrides: Partial<{ id: string; userId: string; kind: string; date: Date }> = {},
) {
  return {
    id: 'hl-1',
    userId: 'user-1',
    date: new Date('2026-05-13T00:00:00Z'),
    kind: 'sleep',
    value: { durationMin: 420, quality: 7 },
    notes: 'Couché à 23h, réveil naturel.',
    createdAt: new Date('2026-05-13T08:00:00Z'),
    updatedAt: new Date('2026-05-13T08:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// upsertHabitLog
// ---------------------------------------------------------------------------

describe('upsertHabitLog', () => {
  it('upserts on the (userId, date, kind) composite unique key', async () => {
    vi.mocked(db.habitLog.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.habitLog.upsert).mockResolvedValue(makeRow() as never);

    const result = await upsertHabitLog('user-1', sleepInput);

    expect(db.habitLog.upsert).toHaveBeenCalledOnce();
    const call = vi.mocked(db.habitLog.upsert).mock.calls[0];
    if (!call) throw new Error('expected upsert to be called');
    const arg = call[0] as {
      where: { userId_date_kind: { userId: string; date: Date; kind: string } };
      create: { kind: string };
    };
    expect(arg.where.userId_date_kind.userId).toBe('user-1');
    expect(arg.where.userId_date_kind.kind).toBe('sleep');
    expect(arg.where.userId_date_kind.date.toISOString().slice(0, 10)).toBe('2026-05-13');
    expect(result.wasNew).toBe(true);
    expect(result.log.date).toBe('2026-05-13');
  });

  it('reports wasNew=false when the row already exists', async () => {
    vi.mocked(db.habitLog.findUnique).mockResolvedValue({ id: 'hl-existing' } as never);
    vi.mocked(db.habitLog.upsert).mockResolvedValue(makeRow() as never);
    const result = await upsertHabitLog('user-1', sleepInput);
    expect(result.wasNew).toBe(false);
  });

  it('serializes a sport input with intensity rating', async () => {
    vi.mocked(db.habitLog.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.habitLog.upsert).mockResolvedValue(
      makeRow({
        kind: 'sport',
        date: new Date('2026-05-14T00:00:00Z'),
      }) as never,
    );
    const result = await upsertHabitLog('user-1', sportInput);
    expect(result.log.kind).toBe('sport');
    expect(result.log.date).toBe('2026-05-14');
  });
});

// ---------------------------------------------------------------------------
// getHabitLogById (BOLA defence — pattern carbone V1.9 TIER B)
// ---------------------------------------------------------------------------

describe('getHabitLogById', () => {
  it('returns null on empty id', async () => {
    expect(await getHabitLogById('user-1', '')).toBeNull();
  });

  it('returns null on oversized id (>64 chars)', async () => {
    expect(await getHabitLogById('user-1', 'x'.repeat(65))).toBeNull();
    expect(db.habitLog.findFirst).not.toHaveBeenCalled();
  });

  it('queries findFirst with both id AND userId in the WHERE clause (atomic, anti-BOLA)', async () => {
    vi.mocked(db.habitLog.findFirst).mockResolvedValue(null as never);
    await getHabitLogById('user-1', 'hl-1');
    const call = vi.mocked(db.habitLog.findFirst).mock.calls[0];
    if (!call) throw new Error('expected findFirst to be called');
    const arg = call[0] as { where: { id: string; userId: string } };
    expect(arg.where).toEqual({ id: 'hl-1', userId: 'user-1' });
  });

  it('serializes the row when ownership matches', async () => {
    vi.mocked(db.habitLog.findFirst).mockResolvedValue(makeRow() as never);
    const result = await getHabitLogById('user-1', 'hl-1');
    expect(result?.userId).toBe('user-1');
    expect(result?.date).toBe('2026-05-13');
    expect(result?.kind).toBe('sleep');
  });

  it('returns null when row absent (e.g. belongs to another user)', async () => {
    vi.mocked(db.habitLog.findFirst).mockResolvedValue(null as never);
    expect(await getHabitLogById('user-1', 'hl-other')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listRecentHabitLogs
// ---------------------------------------------------------------------------

describe('listRecentHabitLogs', () => {
  it('queries the rolling window with date desc + kind asc tiebreak', async () => {
    vi.mocked(db.habitLog.findMany).mockResolvedValue([makeRow()] as never);
    await listRecentHabitLogs('user-1', 14);

    const call = vi.mocked(db.habitLog.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as {
      where: { userId: string; date: { gte: Date } };
      orderBy: Array<{ date?: 'asc' | 'desc'; kind?: 'asc' | 'desc' }>;
    };
    expect(arg.where.userId).toBe('user-1');
    expect(arg.where.date.gte).toBeInstanceOf(Date);
    expect(arg.orderBy).toEqual([{ date: 'desc' }, { kind: 'asc' }]);
  });

  it('clamps the window to [1, 90] days', async () => {
    vi.mocked(db.habitLog.findMany).mockResolvedValue([] as never);

    await listRecentHabitLogs('user-1', 0);
    await listRecentHabitLogs('user-1', 9999);

    const c0 = vi.mocked(db.habitLog.findMany).mock.calls[0];
    const c1 = vi.mocked(db.habitLog.findMany).mock.calls[1];
    if (!c0 || !c1) throw new Error('expected findMany calls');
    const a0 = c0[0] as { where: { date: { gte: Date } } };
    const a1 = c1[0] as { where: { date: { gte: Date } } };
    // 90-day window reaches further back than 1-day window.
    expect(a1.where.date.gte.getTime()).toBeLessThan(a0.where.date.gte.getTime());
  });
});

// ---------------------------------------------------------------------------
// listHabitLogsByKind
// ---------------------------------------------------------------------------

describe('listHabitLogsByKind', () => {
  it('filters by kind and hits the (userId, kind, date desc) index', async () => {
    vi.mocked(db.habitLog.findMany).mockResolvedValue([makeRow()] as never);
    await listHabitLogsByKind('user-1', 'caffeine', 7);

    const call = vi.mocked(db.habitLog.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as {
      where: { userId: string; kind: string; date: { gte: Date } };
      orderBy: { date: 'asc' | 'desc' };
    };
    expect(arg.where.userId).toBe('user-1');
    expect(arg.where.kind).toBe('caffeine');
    expect(arg.where.date.gte).toBeInstanceOf(Date);
    expect(arg.orderBy).toEqual({ date: 'desc' });
  });
});
