import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CorrectionRecord } from './correction-themes';

const m = vi.hoisted(() => ({
  tradeFindMany: vi.fn(),
  trainingFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    tradeAnnotation: { findMany: m.tradeFindMany },
    trainingAnnotation: { findMany: m.trainingFindMany },
  },
}));

import { aggregateCorrectionThemes, getCorrectionThemes } from './correction-themes';

beforeEach(() => vi.clearAllMocks());

function rec(over: Partial<CorrectionRecord> = {}): CorrectionRecord {
  return {
    axis: 'execution',
    comment: 'comment',
    createdAt: new Date('2026-06-10T10:00:00Z'),
    source: 'trade',
    ...over,
  };
}

describe('aggregateCorrectionThemes (pure)', () => {
  it('groups by axis and counts', () => {
    const themes = aggregateCorrectionThemes([
      rec({ axis: 'execution' }),
      rec({ axis: 'execution' }),
      rec({ axis: 'risk_discipline' }),
    ]);
    expect(themes).toHaveLength(2);
    const exec = themes.find((t) => t.axis === 'execution');
    const risk = themes.find((t) => t.axis === 'risk_discipline');
    expect(exec?.count).toBe(2);
    expect(risk?.count).toBe(1);
  });

  it('sorts by count desc, then by most-recent activity', () => {
    const themes = aggregateCorrectionThemes([
      rec({ axis: 'routine' }),
      rec({ axis: 'execution' }),
      rec({ axis: 'execution' }),
      rec({ axis: 'execution' }),
    ]);
    expect(themes[0]!.axis).toBe('execution');
    expect(themes[0]!.count).toBe(3);
    expect(themes[1]!.axis).toBe('routine');
  });

  it('breaks a count tie on the freshest lastAt', () => {
    const themes = aggregateCorrectionThemes([
      rec({ axis: 'routine', createdAt: new Date('2026-06-01T00:00:00Z') }),
      rec({ axis: 'execution', createdAt: new Date('2026-06-20T00:00:00Z') }),
    ]);
    // Both count 1 → the more recent axis (execution) leads.
    expect(themes[0]!.axis).toBe('execution');
  });

  it('exposes the most-recent comment/date/source per theme (newest-first)', () => {
    const themes = aggregateCorrectionThemes([
      rec({
        axis: 'execution',
        comment: 'older',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        source: 'trade',
      }),
      rec({
        axis: 'execution',
        comment: 'newest',
        createdAt: new Date('2026-06-25T00:00:00Z'),
        source: 'training',
      }),
    ]);
    expect(themes[0]!.lastComment).toBe('newest');
    expect(themes[0]!.lastAt).toEqual(new Date('2026-06-25T00:00:00Z'));
    expect(themes[0]!.lastSource).toBe('training');
  });

  it('returns [] for no records', () => {
    expect(aggregateCorrectionThemes([])).toEqual([]);
  });
});

describe('getCorrectionThemes (DB reader)', () => {
  it('merges trade + training tagged corrections and themes them', async () => {
    m.tradeFindMany.mockResolvedValue([
      { axis: 'execution', comment: 'trade a', createdAt: new Date('2026-06-10T00:00:00Z') },
      { axis: 'execution', comment: 'trade b', createdAt: new Date('2026-06-12T00:00:00Z') },
    ]);
    m.trainingFindMany.mockResolvedValue([
      { axis: 'execution', comment: 'training c', createdAt: new Date('2026-06-15T00:00:00Z') },
      { axis: 'routine', comment: 'training d', createdAt: new Date('2026-06-11T00:00:00Z') },
    ]);

    const themes = await getCorrectionThemes('member-1', 30, new Date('2026-06-20T00:00:00Z'));

    expect(themes[0]!.axis).toBe('execution');
    expect(themes[0]!.count).toBe(3);
    expect(themes[0]!.lastComment).toBe('training c');
    expect(themes[0]!.lastSource).toBe('training');
    expect(themes[1]!.axis).toBe('routine');
    expect(themes[1]!.count).toBe(1);
  });

  it('filters the query to the member + non-null axis + the window', async () => {
    m.tradeFindMany.mockResolvedValue([]);
    m.trainingFindMany.mockResolvedValue([]);
    const now = new Date('2026-06-30T00:00:00Z');

    await getCorrectionThemes('member-42', 30, now);

    const tradeWhere = m.tradeFindMany.mock.calls[0]![0].where;
    expect(tradeWhere.axis).toEqual({ not: null });
    expect(tradeWhere.trade).toEqual({ is: { userId: 'member-42' } });
    expect(tradeWhere.createdAt.lte).toEqual(now);
    expect(tradeWhere.createdAt.gte).toEqual(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

    const trainingWhere = m.trainingFindMany.mock.calls[0]![0].where;
    expect(trainingWhere.axis).toEqual({ not: null });
    expect(trainingWhere.trainingTrade).toEqual({ is: { userId: 'member-42' } });
  });

  it('returns [] when the member has no tagged corrections', async () => {
    m.tradeFindMany.mockResolvedValue([]);
    m.trainingFindMany.mockResolvedValue([]);
    expect(await getCorrectionThemes('member-1')).toEqual([]);
  });
});
