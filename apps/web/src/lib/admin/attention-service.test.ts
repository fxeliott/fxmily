import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trade: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    trainingTrade: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    discrepancy: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    constancyScore: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import {
  getCohortAttention,
  getMembersAttention,
  getTriageQueueCounts,
  listOpenDiscrepancies,
  listStaleOpenTrades,
  listUncommentedClosedTrades,
  STALE_OPEN_TRADE_HOURS,
  TRIAGE_PAGE_SIZE,
} from './attention-service';

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

describe('getMembersAttention', () => {
  it('returns an empty map and hits no DB when given no ids', async () => {
    const map = await getMembersAttention([]);
    expect(map.size).toBe(0);
    expect(db.trade.groupBy).not.toHaveBeenCalled();
    expect(db.discrepancy.groupBy).not.toHaveBeenCalled();
  });

  it('aggregates uncommented trades, open gaps and a constancy dip per member', async () => {
    // RC#7 PERF-2 — uncommented counts now come from groupBy/_count (one row
    // per member) instead of findMany returning one row per trade.
    vi.mocked(db.trade.groupBy).mockResolvedValue([{ userId: 'm1', _count: { _all: 2 } }] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([
      { userId: 'm2', _count: { _all: 1 } },
    ] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([
      { memberId: 'm1', _count: { _all: 3 } },
    ] as never);
    // DESC order → first row per member is the LATEST snapshot. 70 then 72 ⇒ a
    // 2-point drop ⇒ dip flagged.
    vi.mocked(db.constancyScore.findMany).mockResolvedValue([
      { memberId: 'm1', value: 70 },
      { memberId: 'm1', value: 72 },
    ] as never);

    const map = await getMembersAttention(['m1', 'm2']);

    expect(map.get('m1')).toEqual({
      tradesToComment: 2,
      openDiscrepancies: 3,
      constancyDeclining: true,
    });
    // m2 only has one uncommented training trade; everything else is zeroed.
    expect(map.get('m2')).toEqual({
      tradesToComment: 1,
      openDiscrepancies: 0,
      constancyDeclining: false,
    });
  });

  it('does not flag a dip when the latest snapshot rose or held', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.constancyScore.findMany).mockResolvedValue([
      { memberId: 'm1', value: 80 }, // latest
      { memberId: 'm1', value: 72 }, // previous → rose, no dip
    ] as never);

    const map = await getMembersAttention(['m1']);
    expect(map.get('m1')).toEqual({
      tradesToComment: 0,
      openDiscrepancies: 0,
      constancyDeclining: false,
    });
  });

  it('compares only the latest vs the immediately-previous snapshot, ignoring older peaks', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    // DESC: latest 70, previous 70.5 (0.5 drop < MIN → no dip), older peak 85.
    // The 15-point gap latest↔peak must NOT raise the signal — the dip is defined
    // strictly vs the previous snapshot. Regression guard for the ≥3-snapshot case.
    vi.mocked(db.constancyScore.findMany).mockResolvedValue([
      { memberId: 'm1', value: 70 },
      { memberId: 'm1', value: 70.5 },
      { memberId: 'm1', value: 85 },
    ] as never);

    const map = await getMembersAttention(['m1']);
    expect(map.get('m1')?.constancyDeclining).toBe(false);
  });

  it('flags a dip vs the previous snapshot even when an older snapshot was lower', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    // DESC: latest 60, previous 75 (15 drop ≥ MIN → dip), older 50 (irrelevant).
    vi.mocked(db.constancyScore.findMany).mockResolvedValue([
      { memberId: 'm1', value: 60 },
      { memberId: 'm1', value: 75 },
      { memberId: 'm1', value: 50 },
    ] as never);

    const map = await getMembersAttention(['m1']);
    expect(map.get('m1')?.constancyDeclining).toBe(true);
  });

  it('reads ONE snapshot without flagging a dip (nothing to compare against)', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    // A brand-new member with a single constancy snapshot: the loop records it as
    // the latest but has no previous to compare → the dip stays false. Guards the
    // `latest === undefined` first branch in isolation.
    vi.mocked(db.constancyScore.findMany).mockResolvedValue([
      { memberId: 'm1', value: 70 },
    ] as never);

    const map = await getMembersAttention(['m1']);
    expect(map.get('m1')?.constancyDeclining).toBe(false);
  });

  it('scopes every read to the requested ids and the right filters', async () => {
    vi.mocked(db.trade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.constancyScore.findMany).mockResolvedValue([] as never);

    await getMembersAttention(['m1', 'm2']);

    // RC#7 PERF-2 — the uncommented count is a groupBy(['userId'])/_count, not a
    // findMany returning a row per trade. Pin the aggregate shape AND the filter.
    const tradeArg = firstArg(db.trade.groupBy);
    expect(tradeArg.by).toEqual(['userId']);
    expect(tradeArg._count).toEqual({ _all: true });
    const tradeWhere = tradeArg.where as Record<string, unknown>;
    expect(tradeWhere.userId).toEqual({ in: ['m1', 'm2'] });
    expect(tradeWhere.annotations).toEqual({ none: {} });
    expect((tradeWhere.enteredAt as { gte: unknown }).gte).toBeInstanceOf(Date);

    const discWhere = firstArg(db.discrepancy.groupBy).where as Record<string, unknown>;
    expect(discWhere).toMatchObject({ memberId: { in: ['m1', 'm2'] }, status: 'open' });

    // FIND-3 (re-challenge #2) — the in-memory "first row per member = latest,
    // second = previous" dip logic is ONLY correct if the query is ordered
    // memberId ASC then periodStart DESC. The dip tests hand-feed pre-sorted
    // arrays, so they'd stay green even if this orderBy were dropped — pin it
    // here so the false-green can't hide a real prod regression.
    const constancyArg = firstArg(db.constancyScore.findMany);
    expect(constancyArg.where).toMatchObject({ memberId: { in: ['m1', 'm2'] } });
    expect(
      (constancyArg.where as { periodStart: { gte: unknown } }).periodStart.gte,
    ).toBeInstanceOf(Date);
    expect(constancyArg.orderBy).toEqual([{ memberId: 'asc' }, { periodStart: 'desc' }]);
  });
});

