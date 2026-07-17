import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    habitLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';

import {
  getHabitLogById,
  listHabitLogsByKind,
  listRecentHabitLogs,
  projectHabitLogFromCheckin,
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
  // Freeze system clock to a date that keeps the hardcoded fixtures
  // (sleepInput=2026-05-13, sportInput=2026-05-14) within the schema's
  // 14-day-back civil window. Without this, the assertions silently age
  // out after 14 days from the fixture commit date and the suite goes
  // red on every PR (detected 2026-05-28 during V2.4 Phase A.2 gates).
  // Carbone pattern J5 timezone tests + V1.5 mindset wizard fakeTimers.
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-05-14T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('upserts on the (userId, date, kind) composite unique key', async () => {
    vi.mocked(db.habitLog.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.habitLog.upsert).mockResolvedValue(makeRow() as never);

    const result = await upsertHabitLog('user-1', sleepInput);

    expect(db.habitLog.upsert).toHaveBeenCalledOnce();
    const call = vi.mocked(db.habitLog.upsert).mock.calls[0];
    if (!call) throw new Error('expected upsert to be called');
    const arg = call[0] as {
      where: { userId_date_kind: { userId: string; date: Date; kind: string } };
      create: { kind: string; source: string };
      update: { source: string };
    };
    expect(arg.where.userId_date_kind.userId).toBe('user-1');
    expect(arg.where.userId_date_kind.kind).toBe('sleep');
    expect(arg.where.userId_date_kind.date.toISOString().slice(0, 10)).toBe('2026-05-13');
    // A TRACK write is member-authored: both branches stamp `member_track` so a
    // later check-in projection can never clobber the member's own entry (J5.2).
    expect(arg.create.source).toBe('member_track');
    expect(arg.update.source).toBe('member_track');
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
// projectHabitLogFromCheckin (J5.2 provenance — refresh-own, never a member row)
// ---------------------------------------------------------------------------

describe('projectHabitLogFromCheckin', () => {
  // Same civil-window freeze as upsertHabitLog: sleepInput is dated 2026-05-13,
  // so pin "now" to 2026-05-14 to keep it inside the schema's back window.
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-05-14T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a checkin_morning row when the slot is empty', async () => {
    vi.mocked(db.habitLog.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.habitLog.create).mockResolvedValue(makeRow() as never);

    const result = await projectHabitLogFromCheckin('user-1', sleepInput);

    expect(result.outcome).toBe('created');
    // The source-scoped refresh runs first and matches nothing (empty slot).
    expect(db.habitLog.updateMany).toHaveBeenCalledOnce();
    const upd = vi.mocked(db.habitLog.updateMany).mock.calls[0]?.[0] as {
      where: { source: string };
    };
    expect(upd.where.source).toBe('checkin_morning');
    // Then a create stamps the full projected payload with checkin_morning
    // provenance — value + notes must persist (they feed the AI digest).
    expect(db.habitLog.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(db.habitLog.create).mock.calls[0]?.[0] as {
      data: { source: string; value: unknown; notes: string | null };
    };
    expect(arg.data.source).toBe('checkin_morning');
    expect(arg.data.value).toEqual(sleepInput.value);
    expect(arg.data.notes).toBe(sleepInput.notes);
    expect(db.habitLog.update).not.toHaveBeenCalled();
  });

  it('refreshes its OWN prior projection in place, without re-stamping source', async () => {
    // A checkin_morning row already exists → the source-scoped updateMany
    // matches it (count 1) → refreshed, no create.
    vi.mocked(db.habitLog.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await projectHabitLogFromCheckin('user-1', sleepInput);

    expect(result.outcome).toBe('refreshed');
    expect(db.habitLog.updateMany).toHaveBeenCalledOnce();
    expect(db.habitLog.create).not.toHaveBeenCalled();
    const arg = vi.mocked(db.habitLog.updateMany).mock.calls[0]?.[0] as {
      where: { source: string };
      data: Record<string, unknown>;
    };
    // Ownership predicate is atomic — the WHERE is scoped to checkin_morning, so
    // a member row promoted mid-flight would match 0 and be left untouched.
    expect(arg.where.source).toBe('checkin_morning');
    // Refresh the value/notes the digest reads, but do NOT re-stamp source: the
    // row stays a projection so a future member TRACK edit can still promote it.
    expect(arg.data.value).toEqual(sleepInput.value);
    expect(arg.data.notes).toBe(sleepInput.notes);
    expect('source' in arg.data).toBe(false);
  });

  it('never overwrites a pre-existing member-owned row (member_track / legacy null → skipped)', async () => {
    // The slot holds a row we did NOT project (a member_track TRACK entry, or a
    // legacy null-source row): the source-scoped updateMany matches 0, the
    // create collides on the unique key (P2002), and the source-scoped rescue
    // still matches 0 → skipped, with the member's row untouched. Fill-only.
    vi.mocked(db.habitLog.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.habitLog.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await projectHabitLogFromCheckin('user-1', sleepInput);

    expect(result.outcome).toBe('skipped');
    expect(db.habitLog.create).toHaveBeenCalledOnce();
    // Two source-scoped updateMany calls (initial refresh + P2002 rescue), both
    // matching 0 — never a bare update that could clobber the member row.
    expect(db.habitLog.updateMany).toHaveBeenCalledTimes(2);
    expect(db.habitLog.update).not.toHaveBeenCalled();
  });

  it('rescues a lost create race by refreshing the concurrent projection (P2002 → refreshed)', async () => {
    // Slot empty at first (updateMany count 0) → create races a concurrent
    // projection and loses (P2002) → the rescue updateMany now matches the row
    // the winner just projected (count 1) → refreshed with our newer value,
    // rather than silently dropping it.
    vi.mocked(db.habitLog.updateMany)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(db.habitLog.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await projectHabitLogFromCheckin('user-1', sleepInput);

    expect(result.outcome).toBe('refreshed');
    expect(db.habitLog.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-P2002 database error', async () => {
    vi.mocked(db.habitLog.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.habitLog.create).mockRejectedValue(new Error('pool exhausted'));

    await expect(projectHabitLogFromCheckin('user-1', sleepInput)).rejects.toThrow(
      'pool exhausted',
    );
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
