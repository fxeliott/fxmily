import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findManyMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    pushSubscription: {
      findMany: findManyMock,
      delete: deleteMock,
    },
  },
}));

const { PUSH_SUBSCRIPTION_STALE_DAYS, purgeStalePushSubscriptions } = await import('./cleanup');

beforeEach(() => {
  findManyMock.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('purgeStalePushSubscriptions', () => {
  it('uses the 90-day default threshold', async () => {
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
    expect(result.staleThreshold).toBe(expectedThreshold.toISOString());
    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('deletes every candidate row by id', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([{ id: 'sub_1' }, { id: 'sub_2' }, { id: 'sub_3' }]);
    deleteMock.mockResolvedValue({});

    const result = await purgeStalePushSubscriptions({ now });

    expect(deleteMock).toHaveBeenCalledTimes(3);
    expect(deleteMock.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'sub_1' } },
      { where: { id: 'sub_2' } },
      { where: { id: 'sub_3' } },
    ]);
    expect(result).toMatchObject({ scanned: 3, deleted: 3, errors: 0 });
  });

  it('counts delete errors and keeps going', async () => {
    findManyMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    deleteMock.mockRejectedValueOnce(new Error('FK constraint')).mockResolvedValueOnce({});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await purgeStalePushSubscriptions();

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(1);
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
});
