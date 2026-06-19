import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trainingTrade: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { Prisma } from '@/generated/prisma/client';

import { db } from '@/lib/db';

import {
  countTrainingTradesAsAdmin,
  listTrainingTradesAsAdmin,
} from './training-trade-admin-service';

function makeRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: 'member-1',
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

type FindManyArg = {
  where: { userId: string };
  orderBy: Array<Record<string, string>>;
  take: number;
  cursor?: { id: string };
  skip?: number;
};

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// listTrainingTradesAsAdmin — cursor pagination (S7 parity with real trades).
// Pins the query shape so a future edit can't silently drop the look-ahead or
// the id tiebreaker (which would skip/duplicate rows near colliding enteredAt).
// ---------------------------------------------------------------------------

describe('listTrainingTradesAsAdmin (cursor pagination, S7 parity)', () => {
  it('page 1: member-scoped, take=limit+1, [enteredAt desc, id desc], no cursor/skip', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([makeRow('a')] as never);

    const result = await listTrainingTradesAsAdmin('member-1');

    const call = vi.mocked(db.trainingTrade.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as FindManyArg;
    expect(arg.where).toEqual({ userId: 'member-1' });
    expect(arg.orderBy).toEqual([{ enteredAt: 'desc' }, { id: 'desc' }]);
    expect(arg.take).toBe(51);
    expect(arg).not.toHaveProperty('cursor');
    expect(arg).not.toHaveProperty('skip');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.userId).toBe('member-1');
    expect(result.nextCursor).toBeNull();
  });

  it('full page: 51 rows looked-ahead → 50 items + nextCursor = id of the 50th', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => makeRow(`t-${i}`));
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue(rows as never);

    const result = await listTrainingTradesAsAdmin('member-1', { limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('t-49');
  });

  it('applies cursor + skip:1 when a cursor is supplied', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);

    await listTrainingTradesAsAdmin('member-1', { cursor: 'cur-1' });

    const arg = vi.mocked(db.trainingTrade.findMany).mock.calls[0]?.[0] as FindManyArg;
    expect(arg.cursor).toEqual({ id: 'cur-1' });
    expect(arg.skip).toBe(1);
  });

  it('clamps limit into [1, 50]', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);

    await listTrainingTradesAsAdmin('member-1', { limit: 9999 });
    expect((vi.mocked(db.trainingTrade.findMany).mock.calls[0]?.[0] as FindManyArg).take).toBe(51);

    vi.mocked(db.trainingTrade.findMany).mockClear();
    await listTrainingTradesAsAdmin('member-1', { limit: 0 });
    expect((vi.mocked(db.trainingTrade.findMany).mock.calls[0]?.[0] as FindManyArg).take).toBe(2);
  });

  it('last page: fewer than limit rows → nextCursor null', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([makeRow('a'), makeRow('b')] as never);

    const result = await listTrainingTradesAsAdmin('member-1', { limit: 50 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// countTrainingTradesAsAdmin — §21.5 count-only (no select projection).
// ---------------------------------------------------------------------------

describe('countTrainingTradesAsAdmin', () => {
  it('counts member-scoped backtests with no select projection (§21.5)', async () => {
    vi.mocked(db.trainingTrade.count).mockResolvedValue(42 as never);

    const total = await countTrainingTradesAsAdmin('member-1');

    const arg = vi.mocked(db.trainingTrade.count).mock.calls[0]?.[0] as {
      where: { userId: string };
    };
    expect(arg.where).toEqual({ userId: 'member-1' });
    expect(arg).not.toHaveProperty('select');
    expect(total).toBe(42);
  });
});