describe('getCohortAttention', () => {
  it('sums real + training uncommented trades and counts open gaps, excluding deleted users', async () => {
    vi.mocked(db.trade.count).mockResolvedValue(5 as never);
    vi.mocked(db.trainingTrade.count).mockResolvedValue(2 as never);
    vi.mocked(db.discrepancy.count).mockResolvedValue(4 as never);

    const result = await getCohortAttention();

    expect(result).toEqual({ tradesToComment: 7, openDiscrepancies: 4 });

    const tradeWhere = firstArg(db.trade.count).where as Record<string, unknown>;
    expect(tradeWhere.annotations).toEqual({ none: {} });
    expect(tradeWhere.user).toEqual({ status: { not: 'deleted' } });

    const discWhere = firstArg(db.discrepancy.count).where as Record<string, unknown>;
    expect(discWhere).toMatchObject({ status: 'open' });
  });
});

// ---------------------------------------------------------------------------
// Tour 13 — « À traiter » cohort work-queue loaders.
// ---------------------------------------------------------------------------

/** A closed-trade row as the loader selects it (thin member join). */
function tradeRow(
  id: string,
  over: Partial<{
    pair: string;
    direction: 'long' | 'short';
    closedAt: Date | null;
    enteredAt: Date;
    realizedR: string | null;
    user: { id: string; firstName: string | null; lastName: string | null; email: string };
  }> = {},
) {
  return {
    id,
    pair: over.pair ?? 'EURUSD',
    direction: over.direction ?? 'long',
    closedAt: over.closedAt ?? new Date('2026-01-01T10:00:00Z'),
    enteredAt: over.enteredAt ?? new Date('2026-01-01T08:00:00Z'),
    // `?? ` would swallow an intentional `null` — key presence decides instead.
    realizedR: 'realizedR' in over ? over.realizedR : '1.50',
    user: over.user ?? { id: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.io' },
  };
}

describe('listUncommentedClosedTrades', () => {
  it('lists a closed uncommented trade with a direct review link + member label', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([tradeRow('t1')] as never);

    const { items, nextCursor } = await listUncommentedClosedTrades();

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: 't1',
      memberId: 'u1',
      memberLabel: 'Jean Dupont',
      pair: 'EURUSD',
      direction: 'long',
      closedAt: '2026-01-01T10:00:00.000Z',
      realizedR: 1.5,
      href: '/admin/members/u1/trades/t1',
    });
    expect(nextCursor).toBeNull();
  });

  it('excludes annotated trades and open trades via the query filter', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);

    await listUncommentedClosedTrades();

    const where = firstArg(db.trade.findMany).where as Record<string, unknown>;
    // The "annotated → excluded" and "still open → excluded" guarantees live in
    // the WHERE clause (mocked DB can't run it), so pin the clause itself.
    expect(where.annotations).toEqual({ none: {} });
    expect(where.closedAt).toEqual({ not: null });
    expect(where.user).toEqual({ status: { not: 'deleted' } });
  });

  it('orders oldest close first with an id tiebreaker', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    await listUncommentedClosedTrades();
    expect(firstArg(db.trade.findMany).orderBy).toEqual([{ closedAt: 'asc' }, { id: 'asc' }]);
  });

  it('emits a nextCursor and trims the look-ahead row when a full page + 1 comes back', async () => {
    // limit+1 rows returned → hasMore, page trimmed to `limit`, cursor = last id.
    const rows = Array.from({ length: TRIAGE_PAGE_SIZE + 1 }, (_, i) => tradeRow(`t${i}`));
    vi.mocked(db.trade.findMany).mockResolvedValue(rows as never);

    const { items, nextCursor } = await listUncommentedClosedTrades();

    expect(items).toHaveLength(TRIAGE_PAGE_SIZE);
    expect(nextCursor).toBe(`t${TRIAGE_PAGE_SIZE - 1}`);
    expect(firstArg(db.trade.findMany).take).toBe(TRIAGE_PAGE_SIZE + 1);
  });

  it('applies a valid cursor as a skip-1 seek and ignores a forged one', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);

    const validCursor = 'a'.repeat(25);
    await listUncommentedClosedTrades({ cursor: validCursor });
    expect(firstArg(db.trade.findMany)).toMatchObject({
      cursor: { id: validCursor },
      skip: 1,
    });

    vi.mocked(db.trade.findMany).mockClear();
    await listUncommentedClosedTrades({ cursor: 'not-a-cuid!' });
    const arg = firstArg(db.trade.findMany);
    expect(arg.cursor).toBeUndefined();
    expect(arg.skip).toBeUndefined();
  });

  it('falls back to the email when the member has no name', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([
      tradeRow('t1', { user: { id: 'u9', firstName: null, lastName: null, email: 'anon@x.io' } }),
    ] as never);

    const { items } = await listUncommentedClosedTrades();
    expect(items[0]?.memberLabel).toBe('anon@x.io');
  });

  it('carries a null realizedR through untouched', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([tradeRow('t1', { realizedR: null })] as never);
    const { items } = await listUncommentedClosedTrades();
    expect(items[0]?.realizedR).toBeNull();
  });
});

