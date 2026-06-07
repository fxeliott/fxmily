import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db singleton before importing the SUT (lazy Prisma init otherwise
// complains about the adapter at unit-test time). `vi.hoisted` lets the
// hoisted `vi.mock` factory reference the spy.
const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: {
    behavioralScore: {
      findMany: findManyMock,
    },
  },
}));

import { getBehavioralScoreHistory } from './service';

beforeEach(() => {
  findManyMock.mockReset();
});

/**
 * Session 3 §28/§21 — behavioral-score history projection for the member's
 * "progression over time" chart. The loader must map each row to the trend
 * shape (date `YYYY-MM-DD` + 4 ints), pass `null` scores through unchanged
 * (insufficient_data days — never a fabricated 0), preserve the DB's ascending
 * order, and scope by `userId` + a `sinceDays` cutoff.
 */
describe('getBehavioralScoreHistory', () => {
  it('maps rows to trend points (date YYYY-MM-DD + 4 dimensions), null passthrough, order preserved', async () => {
    findManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-06-01T00:00:00.000Z'),
        disciplineScore: 60,
        emotionalStabilityScore: null, // insufficient_data that day
        consistencyScore: 55,
        engagementScore: 70,
      },
      {
        date: new Date('2026-06-02T00:00:00.000Z'),
        disciplineScore: 62,
        emotionalStabilityScore: 48,
        consistencyScore: 57,
        engagementScore: 72,
      },
    ]);

    const out = await getBehavioralScoreHistory('user_1');

    expect(out).toEqual([
      {
        date: '2026-06-01',
        discipline: 60,
        emotionalStability: null,
        consistency: 55,
        engagement: 70,
      },
      {
        date: '2026-06-02',
        discipline: 62,
        emotionalStability: 48,
        consistency: 57,
        engagement: 72,
      },
    ]);
  });

  it('queries user-scoped, ascending, with a sinceDays cutoff (default 90)', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await getBehavioralScoreHistory('user_1');

    const arg = findManyMock.mock.calls[0]?.[0] as {
      where: { userId: string; date: { gte: Date } };
      orderBy: { date: string };
    };
    expect(arg.where.userId).toBe('user_1');
    expect(arg.orderBy).toEqual({ date: 'asc' });
    expect(arg.where.date.gte).toBeInstanceOf(Date);
  });

  it('honors a custom sinceDays window (tighter cutoff)', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await getBehavioralScoreHistory('user_1', { sinceDays: 7 });
    const cutoff7 = (findManyMock.mock.calls[0]?.[0] as { where: { date: { gte: Date } } }).where
      .date.gte;

    findManyMock.mockResolvedValueOnce([]);
    await getBehavioralScoreHistory('user_1', { sinceDays: 90 });
    const cutoff90 = (findManyMock.mock.calls[1]?.[0] as { where: { date: { gte: Date } } }).where
      .date.gte;

    // A 7-day window starts AFTER a 90-day window.
    expect(cutoff7.getTime()).toBeGreaterThan(cutoff90.getTime());
  });

  it('returns an empty array when the member has no snapshots yet', async () => {
    findManyMock.mockResolvedValueOnce([]);
    expect(await getBehavioralScoreHistory('user_1')).toEqual([]);
  });
});
