import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trainingTrade: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

import { Prisma } from '@/generated/prisma/client';

import { db } from '@/lib/db';

import {
  type CreateTrainingTradeInput,
  countRecentTrainingActivity,
  createTrainingTrade,
  getTrainingTradeById,
  getTrainingTradeStatsForUser,
  listTrainingTradesForUser,
} from './training-trade-service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tt-1',
    userId: 'user-1',
    pair: 'EURUSD',
    entryScreenshotKey: 'training/abcdefgh12345678/abcdefghijkl1234.jpg',
    plannedRR: new Prisma.Decimal('2.5'),
    outcome: 'win',
    resultR: new Prisma.Decimal('1.8'),
    systemRespected: true,
    lessonLearned: 'Entrée patiente sur retest.',
    enteredAt: new Date('2026-05-10T10:00:00.000Z'),
    createdAt: new Date('2026-05-17T09:00:00.000Z'),
    updatedAt: new Date('2026-05-17T09:00:00.000Z'),
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateTrainingTradeInput> = {}): CreateTrainingTradeInput {
  return {
    userId: 'user-1',
    pair: 'EURUSD',
    entryScreenshotKey: 'training/abcdefgh12345678/abcdefghijkl1234.jpg',
    plannedRR: 2.5,
    outcome: 'win',
    resultR: 1.8,
    systemRespected: true,
    lessonLearned: 'Entrée patiente sur retest.',
    enteredAt: new Date('2026-05-10T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// createTrainingTrade
// ---------------------------------------------------------------------------

describe('createTrainingTrade', () => {
  it('inserts the mapped data and serializes Decimal→string + Date→ISO', async () => {
    vi.mocked(db.trainingTrade.create).mockResolvedValue(makeRow() as never);

    const result = await createTrainingTrade(makeInput());

    const call = vi.mocked(db.trainingTrade.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as {
      data: {
        userId: string;
        pair: string;
        entryScreenshotKey: string;
        plannedRR: { toString(): string };
        outcome: string | null;
        resultR: { toString(): string } | null;
        systemRespected: boolean | null;
        lessonLearned: string;
        enteredAt: Date;
      };
    };
    expect(arg.data.userId).toBe('user-1');
    expect(arg.data.pair).toBe('EURUSD');
    expect(arg.data.entryScreenshotKey).toBe('training/abcdefgh12345678/abcdefghijkl1234.jpg');
    expect(arg.data.plannedRR.toString()).toBe('2.5');
    expect(arg.data.outcome).toBe('win');
    expect(arg.data.resultR?.toString()).toBe('1.8');
    expect(arg.data.systemRespected).toBe(true);
    expect(arg.data.lessonLearned).toBe('Entrée patiente sur retest.');
    expect(arg.data.enteredAt).toEqual(new Date('2026-05-10T10:00:00.000Z'));

    expect(result.id).toBe('tt-1');
    expect(result.plannedRR).toBe('2.5');
    expect(result.resultR).toBe('1.8');
    expect(result.enteredAt).toBe('2026-05-10T10:00:00.000Z');
    expect(result.createdAt).toBe('2026-05-17T09:00:00.000Z');
  });

  it('persists a null outcome / resultR and serializes them to null', async () => {
    vi.mocked(db.trainingTrade.create).mockResolvedValue(
      makeRow({ outcome: null, resultR: null }) as never,
    );

    const result = await createTrainingTrade(makeInput({ outcome: null, resultR: null }));

    const call = vi.mocked(db.trainingTrade.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as { data: { outcome: string | null; resultR: unknown } };
    expect(arg.data.outcome).toBe(null);
    expect(arg.data.resultR).toBe(null);
    expect(result.outcome).toBe(null);
    expect(result.resultR).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// listTrainingTradesForUser
// ---------------------------------------------------------------------------

describe('listTrainingTradesForUser (cursor-paginated)', () => {
  it('queries user-scoped, newest-first with an id tiebreaker, take=limit+1, no cursor on page 1', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([makeRow()] as never);

    const result = await listTrainingTradesForUser('user-1', { limit: 50 });

    const call = vi.mocked(db.trainingTrade.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as {
      where: { userId: string };
      orderBy: Array<Record<string, string>>;
      take: number;
    };
    expect(arg.where).toEqual({ userId: 'user-1' });
    expect(arg.orderBy).toEqual([{ enteredAt: 'desc' }, { id: 'desc' }]);
    expect(arg.take).toBe(51);
    expect(arg).not.toHaveProperty('cursor');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.userId).toBe('user-1');
    expect(result.items[0]?.plannedRR).toBe('2.5');
    expect(result.nextCursor).toBeNull();
  });

  it('defaults limit to 20 and clamps to [1, 50] (take = clamped + 1)', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
    await listTrainingTradesForUser('user-1'); // default 20
    await listTrainingTradesForUser('user-1', { limit: 999 }); // clamp 50
    await listTrainingTradesForUser('user-1', { limit: 0 }); // clamp 1
    const calls = vi.mocked(db.trainingTrade.findMany).mock.calls;
    expect((calls[0]![0] as { take: number }).take).toBe(21);
    expect((calls[1]![0] as { take: number }).take).toBe(51);
    expect((calls[2]![0] as { take: number }).take).toBe(2);
  });

  it('sets nextCursor to the last kept id and trims the extra probe row', async () => {
    // limit 2, DB returns 3 (take=3) → hasMore, drop the 3rd, cursor = 2nd id.
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([
      makeRow({ id: 'a' }),
      makeRow({ id: 'b' }),
      makeRow({ id: 'c' }),
    ] as never);

    const result = await listTrainingTradesForUser('user-1', { limit: 2 });
    expect(result.items.map((t) => t.id)).toEqual(['a', 'b']);
    expect(result.nextCursor).toBe('b');
  });

  it('forwards a cursor with skip:1 (the cursor row is excluded from the page)', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
    await listTrainingTradesForUser('user-1', { limit: 50, cursor: 'cur-1' });
    const arg = vi.mocked(db.trainingTrade.findMany).mock.calls[0]![0] as {
      cursor: { id: string };
      skip: number;
    };
    expect(arg.cursor).toEqual({ id: 'cur-1' });
    expect(arg.skip).toBe(1);
  });

  it('returns empty items + null cursor when the user has no backtests', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
    expect(await listTrainingTradesForUser('user-1')).toEqual({ items: [], nextCursor: null });
  });
});

// ---------------------------------------------------------------------------
// getTrainingTradeStatsForUser — §21.5 TRAINING-ONLY full-history aggregate
//
// The /training stats bar reads these SQL aggregates so the figures stay exact
// once the list is paginated. resultR/outcome are read ONLY for the member's
// own practice stats (already surfaced on /training) — never a real-edge channel.
// ---------------------------------------------------------------------------

describe('getTrainingTradeStatsForUser (§21.5 training-only aggregate)', () => {
  it('derives stats from count + groupBy(outcome) + groupBy(system) + avg(resultR), user-scoped', async () => {
    vi.mocked(db.trainingTrade.count).mockResolvedValue(10 as never);
    vi.mocked(db.trainingTrade.groupBy)
      .mockResolvedValueOnce([
        { outcome: 'win', _count: { _all: 4 } },
        { outcome: 'loss', _count: { _all: 3 } },
        { outcome: null, _count: { _all: 3 } },
      ] as never)
      .mockResolvedValueOnce([
        { systemRespected: true, _count: { _all: 5 } },
        { systemRespected: false, _count: { _all: 2 } },
        { systemRespected: null, _count: { _all: 3 } },
      ] as never);
    vi.mocked(db.trainingTrade.aggregate).mockResolvedValue({
      _avg: { resultR: new Prisma.Decimal('0.5') },
      _count: { resultR: 6 },
    } as never);

    const stats = await getTrainingTradeStatsForUser('user-1');

    expect(stats).toEqual({
      total: 10,
      decidedCount: 7,
      winCount: 4,
      withRCount: 6,
      avgR: 0.5,
      systemDecidedCount: 7,
      systemKeptCount: 5,
    });

    // §21.5 — every read is user-scoped on db.trainingTrade; the avg only ever
    // targets resultR for the member's own training surface.
    expect(vi.mocked(db.trainingTrade.count).mock.calls[0]![0]).toEqual({
      where: { userId: 'user-1' },
    });
    const aggArg = vi.mocked(db.trainingTrade.aggregate).mock.calls[0]![0] as {
      where: { userId: string; resultR: unknown };
      _avg: Record<string, boolean>;
    };
    expect(aggArg.where.userId).toBe('user-1');
    expect(aggArg._avg).toEqual({ resultR: true });
  });

  it('returns null avgR and zeroed rates when there is no decided backtest', async () => {
    vi.mocked(db.trainingTrade.count).mockResolvedValue(0 as never);
    vi.mocked(db.trainingTrade.groupBy)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(db.trainingTrade.aggregate).mockResolvedValue({
      _avg: { resultR: null },
      _count: { resultR: 0 },
    } as never);

    const stats = await getTrainingTradeStatsForUser('user-1');
    expect(stats).toEqual({
      total: 0,
      decidedCount: 0,
      winCount: 0,
      withRCount: 0,
      avgR: null,
      systemDecidedCount: 0,
      systemKeptCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// getTrainingTradeById (member-scoped ownership via a single findFirst)
// ---------------------------------------------------------------------------

describe('getTrainingTradeById', () => {
  it('scopes the query by id AND userId in a single query', async () => {
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue(makeRow() as never);

    const result = await getTrainingTradeById('tt-1', 'user-1');

    const call = vi.mocked(db.trainingTrade.findFirst).mock.calls[0];
    if (!call) throw new Error('expected findFirst to be called');
    const arg = call[0] as { where: { id: string; userId: string } };
    expect(arg.where).toEqual({ id: 'tt-1', userId: 'user-1' });
    expect(result?.id).toBe('tt-1');
  });

  it('returns null when absent or not owned', async () => {
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue(null as never);
    expect(await getTrainingTradeById('nope', 'user-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// countRecentTrainingActivity — SPEC §21.5 count-only isolation primitive
//
// This is the SINGLE sanctioned channel by which training (backtest) data
// reaches a real-edge surface. These tests pin the query shape so a future
// edit cannot silently widen the SELECT to a P&L column.
// ---------------------------------------------------------------------------

describe('countRecentTrainingActivity (§21.5 count-only primitive)', () => {
  const FROM = new Date('2026-04-17T00:00:00.000Z');
  const TO = new Date('2026-05-17T00:00:00.000Z');

  it('counts in [fromUtc, ∞) and returns the all-time most recent enteredAt', async () => {
    vi.mocked(db.trainingTrade.count).mockResolvedValue(3 as never);
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue({
      enteredAt: new Date('2026-05-10T10:00:00.000Z'),
    } as never);

    const result = await countRecentTrainingActivity('user-1', FROM);

    const countCall = vi.mocked(db.trainingTrade.count).mock.calls[0];
    if (!countCall) throw new Error('expected count to be called');
    const countArg = countCall[0] as {
      where: { userId: string; enteredAt: Record<string, unknown> };
    };
    expect(countArg.where.userId).toBe('user-1');
    expect(countArg.where.enteredAt).toEqual({ gte: FROM });
    // 🚨 §21.5 — count() must be a pure COUNT(*): no `select` projection.
    expect(countArg).not.toHaveProperty('select');

    const ffCall = vi.mocked(db.trainingTrade.findFirst).mock.calls[0];
    if (!ffCall) throw new Error('expected findFirst to be called');
    const ffArg = ffCall[0] as {
      where: { userId: string };
      orderBy: unknown;
      select: Record<string, unknown>;
    };
    expect(ffArg.where).toEqual({ userId: 'user-1' });
    expect(ffArg.orderBy).toEqual({ enteredAt: 'desc' });
    // 🚨 §21.5 — recency SELECT is EXACTLY { enteredAt: true }. Zero P&L.
    expect(Object.keys(ffArg.select).sort()).toEqual(['enteredAt']);
    expect(ffArg.select).not.toHaveProperty('resultR');
    expect(ffArg.select).not.toHaveProperty('outcome');
    expect(ffArg.select).not.toHaveProperty('plannedRR');

    expect(result).toEqual({ count: 3, lastEnteredAt: '2026-05-10T10:00:00.000Z' });
  });

  it('adds an inclusive lte bound when toUtc is given', async () => {
    vi.mocked(db.trainingTrade.count).mockResolvedValue(1 as never);
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue(null as never);

    await countRecentTrainingActivity('user-1', FROM, TO);

    const countCall = vi.mocked(db.trainingTrade.count).mock.calls[0];
    if (!countCall) throw new Error('expected count to be called');
    const countArg = countCall[0] as { where: { enteredAt: Record<string, unknown> } };
    expect(countArg.where.enteredAt).toEqual({ gte: FROM, lte: TO });
  });

  it('returns lastEnteredAt=null when the member never backtested', async () => {
    vi.mocked(db.trainingTrade.count).mockResolvedValue(0 as never);
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue(null as never);

    const result = await countRecentTrainingActivity('user-1', FROM);
    expect(result).toEqual({ count: 0, lastEnteredAt: null });
  });

  it('§21.5 — never calls findMany (which would return every column incl. P&L)', async () => {
    vi.mocked(db.trainingTrade.count).mockResolvedValue(0 as never);
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue(null as never);

    await countRecentTrainingActivity('user-1', FROM);

    expect(db.trainingTrade.findMany).not.toHaveBeenCalled();
  });
});