describe('listStaleOpenTrades', () => {
  it('filters to open trades older than the stale window and orders oldest entry first', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);

    const before = Date.now();
    await listStaleOpenTrades();
    const after = Date.now();

    const arg = firstArg(db.trade.findMany);
    const where = arg.where as Record<string, unknown>;
    expect(where.closedAt).toBeNull();
    expect(where.user).toEqual({ status: { not: 'deleted' } });

    // The `enteredAt < now - 72h` floor: verify it lands in the expected window
    // rather than hard-coding a clock the test can't control.
    const floor = (where.enteredAt as { lt: Date }).lt;
    expect(floor).toBeInstanceOf(Date);
    const windowMs = STALE_OPEN_TRADE_HOURS * 60 * 60 * 1000;
    expect(floor.getTime()).toBeGreaterThanOrEqual(before - windowMs);
    expect(floor.getTime()).toBeLessThanOrEqual(after - windowMs);

    expect(arg.orderBy).toEqual([{ enteredAt: 'asc' }, { id: 'asc' }]);
  });

  it('maps a stale open trade to a review link (no realizedR, it is still open)', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([
      tradeRow('t7', {
        closedAt: null,
        enteredAt: new Date('2026-01-01T08:00:00Z'),
        user: { id: 'u2', firstName: 'Ada', lastName: null, email: 'a@x.io' },
      }),
    ] as never);

    const { items } = await listStaleOpenTrades();
    expect(items[0]).toEqual({
      id: 't7',
      memberId: 'u2',
      memberLabel: 'Ada',
      pair: 'EURUSD',
      direction: 'long',
      enteredAt: '2026-01-01T08:00:00.000Z',
      href: '/admin/members/u2/trades/t7',
    });
  });
});

