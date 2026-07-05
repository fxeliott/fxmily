import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    trade: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    trainingTrade: {
      groupBy: vi.fn(),
    },
    discrepancy: {
      groupBy: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import {
  getAttentionMemberIds,
  getMemberDirectoryStats,
  listMembersForAdmin,
} from './members-service';

function makeUser(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@fxmily.fr`,
    firstName: 'Alex',
    lastName: 'Trader',
    role: 'member',
    status: 'active',
    joinedAt: new Date('2026-05-01T10:00:00.000Z'),
    lastSeenAt: null,
    ...overrides,
  };
}

type FindManyArg = {
  where: { status: unknown; OR?: unknown[] };
  orderBy: Array<Record<string, string>>;
  take: number;
  cursor?: { id: string };
  skip?: number;
};

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// listMembersForAdmin — cursor pagination + case-insensitive search (S7).
// ---------------------------------------------------------------------------

describe('listMembersForAdmin (pagination + search)', () => {
  it('page 1, no query: non-deleted, [joinedAt desc, id desc], take=limit+1, no cursor', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([makeUser('u1')] as never);
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);

    const result = await listMembersForAdmin();

    const call = vi.mocked(db.user.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as FindManyArg;
    expect(arg.where).toEqual({ status: { not: 'deleted' } });
    expect(arg.where.OR).toBeUndefined();
    expect(arg.orderBy).toEqual([{ joinedAt: 'desc' }, { id: 'desc' }]);
    expect(arg.take).toBe(51);
    expect(arg).not.toHaveProperty('cursor');
    expect(arg).not.toHaveProperty('skip');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('u1');
    expect(result.items[0]?.tradesCount).toBe(0);
    expect(result.nextCursor).toBeNull();
  });

  it('builds a case-insensitive OR across firstName/lastName/email when query is set', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([] as never);

    await listMembersForAdmin({ query: '  Eli  ' });

    const arg = vi.mocked(db.user.findMany).mock.calls[0]?.[0] as FindManyArg;
    expect(arg.where.OR).toEqual([
      { firstName: { contains: 'Eli', mode: 'insensitive' } },
      { lastName: { contains: 'Eli', mode: 'insensitive' } },
      { email: { contains: 'Eli', mode: 'insensitive' } },
    ]);
  });

  it('applies cursor + skip:1 when a cursor is supplied', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([] as never);

    await listMembersForAdmin({ cursor: 'cur-1' });

    const arg = vi.mocked(db.user.findMany).mock.calls[0]?.[0] as FindManyArg;
    expect(arg.cursor).toEqual({ id: 'cur-1' });
    expect(arg.skip).toBe(1);
  });

  it('full page: 51 rows → 50 items + nextCursor = id of the 50th', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => makeUser(`u-${i}`));
    vi.mocked(db.user.findMany).mockResolvedValue(rows as never);
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);

    const result = await listMembersForAdmin({ limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('u-49');
  });

  it('boundary: exactly `limit` rows (no look-ahead row) → nextCursor null', async () => {
    // Guards the `hasMore = rows.length > limit` frontier (a `>=` typo would
    // wrongly emit a nextCursor here and loop the admin into an empty page).
    const rows = Array.from({ length: 50 }, (_, i) => makeUser(`u-${i}`));
    vi.mocked(db.user.findMany).mockResolvedValue(rows as never);
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);

    const result = await listMembersForAdmin({ limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBeNull();
  });

  it('clamps limit into [1, 50]', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([] as never);

    await listMembersForAdmin({ limit: 9999 });
    expect((vi.mocked(db.user.findMany).mock.calls[0]?.[0] as FindManyArg).take).toBe(51);

    vi.mocked(db.user.findMany).mockClear();
    await listMembersForAdmin({ limit: 0 });
    expect((vi.mocked(db.user.findMany).mock.calls[0]?.[0] as FindManyArg).take).toBe(2);
  });

  it('empty page short-circuits: no trade-count queries are issued', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([] as never);

    const result = await listMembersForAdmin({ query: 'nobody' });

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(db.trade.groupBy).not.toHaveBeenCalled();
  });

  it('maps open/closed counts onto the right member', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([makeUser('u1'), makeUser('u2')] as never);
    vi.mocked(db.trade.groupBy)
      .mockResolvedValueOnce([{ userId: 'u1', _count: { _all: 3 } }] as never) // open
      .mockResolvedValueOnce([{ userId: 'u1', _count: { _all: 7 } }] as never); // closed

    const result = await listMembersForAdmin();

    const u1 = result.items.find((m) => m.id === 'u1');
    const u2 = result.items.find((m) => m.id === 'u2');
    expect(u1).toMatchObject({ tradesOpenCount: 3, tradesClosedCount: 7, tradesCount: 10 });
    expect(u2).toMatchObject({ tradesOpenCount: 0, tradesClosedCount: 0, tradesCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// getMemberDirectoryStats — cohort-wide, bounded aggregates.
// ---------------------------------------------------------------------------

describe('getMemberDirectoryStats', () => {
  it('aggregates status counts + non-deleted trade total', async () => {
    vi.mocked(db.user.groupBy).mockResolvedValue([
      { status: 'active', _count: { _all: 5 } },
      { status: 'suspended', _count: { _all: 2 } },
    ] as never);
    vi.mocked(db.trade.count).mockResolvedValue(42 as never);

    const stats = await getMemberDirectoryStats();

    const gbArg = vi.mocked(db.user.groupBy).mock.calls[0]?.[0] as { where: unknown };
    expect(gbArg.where).toEqual({ status: { not: 'deleted' } });
    const countArg = vi.mocked(db.trade.count).mock.calls[0]?.[0] as { where: unknown };
    expect(countArg.where).toEqual({ user: { status: { not: 'deleted' } } });

    expect(stats).toEqual({ total: 7, active: 5, suspended: 2, totalTrades: 42 });
  });

  it('counts non-active/suspended statuses toward total only (not into a bucket)', async () => {
    vi.mocked(db.user.groupBy).mockResolvedValue([
      { status: 'active', _count: { _all: 3 } },
      { status: 'pending', _count: { _all: 1 } },
    ] as never);
    vi.mocked(db.trade.count).mockResolvedValue(0 as never);

    const stats = await getMemberDirectoryStats();
    expect(stats).toEqual({ total: 4, active: 3, suspended: 0, totalTrades: 0 });
  });
});

// ---------------------------------------------------------------------------
// getAttentionMemberIds — cohort-wide "à traiter" id set (Tour 13).
// ---------------------------------------------------------------------------

describe('getAttentionMemberIds', () => {
  it('unions uncommented real + training trades and open gaps into ONE id set', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([
      { userId: 'a', _count: { _all: 2 } },
      { userId: 'b', _count: { _all: 1 } },
    ] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([
      { userId: 'b', _count: { _all: 3 } }, // b appears in two sources → deduped
      { userId: 'c', _count: { _all: 1 } },
    ] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([
      { memberId: 'd', _count: { _all: 1 } },
    ] as never);

    const ids = await getAttentionMemberIds();

    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters real/training anti-joins on uncommented + recent + non-deleted', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);

    await getAttentionMemberIds();

    const tradeArg = vi.mocked(db.trade.groupBy).mock.calls[0]?.[0] as {
      where: { annotations: unknown; enteredAt: { gte: Date }; user: unknown };
    };
    expect(tradeArg.where.annotations).toEqual({ none: {} });
    expect(tradeArg.where.user).toEqual({ status: { not: 'deleted' } });
    expect(tradeArg.where.enteredAt.gte).toBeInstanceOf(Date);

    const gapArg = vi.mocked(db.discrepancy.groupBy).mock.calls[0]?.[0] as {
      where: { status: string; member: unknown };
    };
    expect(gapArg.where.status).toBe('open');
    expect(gapArg.where.member).toEqual({ status: { not: 'deleted' } });
  });

  it('returns an empty set when nothing is pending', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);

    expect((await getAttentionMemberIds()).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// listMembersForAdmin — attentionOnly triage filter (Tour 13).
// ---------------------------------------------------------------------------

describe('listMembersForAdmin (attentionOnly filter)', () => {
  it('feeds the flagged ids into the page WHERE as id: { in } and keeps the sort/cursor', async () => {
    vi.mocked(db.trade.groupBy)
      .mockResolvedValueOnce([{ userId: 'm1', _count: { _all: 1 } }] as never) // attention: real
      .mockResolvedValue([] as never); // later per-page open/closed counts
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([makeUser('m1')] as never);

    const result = await listMembersForAdmin({ attentionOnly: true });

    const arg = vi.mocked(db.user.findMany).mock.calls[0]?.[0] as FindManyArg & {
      where: { id?: { in: string[] } };
    };
    expect(arg.where.id).toEqual({ in: ['m1'] });
    expect(arg.orderBy).toEqual([{ joinedAt: 'desc' }, { id: 'desc' }]);
    expect(result.items).toHaveLength(1);
  });

  it('short-circuits to an empty page (no users query) when nobody needs attention', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);

    const result = await listMembersForAdmin({ attentionOnly: true });

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('does NOT add an id filter when attentionOnly is off', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([makeUser('u1')] as never);
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);

    await listMembersForAdmin({});

    const arg = vi.mocked(db.user.findMany).mock.calls[0]?.[0] as FindManyArg & {
      where: { id?: unknown };
    };
    expect(arg.where.id).toBeUndefined();
    expect(db.trainingTrade.groupBy).not.toHaveBeenCalled();
  });
});
