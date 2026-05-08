import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findManyMock = vi.fn<(...args: unknown[]) => unknown>();
const deleteManyMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/db', () => ({
  db: {
    pushSubscription: {
      findMany: findManyMock,
      deleteMany: deleteManyMock,
    },
  },
}));

const { PUSH_SUBSCRIPTION_STALE_DAYS, purgeStalePushSubscriptions } = await import('./cleanup');

beforeEach(() => {
  findManyMock.mockReset();
  deleteManyMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('purgeStalePushSubscriptions', () => {
  it('uses the 90-day default threshold and skips deleteMany when nothing matches', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([]);

    const result = await purgeStalePushSubscriptions({ now });
    const expectedThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    expect(PUSH_SUBSCRIPTION_STALE_DAYS).toBe(90);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { lastSeenAt: { lt: expectedThreshold } },
      select: { id: true },
      orderBy: { lastSeenAt: 'asc' },
      take: 500,
    });
    // Empty candidates → no deleteMany call (saves a round-trip).
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(result.staleThreshold).toBe(expectedThreshold.toISOString());
    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('issues a single batch deleteMany on the candidate id list (J10 Phase J perf fix)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([{ id: 'sub_1' }, { id: 'sub_2' }, { id: 'sub_3' }]);
    deleteManyMock.mockResolvedValueOnce({ count: 3 });

    const result = await purgeStalePushSubscriptions({ now });

    // ONE deleteMany call instead of N delete calls (perf-profiler T2.1).
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['sub_1', 'sub_2', 'sub_3'] } },
    });
    expect(result).toMatchObject({ scanned: 3, deleted: 3, errors: 0 });
  });

  it('counts the candidate set as errors when deleteMany throws', async () => {
    findManyMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    deleteManyMock.mockRejectedValueOnce(new Error('FK constraint'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await purgeStalePushSubscriptions();

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(2);
    errSpy.mockRestore();
  });

  it('honors a custom retention window', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([]);

    await purgeStalePushSubscriptions({ now, staleDays: 30 });
    const expectedThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lastSeenAt: { lt: expectedThreshold } } }),
    );
  });

  it('honors a custom batch size', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await purgeStalePushSubscriptions({ batchSize: 50 });
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  // =============================================================================
  // J10 Phase A — extended edge cases (added 2026-05-09)
  // =============================================================================

  it('uses strict `lt` (not `lte`) so a row at the exact threshold is preserved', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([]);

    await purgeStalePushSubscriptions({ now });

    const expectedThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const call = findManyMock.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call?.where).toEqual({ lastSeenAt: { lt: expectedThreshold } });
    expect(JSON.stringify(call?.where)).not.toContain('"lte"');
  });

  it('does NOT sweep rows whose lastSeenAt is NULL (never-seen subs preserved)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([]);

    await purgeStalePushSubscriptions({ now });

    const where = (findManyMock.mock.calls[0]?.[0] as { where?: Record<string, unknown> })?.where;
    expect(Object.keys(where ?? {})).toEqual(['lastSeenAt']);
    const lastSeen = where?.['lastSeenAt'] as Record<string, unknown> | undefined;
    expect(lastSeen).toHaveProperty('lt');
    expect(lastSeen).not.toHaveProperty('equals');
    expect(where?.['OR']).toBeUndefined();
  });

  it('returns staleThreshold and ranAt as ISO-8601 strings', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([]);

    const result = await purgeStalePushSubscriptions({ now });

    expect(typeof result.staleThreshold).toBe('string');
    expect(typeof result.ranAt).toBe('string');
    expect(result.staleThreshold).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.ranAt).toBe(now.toISOString());
  });
});