describe('listOpenDiscrepancies', () => {
  function discRow(
    id: string,
    over: Partial<{
      type: string;
      severity: number;
      detectedAt: Date;
      member: { id: string; firstName: string | null; lastName: string | null; email: string };
    }> = {},
  ) {
    return {
      id,
      type: over.type ?? 'missing_declared',
      severity: over.severity ?? 2,
      detectedAt: over.detectedAt ?? new Date('2026-02-01T00:00:00Z'),
      member: over.member ?? { id: 'm1', firstName: 'Zoe', lastName: 'Martin', email: 'z@x.io' },
    };
  }

  it('lists an open gap with a §2-clean label + a link to the verification tab', async () => {
    vi.mocked(db.discrepancy.findMany).mockResolvedValue([discRow('d1')] as never);

    const { items } = await listOpenDiscrepancies();
    expect(items[0]).toEqual({
      id: 'd1',
      memberId: 'm1',
      memberLabel: 'Zoe Martin',
      label: 'Position réelle non déclarée',
      severity: 2,
      detectedAt: '2026-02-01T00:00:00.000Z',
      href: '/admin/members/m1?tab=verification',
    });
  });

  it('scopes to open gaps of non-deleted members, oldest detection first', async () => {
    vi.mocked(db.discrepancy.findMany).mockResolvedValue([] as never);
    await listOpenDiscrepancies();
    const arg = firstArg(db.discrepancy.findMany);
    expect(arg.where).toEqual({ status: 'open', member: { status: { not: 'deleted' } } });
    expect(arg.orderBy).toEqual([{ detectedAt: 'asc' }, { id: 'asc' }]);
  });

  it('paginates with a look-ahead cursor', async () => {
    const rows = Array.from({ length: TRIAGE_PAGE_SIZE + 1 }, (_, i) => discRow(`d${i}`));
    vi.mocked(db.discrepancy.findMany).mockResolvedValue(rows as never);

    const { items, nextCursor } = await listOpenDiscrepancies();
    expect(items).toHaveLength(TRIAGE_PAGE_SIZE);
    expect(nextCursor).toBe(`d${TRIAGE_PAGE_SIZE - 1}`);
  });
});

describe('getTriageQueueCounts', () => {
  it('sums the three section counts and excludes deleted members from each', async () => {
    vi.mocked(db.trade.count)
      .mockResolvedValueOnce(4 as never) // uncommented closed
      .mockResolvedValueOnce(2 as never); // stale open
    vi.mocked(db.discrepancy.count).mockResolvedValue(3 as never);

    const counts = await getTriageQueueCounts();
    expect(counts).toEqual({
      uncommentedClosed: 4,
      staleOpen: 2,
      openDiscrepancies: 3,
      total: 9,
    });

    // Every count excludes soft-deleted members (the queue must never point the
    // coach at a purged account).
    const calls = vi.mocked(db.trade.count).mock.calls;
    const closedWhere = calls[0]?.[0]?.where as Record<string, unknown>;
    expect(closedWhere).toMatchObject({
      closedAt: { not: null },
      annotations: { none: {} },
      user: { status: { not: 'deleted' } },
    });
    const staleWhere = calls[1]?.[0]?.where as Record<string, unknown>;
    expect(staleWhere).toMatchObject({ closedAt: null, user: { status: { not: 'deleted' } } });
    expect((staleWhere.enteredAt as { lt: Date }).lt).toBeInstanceOf(Date);
  });
});
