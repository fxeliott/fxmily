import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trade: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// The serializer touches storage read-url generation; stub it so the test never
// reaches a real driver (mirrors `lib/trades/service` test posture).
vi.mock('@/lib/storage', () => ({
  selectStorage: () => ({ getReadUrl: (key: string) => `read://${key}` }),
}));

import { db } from '@/lib/db';

import { listMemberTradesAsAdmin } from './trades-service';

/**
 * Minimal `Trade`-row shape the serializer + Tour-13 annotation fold read. Only
 * the fields `toSerialized` and the `_count` fold touch are populated; the rest
 * are cast through `as never` at the mock boundary (same posture as the sibling
 * admin service tests).
 */
function makeTradeRow(id: string, annotations: number, overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-06-01T09:00:00.000Z');
  return {
    id,
    userId: 'member-1',
    pair: 'EURUSD',
    direction: 'long',
    session: 'london',
    enteredAt: now,
    entryPrice: { toString: () => '1.08' },
    lotSize: { toString: () => '1' },
    stopLossPrice: null,
    plannedRR: { toString: () => '2' },
    tradeQuality: null,
    riskPct: null,
    emotionBefore: [],
    planRespected: true,
    hedgeRespected: null,
    processComplete: null,
    slPerRule: null,
    movedToBe: null,
    partialAtTarget: null,
    notes: null,
    screenshotEntryKey: null,
    tradingViewEntryUrl: null,
    exitedAt: null,
    exitPrice: null,
    outcome: null,
    exitReason: null,
    realizedR: null,
    realizedRSource: null,
    emotionDuring: [],
    emotionAfter: [],
    screenshotExitKey: null,
    tradingViewExitUrl: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    _count: { annotations },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('listMemberTradesAsAdmin — annotation count fold (Tour 13)', () => {
  it('requests the `_count.annotations` join on the SAME findMany (no N+1)', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([makeTradeRow('t-1', 0)] as never);

    await listMemberTradesAsAdmin('member-1');

    const call = vi.mocked(db.trade.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as { include: { _count: { select: { annotations: boolean } } } };
    expect(arg.include).toEqual({ _count: { select: { annotations: true } } });
    // Exactly one query for the page — the count is folded, never a per-trade read.
    expect(vi.mocked(db.trade.findMany)).toHaveBeenCalledTimes(1);
  });

  it('maps each trade id to its annotation count', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([
      makeTradeRow('t-commented', 2),
      makeTradeRow('t-uncommented', 0),
    ] as never);

    const result = await listMemberTradesAsAdmin('member-1');

    expect(result.annotationCountByTrade.get('t-commented')).toBe(2);
    expect(result.annotationCountByTrade.get('t-uncommented')).toBe(0);
    expect(result.items).toHaveLength(2);
  });

  it('reports 0 (via a missing key) for a trade with no admin annotation', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([makeTradeRow('t-1', 0)] as never);

    const result = await listMemberTradesAsAdmin('member-1');

    // Explicitly present with 0 here; the component treats present-0 and absent
    // identically (`?? 0`), so « À commenter » shows either way.
    expect(result.annotationCountByTrade.get('t-1')).toBe(0);
    expect(result.annotationCountByTrade.has('t-missing')).toBe(false);
  });

  it('keeps the annotation map aligned with the page slice on a full look-ahead page', async () => {
    // 51 rows (limit 50 + look-ahead): the 51st is dropped from BOTH items and
    // the annotation map — the map must never carry the un-shown look-ahead row.
    const rows = Array.from({ length: 51 }, (_, i) => makeTradeRow(`t-${i}`, i === 50 ? 9 : 1));
    vi.mocked(db.trade.findMany).mockResolvedValue(rows as never);

    const result = await listMemberTradesAsAdmin('member-1', { limit: 50 });

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('t-49');
    expect(result.annotationCountByTrade.size).toBe(50);
    expect(result.annotationCountByTrade.has('t-50')).toBe(false);
  });
});
