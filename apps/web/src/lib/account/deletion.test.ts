import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.fn();
const findManyMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
      update: updateMock,
      delete: deleteMock,
    },
  },
}));

const {
  ACCOUNT_DELETION_GRACE_HOURS,
  ACCOUNT_HARD_PURGE_DAYS,
  AccountDeletionAlreadyRequestedError,
  AccountDeletionNotPendingError,
  cancelAccountDeletion,
  deriveDeletionState,
  materialisePendingDeletions,
  purgeMaterialisedDeletions,
  requestAccountDeletion,
} = await import('./deletion');

beforeEach(() => {
  findUniqueMock.mockReset();
  findManyMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deriveDeletionState', () => {
  const now = new Date('2026-05-08T12:00:00.000Z');

  it("returns kind='active' on a normal user", () => {
    expect(deriveDeletionState({ status: 'active', deletedAt: null }, now)).toEqual({
      kind: 'active',
    });
  });

  it("returns kind='scheduled' with positive remaining ms when deletedAt is in the future", () => {
    const scheduledAt = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const state = deriveDeletionState({ status: 'active', deletedAt: scheduledAt }, now);
    expect(state).toEqual({
      kind: 'scheduled',
      scheduledAt,
      msUntilMaterialisation: 10 * 60 * 60 * 1000,
    });
  });

  it("returns kind='scheduled' with 0 ms when grace already elapsed (cron not yet ran)", () => {
    const elapsed = new Date(now.getTime() - 1_000);
    const state = deriveDeletionState({ status: 'active', deletedAt: elapsed }, now);
    expect(state.kind).toBe('scheduled');
    if (state.kind === 'scheduled') {
      expect(state.msUntilMaterialisation).toBe(0);
    }
  });

  it("returns kind='materialised' with computed hard-purge countdown", () => {
    const materialisedAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const state = deriveDeletionState({ status: 'deleted', deletedAt: materialisedAt }, now);
    expect(state.kind).toBe('materialised');
    if (state.kind === 'materialised') {
      expect(state.materialisedAt).toEqual(materialisedAt);
      expect(state.msUntilHardPurge).toBe(20 * 24 * 60 * 60 * 1000);
    }
  });
});

describe('requestAccountDeletion', () => {
  it('schedules deletedAt = now + 24h and returns the timestamp', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findUniqueMock.mockResolvedValueOnce({ status: 'active', deletedAt: null });
    updateMock.mockResolvedValueOnce({});

    const { scheduledAt } = await requestAccountDeletion('u1', { now });

    expect(scheduledAt.toISOString()).toBe('2026-05-09T10:00:00.000Z');
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { deletedAt: scheduledAt },
    });
    expect(ACCOUNT_DELETION_GRACE_HOURS).toBe(24);
  });

  it('throws AccountDeletionAlreadyRequestedError when one is already scheduled', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    const scheduled = new Date(now.getTime() + 60 * 60 * 1000);
    findUniqueMock.mockResolvedValueOnce({ status: 'active', deletedAt: scheduled });

    await expect(requestAccountDeletion('u1', { now })).rejects.toBeInstanceOf(
      AccountDeletionAlreadyRequestedError,
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('throws AccountDeletionAlreadyRequestedError when already materialised', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findUniqueMock.mockResolvedValueOnce({
      status: 'deleted',
      deletedAt: new Date('2026-04-30T00:00:00.000Z'),
    });
    await expect(requestAccountDeletion('u1', { now })).rejects.toBeInstanceOf(
      AccountDeletionAlreadyRequestedError,
    );
  });
});

describe('cancelAccountDeletion', () => {
  it('clears deletedAt when scheduled in the future', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findUniqueMock.mockResolvedValueOnce({
      status: 'active',
      deletedAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    updateMock.mockResolvedValueOnce({});

    await cancelAccountDeletion('u1', { now });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { deletedAt: null },
    });
  });

  it('throws AccountDeletionNotPendingError when nothing to cancel', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findUniqueMock.mockResolvedValueOnce({ status: 'active', deletedAt: null });
    await expect(cancelAccountDeletion('u1', { now })).rejects.toBeInstanceOf(
      AccountDeletionNotPendingError,
    );
  });

  it('throws AccountDeletionNotPendingError when already materialised', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findUniqueMock.mockResolvedValueOnce({
      status: 'deleted',
      deletedAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    await expect(cancelAccountDeletion('u1', { now })).rejects.toBeInstanceOf(
      AccountDeletionNotPendingError,
    );
  });
});

