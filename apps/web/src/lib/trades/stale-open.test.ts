/**
 * Tour 13 — `getStaleOpenTradesSummary` (Prisma-mocked).
 *
 * A trade the member logged but never closed drops out of the behavioural score
 * in silence. This read powers the member-side hub reminder: how many of the
 * user's OWN trades have been open longer than 72 h, and the oldest one's id for
 * a deep-link. Pins the threshold semantics (open > 72 h from `enteredAt`,
 * ownership-scoped) and the empty case (nothing stale → count 0, id null).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tradeCountMock = vi.fn<(...args: unknown[]) => unknown>();
const tradeFindFirstMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/db', () => ({
  db: {
    trade: {
      count: tradeCountMock,
      findFirst: tradeFindFirstMock,
    },
  },
}));

// `service.ts` imports the storage adapter at module load (for other exports) —
// stub it so importing the module under test doesn't drag real storage in.
vi.mock('@/lib/storage', () => ({
  selectStorage: () => ({ delete: vi.fn(), getReadUrl: (k: string) => `https://cdn/${k}` }),
}));

const { getStaleOpenTradesSummary, STALE_OPEN_TRADE_MS } = await import('./service');

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  tradeCountMock.mockReset();
  tradeFindFirstMock.mockReset();
});

describe('getStaleOpenTradesSummary', () => {
  const NOW = new Date('2026-07-04T12:00:00.000Z');

  it('scopes the query to the user, still-open trades entered before the 72h threshold', async () => {
    tradeCountMock.mockResolvedValueOnce(1);
    tradeFindFirstMock.mockResolvedValueOnce({ id: 'trade_oldest' });

    const summary = await getStaleOpenTradesSummary('user_1', NOW);

    expect(summary).toEqual({ count: 1, oldestTradeId: 'trade_oldest' });

    const expectedThreshold = new Date(NOW.getTime() - STALE_OPEN_TRADE_MS);
    const countWhere = (tradeCountMock.mock.calls[0]?.[0] as { where: Record<string, unknown> })
      .where;
    expect(countWhere).toEqual({
      userId: 'user_1',
      closedAt: null,
      // Strict `<` — same comparator as the admin cohort queue (shared
      // threshold module), "open LONGER than 72 h".
      enteredAt: { lt: expectedThreshold },
    });
    // 72h before now, to the millisecond.
    expect(expectedThreshold.toISOString()).toBe('2026-07-01T12:00:00.000Z');
    // Oldest-first, so the deep-linked trade is the one waiting the longest.
    const findArg = tradeFindFirstMock.mock.calls[0]?.[0] as {
      orderBy: unknown;
      select: unknown;
    };
    expect(findArg.orderBy).toEqual({ enteredAt: 'asc' });
    expect(findArg.select).toEqual({ id: true });
  });

  it('flags a trade open for 100h (past the threshold)', async () => {
    // Simulate the DB: a 100h-old open trade matches the WHERE, so count=1.
    tradeCountMock.mockResolvedValueOnce(1);
    tradeFindFirstMock.mockResolvedValueOnce({ id: 'trade_100h' });

    const summary = await getStaleOpenTradesSummary('user_1', NOW);

    expect(summary.count).toBe(1);
    expect(summary.oldestTradeId).toBe('trade_100h');
    // 100h > 72h — sanity on the fixture intent.
    expect(100 * HOUR).toBeGreaterThan(STALE_OPEN_TRADE_MS);
  });

  it('does NOT flag a trade open for only 24h (under the threshold → count 0)', async () => {
    // A 24h-old open trade does not match `enteredAt < now-72h`, so the DB
    // returns 0 and no oldest row.
    tradeCountMock.mockResolvedValueOnce(0);
    tradeFindFirstMock.mockResolvedValueOnce(null);

    const summary = await getStaleOpenTradesSummary('user_1', NOW);

    expect(summary).toEqual({ count: 0, oldestTradeId: null });
    expect(24 * HOUR).toBeLessThan(STALE_OPEN_TRADE_MS);
  });

  it('does NOT flag closed trades (closedAt filter → count 0)', async () => {
    // A closed trade fails the `closedAt: null` predicate regardless of age.
    tradeCountMock.mockResolvedValueOnce(0);
    tradeFindFirstMock.mockResolvedValueOnce(null);

    const summary = await getStaleOpenTradesSummary('user_1', NOW);

    expect(summary).toEqual({ count: 0, oldestTradeId: null });
  });

  it('reports the count when several trades are stale', async () => {
    tradeCountMock.mockResolvedValueOnce(3);
    tradeFindFirstMock.mockResolvedValueOnce({ id: 'trade_oldest_of_three' });

    const summary = await getStaleOpenTradesSummary('user_1', NOW);

    expect(summary.count).toBe(3);
    expect(summary.oldestTradeId).toBe('trade_oldest_of_three');
  });
});
