import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trade: { findMany: vi.fn(), count: vi.fn() },
    trainingTrade: { findMany: vi.fn(), count: vi.fn() },
    discrepancy: { groupBy: vi.fn(), count: vi.fn() },
    constancyScore: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import { getCohortAttention, getMembersAttention } from './attention-service';

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
    expect(db.trade.findMany).not.toHaveBeenCalled();
    expect(db.discrepancy.groupBy).not.toHaveBeenCalled();
  });

  it('aggregates uncommented trades, open gaps and a constancy dip per member', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([{ userId: 'm1' }, { userId: 'm1' }] as never);
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([{ userId: 'm2' }] as never);
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
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
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
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
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
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
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
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
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
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.discrepancy.groupBy).mockResolvedValue([] as never);
    vi.mocked(db.constancyScore.findMany).mockResolvedValue([] as never);

    await getMembersAttention(['m1', 'm2']);

    const tradeWhere = firstArg(db.trade.findMany).where as Record<string, unknown>;
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