describe('materialisePendingDeletions', () => {
  it('scrubs PII and flips status for every elapsed scheduled row', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([
      { id: 'u1', deletedAt: new Date('2026-05-07T10:00:00.000Z') },
      { id: 'u2', deletedAt: new Date('2026-05-07T11:00:00.000Z') },
    ]);
    updateMock.mockResolvedValue({});

    const result = await materialisePendingDeletions({ now });

    expect(findManyMock).toHaveBeenCalledWith({
      where: { status: 'active', deletedAt: { lte: now } },
      select: { id: true, deletedAt: true },
      orderBy: { deletedAt: 'asc' },
      take: 200,
    });
    expect(result).toEqual({
      scanned: 2,
      materialised: 2,
      errors: 0,
      ranAt: now.toISOString(),
    });
    // Verify the scrub payload of the first call
    const firstCall = updateMock.mock.calls[0]?.[0];
    expect(firstCall?.where).toEqual({ id: 'u1' });
    expect(firstCall?.data).toMatchObject({
      status: 'deleted',
      deletedAt: now,
      email: 'deleted-u1@fxmily.local',
      emailVerified: null,
      firstName: null,
      lastName: null,
      image: null,
      passwordHash: null,
    });
    // The legacy J9 `pushSubscription` Json column is scrubbed via
    // `Prisma.DbNull` (writes a SQL NULL into a Json column — bare `null`
    // would be the JSON literal `null`). We don't pin its exact identity
    // here (it's the Prisma.DbNull symbol); we only assert the field is
    // present so future regressions trip a test.
    expect('pushSubscription' in (firstCall?.data ?? {})).toBe(true);
  });

  it('counts errors but keeps going if one row fails', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([
      { id: 'u1', deletedAt: new Date('2026-05-07T10:00:00.000Z') },
      { id: 'u2', deletedAt: new Date('2026-05-07T11:00:00.000Z') },
    ]);
    updateMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({});
    // Silence the expected console.error from the inner catch.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await materialisePendingDeletions({ now });

    expect(result.errors).toBe(1);
    expect(result.materialised).toBe(1);
    expect(result.scanned).toBe(2);
    errSpy.mockRestore();
  });

  it('returns empty result when no candidates match', async () => {
    findManyMock.mockResolvedValueOnce([]);
    const result = await materialisePendingDeletions();
    expect(result.scanned).toBe(0);
    expect(result.materialised).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('purgeMaterialisedDeletions', () => {
  it('hard-deletes rows older than the threshold (default 30d)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    const expectedThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
    deleteMock.mockResolvedValue({});

    const result = await purgeMaterialisedDeletions({ now });

    expect(findManyMock).toHaveBeenCalledWith({
      where: { status: 'deleted', deletedAt: { lt: expectedThreshold } },
      select: { id: true },
      orderBy: { deletedAt: 'asc' },
      take: 200,
    });
    expect(deleteMock).toHaveBeenCalledTimes(3);
    expect(result.purged).toBe(3);
    expect(result.threshold).toBe(expectedThreshold.toISOString());
    expect(ACCOUNT_HARD_PURGE_DAYS).toBe(30);
  });

  it('uses a custom retention window when provided', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    const customDays = 7;
    const expectedThreshold = new Date(now.getTime() - customDays * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValueOnce([]);

    const result = await purgeMaterialisedDeletions({ now, olderThanDays: customDays });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'deleted', deletedAt: { lt: expectedThreshold } },
      }),
    );
    expect(result.threshold).toBe(expectedThreshold.toISOString());
  });

  it('counts errors and continues', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]);
    deleteMock.mockRejectedValueOnce(new Error('FK constraint')).mockResolvedValueOnce({});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await purgeMaterialisedDeletions({ now });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.errors).toBe(1);
    errSpy.mockRestore();
  });
});
