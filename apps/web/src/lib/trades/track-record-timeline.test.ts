import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trade: { findMany: vi.fn() },
    discrepancy: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import { listTrackRecordTimeline } from './track-record-timeline';

// findMany returns newest-first (orderBy closedAt desc) — the loader reverses
// to oldest-first for a left→right reading of the series.
const NEWER = {
  id: 't-new',
  pair: 'GBPUSD',
  direction: 'short',
  closedAt: new Date('2026-06-10T12:00:00.000Z'),
  realizedR: -1,
  realizedRSource: 'estimated',
  planRespected: false,
  screenshotEntryKey: null,
};
const OLDER = {
  id: 't-old',
  pair: 'EURUSD',
  direction: 'long',
  closedAt: new Date('2026-06-08T12:00:00.000Z'),
  realizedR: 1.5,
  realizedRSource: 'computed',
  planRespected: true,
  screenshotEntryKey: 'trades/u/abc.png',
};

describe('listTrackRecordTimeline — frise track record (S4 §33 #1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mappe, sérialise les Decimal, et rend du plus ANCIEN au plus récent', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([NEWER, OLDER] as never);
    vi.mocked(db.discrepancy.findMany).mockResolvedValue([{ declaredTradeId: 't-old' }] as never);

    const out = await listTrackRecordTimeline('member-1');

    expect(out.map((i) => i.id)).toEqual(['t-old', 't-new']); // reversed → chrono asc
    expect(out[0]).toEqual({
      id: 't-old',
      date: OLDER.closedAt,
      pair: 'EURUSD',
      direction: 'long',
      realizedR: 1.5,
      realizedREstimated: false,
      planRespected: true,
      hasPhoto: true,
      hasDiscrepancy: true,
    });
    // The newer (loss, estimated, no photo, no écart) maps faithfully.
    expect(out[1]).toMatchObject({
      id: 't-new',
      realizedR: -1,
      realizedREstimated: true,
      planRespected: false,
      hasPhoto: false,
      hasDiscrepancy: false,
    });
  });

  it('ne lit que les trades clôturés, ordre desc, cap 24, écarts scoping membre', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([OLDER] as never);
    vi.mocked(db.discrepancy.findMany).mockResolvedValue([] as never);

    await listTrackRecordTimeline('member-1');

    const tradeArgs = vi.mocked(db.trade.findMany).mock.calls[0]![0] as {
      where: { userId: string; closedAt: { not: null } };
      orderBy: { closedAt: string };
      take: number;
    };
    expect(tradeArgs.where).toEqual({ userId: 'member-1', closedAt: { not: null } });
    expect(tradeArgs.orderBy).toEqual({ closedAt: 'desc' });
    expect(tradeArgs.take).toBe(24);

    const discArgs = vi.mocked(db.discrepancy.findMany).mock.calls[0]![0] as {
      where: { memberId: string; declaredTradeId: { in: string[] } };
    };
    expect(discArgs.where.memberId).toBe('member-1');
    expect(discArgs.where.declaredTradeId.in).toEqual(['t-old']);
  });

  it('aucun trade clôturé → [] sans requêter les écarts', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    const out = await listTrackRecordTimeline('member-1');
    expect(out).toEqual([]);
    expect(db.discrepancy.findMany).not.toHaveBeenCalled();
  });

  it('borne le limit dans [1, 24]', async () => {
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    await listTrackRecordTimeline('m', { limit: 100 });
    await listTrackRecordTimeline('m', { limit: 0 });
    expect((vi.mocked(db.trade.findMany).mock.calls[0]![0] as { take: number }).take).toBe(24);
    expect((vi.mocked(db.trade.findMany).mock.calls[1]![0] as { take: number }).take).toBe(1);
  });
});
