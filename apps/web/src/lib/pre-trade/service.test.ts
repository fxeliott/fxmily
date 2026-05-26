import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db singleton BEFORE importing the SUT (Prisma client init lazy
// otherwise yells about adapter / connection at unit-test time). Pattern
// J5 `lib/notifications/enqueue.test.ts` carbone.
const createMock = vi.fn();
const findManyMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    preTradeCheck: {
      create: createMock,
      findMany: findManyMock,
      findFirst: findFirstMock,
      update: updateMock,
    },
  },
}));

const {
  createPreTradeCheck,
  listRecentPreTradeChecks,
  linkRecentCheckToTrade,
  LINK_DEFAULT_WINDOW_MIN,
  MAX_LIST_LIMIT,
} = await import('./service');

afterEach(() => {
  createMock.mockReset();
  findManyMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
});

const NOW_FIXED = new Date('2026-05-26T15:30:00.000Z');

describe('createPreTradeCheck', () => {
  it('persists with userId + all 4 fields and returns serialized shape', async () => {
    const dbRow = {
      id: 'ptc_1',
      userId: 'user_1',
      createdAt: NOW_FIXED,
      reasonToTrade: 'edge' as const,
      emotionLabel: 'calme' as const,
      planAlignment: true,
      stopLossPredefined: true,
      linkedTradeId: null,
    };
    createMock.mockResolvedValueOnce(dbRow);

    const result = await createPreTradeCheck('user_1', {
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0]?.data).toEqual({
      userId: 'user_1',
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
    });
    expect(result).toEqual({
      id: 'ptc_1',
      userId: 'user_1',
      createdAt: '2026-05-26T15:30:00.000Z',
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
      linkedTradeId: null,
    });
  });

  it('NEVER persists linkedTradeId from input (service-only field)', async () => {
    createMock.mockResolvedValueOnce({
      id: 'ptc_2',
      userId: 'user_2',
      createdAt: NOW_FIXED,
      reasonToTrade: 'fomo' as const,
      emotionLabel: 'excite' as const,
      planAlignment: false,
      stopLossPredefined: false,
      linkedTradeId: null,
    });

    await createPreTradeCheck('user_2', {
      reasonToTrade: 'fomo',
      emotionLabel: 'excite',
      planAlignment: false,
      stopLossPredefined: false,
    });

    const persistedData = createMock.mock.calls[0]?.[0]?.data ?? {};
    expect(persistedData).not.toHaveProperty('linkedTradeId');
  });
});

describe('listRecentPreTradeChecks', () => {
  it('queries newest-first scoped to userId with default limit 20', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await listRecentPreTradeChecks('user_1');

    expect(findManyMock).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });

  it('clamps limit to MAX_LIST_LIMIT (100) when caller passes a giant number', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await listRecentPreTradeChecks('user_1', Number.MAX_SAFE_INTEGER);

    expect(findManyMock.mock.calls[0]?.[0]?.take).toBe(MAX_LIST_LIMIT);
  });

  it('clamps limit to 1 minimum (rejects 0 / negative / NaN)', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await listRecentPreTradeChecks('user_1', 0);
    expect(findManyMock.mock.calls[0]?.[0]?.take).toBe(1);

    findManyMock.mockResolvedValueOnce([]);
    await listRecentPreTradeChecks('user_1', -50);
    expect(findManyMock.mock.calls[1]?.[0]?.take).toBe(1);
  });

  it('serializes each row (Date → ISO)', async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: 'ptc_A',
        userId: 'user_1',
        createdAt: new Date('2026-05-26T10:00:00.000Z'),
        reasonToTrade: 'edge',
        emotionLabel: 'calme',
        planAlignment: true,
        stopLossPredefined: true,
        linkedTradeId: 'trade_X',
      },
      {
        id: 'ptc_B',
        userId: 'user_1',
        createdAt: new Date('2026-05-26T09:00:00.000Z'),
        reasonToTrade: 'fomo',
        emotionLabel: 'frustre',
        planAlignment: false,
        stopLossPredefined: false,
        linkedTradeId: null,
      },
    ]);

    const result = await listRecentPreTradeChecks('user_1');

    expect(result).toHaveLength(2);
    expect(result[0]?.createdAt).toBe('2026-05-26T10:00:00.000Z');
    expect(result[0]?.linkedTradeId).toBe('trade_X');
    expect(result[1]?.linkedTradeId).toBeNull();
  });
});

describe('linkRecentCheckToTrade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_FIXED);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds the most recent unlinked check within 15min window and updates linkedTradeId', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'ptc_recent' });
    updateMock.mockResolvedValueOnce({ id: 'ptc_recent', linkedTradeId: 'trade_NEW' });

    const result = await linkRecentCheckToTrade('user_1', 'trade_NEW');

    expect(result).toBe('ptc_recent');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        linkedTradeId: null,
        createdAt: { gte: new Date(NOW_FIXED.getTime() - 15 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'ptc_recent', linkedTradeId: null },
      data: { linkedTradeId: 'trade_NEW' },
    });
  });

  it('uses LINK_DEFAULT_WINDOW_MIN = 15 by default', () => {
    expect(LINK_DEFAULT_WINDOW_MIN).toBe(15);
  });

  it('respects custom windowMin parameter (e.g. 30 minutes)', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'ptc_30min' });
    updateMock.mockResolvedValueOnce({ id: 'ptc_30min', linkedTradeId: 'trade_X' });

    await linkRecentCheckToTrade('user_1', 'trade_X', 30);

    expect(findFirstMock.mock.calls[0]?.[0]?.where?.createdAt?.gte).toEqual(
      new Date(NOW_FIXED.getTime() - 30 * 60_000),
    );
  });

  it('returns null when no recent unlinked check is found', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const result = await linkRecentCheckToTrade('user_1', 'trade_NEW');

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns null when update races and throws P2025 (lost the race, no-op)', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'ptc_raced' });
    updateMock.mockRejectedValueOnce(
      Object.assign(new Error('record not found'), { code: 'P2025' }),
    );

    const result = await linkRecentCheckToTrade('user_1', 'trade_NEW');

    expect(result).toBeNull();
  });

  it('bubbles up unexpected DB errors (NOT P2025)', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'ptc_X' });
    updateMock.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );

    await expect(linkRecentCheckToTrade('user_1', 'trade_NEW')).rejects.toThrow('connection lost');
  });

  it('NEVER queries other users (userId is scoping predicate)', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    await linkRecentCheckToTrade('user_OWNER', 'trade_X');

    expect(findFirstMock.mock.calls[0]?.[0]?.where?.userId).toBe('user_OWNER');
  });

  it('clamps insane windowMin values (defense against caller bug)', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    // Window > 24h gets clamped to 24h (60 * 24 min)
    await linkRecentCheckToTrade('user_1', 'trade_X', 999_999);
    const since1 = findFirstMock.mock.calls[0]?.[0]?.where?.createdAt?.gte;
    expect(since1).toEqual(new Date(NOW_FIXED.getTime() - 60 * 24 * 60_000));

    // Window 0 / negative gets clamped to 1 min
    findFirstMock.mockResolvedValueOnce(null);
    await linkRecentCheckToTrade('user_1', 'trade_X', 0);
    const since2 = findFirstMock.mock.calls[1]?.[0]?.where?.createdAt?.gte;
    expect(since2).toEqual(new Date(NOW_FIXED.getTime() - 60_000));
  });
});
