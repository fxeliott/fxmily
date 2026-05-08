import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.fn();
const findManyMock = vi.fn();
const updateMock = vi.fn();
const updateManyMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
      update: updateMock,
      updateMany: updateManyMock,
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
  updateManyMock.mockReset();
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
  it('schedules deletedAt = now + 24h via atomic updateMany when row matches predicate', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    const { scheduledAt } = await requestAccountDeletion('u1', { now });

    expect(scheduledAt.toISOString()).toBe('2026-05-09T10:00:00.000Z');
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'u1', status: 'active', deletedAt: null },
      data: { deletedAt: scheduledAt },
    });
    // Atomic path : no fallback findUnique read.
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(ACCOUNT_DELETION_GRACE_HOURS).toBe(24);
  });

  it('throws AccountDeletionAlreadyRequestedError when predicate misses (count=0) and row exists', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    findUniqueMock.mockResolvedValueOnce({
      status: 'active',
      deletedAt: new Date(now.getTime() + 60 * 60 * 1000),
    });

    await expect(requestAccountDeletion('u1', { now })).rejects.toBeInstanceOf(
      AccountDeletionAlreadyRequestedError,
    );
  });

  it('throws AccountDeletionAlreadyRequestedError when row already materialised', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    findUniqueMock.mockResolvedValueOnce({
      status: 'deleted',
      deletedAt: new Date('2026-04-30T00:00:00.000Z'),
    });
    await expect(requestAccountDeletion('u1', { now })).rejects.toBeInstanceOf(
      AccountDeletionAlreadyRequestedError,
    );
  });

  it('throws plain Error when count=0 AND user does not exist', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    findUniqueMock.mockResolvedValueOnce(null);
    await expect(requestAccountDeletion('u_missing', { now })).rejects.toThrow(
      /User u_missing not found/,
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
      materialisedIds: ['u1', 'u2'],
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
    // The successful row (u2) is captured; u1's failed update isn't.
    expect(result.materialisedIds).toEqual(['u2']);
    errSpy.mockRestore();
  });

  it('returns empty result when no candidates match', async () => {
    findManyMock.mockResolvedValueOnce([]);
    const result = await materialisePendingDeletions();
    expect(result.scanned).toBe(0);
    expect(result.materialised).toBe(0);
    expect(result.materialisedIds).toEqual([]);
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
    expect(result.purgedIds).toEqual(['u1', 'u2', 'u3']);
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
    // Only u2 succeeded; u1 failed and is excluded from purgedIds.
    expect(result.purgedIds).toEqual(['u2']);
    errSpy.mockRestore();
  });
});

// =============================================================================
// J10 Phase A — extended edge cases (added 2026-05-09)
// =============================================================================

describe('deriveDeletionState — boundary cases', () => {
  // Why this edge case matters : the cron uses `deletedAt <= now` (lte) when
  // selecting candidates to materialise. A user whose `deletedAt` is exactly
  // `now` is on the seam between "scheduled" (still active, can cancel) and
  // "about to be materialised". The pure helper must keep returning
  // `kind='scheduled'` until the cron actually flips `status` to 'deleted',
  // otherwise the page shows "deletion complete" before the cron runs.
  it("returns kind='scheduled' with msUntilMaterialisation=0 when deletedAt === now (seam)", () => {
    const now = new Date('2026-05-08T12:00:00.000Z');
    const state = deriveDeletionState({ status: 'active', deletedAt: now }, now);
    expect(state.kind).toBe('scheduled');
    if (state.kind === 'scheduled') {
      expect(state.msUntilMaterialisation).toBe(0);
      expect(state.scheduledAt).toEqual(now);
    }
  });

  // Why this edge case matters : a row can theoretically end up with
  // `status='deleted'` AND `deletedAt=null` if a manual SQL fix forgot to set
  // deletedAt. The helper must not crash and must default to 'active' so the
  // UI doesn't render "deleted X days ago" with a NaN countdown.
  it("returns kind='active' as a safe fallback when status='deleted' but deletedAt is NULL", () => {
    const now = new Date('2026-05-08T12:00:00.000Z');
    const state = deriveDeletionState({ status: 'deleted', deletedAt: null }, now);
    expect(state).toEqual({ kind: 'active' });
  });

  // Why this edge case matters : Eliot can manually restore a soft-deleted
  // row (support workflow). The helper must clamp `msUntilHardPurge` to 0
  // when the 30-day window has already passed but the cron hasn't fired yet.
  // A negative value would render "deletion in -2 days" — confusing.
  it("returns kind='materialised' with msUntilHardPurge=0 when 30 days already elapsed", () => {
    const now = new Date('2026-05-08T12:00:00.000Z');
    const materialisedAt = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
    const state = deriveDeletionState({ status: 'deleted', deletedAt: materialisedAt }, now);
    expect(state.kind).toBe('materialised');
    if (state.kind === 'materialised') {
      expect(state.msUntilHardPurge).toBe(0);
    }
  });
});

describe('requestAccountDeletion — atomicity and grace overrides', () => {
  // Why this edge case matters : the `graceMs` option is exposed for tests
  // and for a hypothetical future "instant deletion" admin path. We must
  // ensure the override is honored end-to-end (not silently clamped).
  it('honors a custom graceMs option so scheduledAt = now + custom delta', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    const { scheduledAt } = await requestAccountDeletion('u1', { now, graceMs: 60_000 });

    expect(scheduledAt.toISOString()).toBe('2026-05-08T10:01:00.000Z');
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'u1', status: 'active', deletedAt: null },
      data: { deletedAt: scheduledAt },
    });
  });

  // Why this edge case matters : the atomic `updateMany` predicate is the
  // load-bearing race-prevention mechanism (J10 Phase I — code-reviewer H1).
  // If the WHERE drops `status='active'` or `deletedAt: null`, two concurrent
  // form submissions could both pass the gate. We pin the exact predicate.
  it('uses the exact (id, status=active, deletedAt=null) predicate (race-safety pin)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    await requestAccountDeletion('u_race', { now });

    const call = updateManyMock.mock.calls[0]?.[0];
    expect(call?.where).toEqual({
      id: 'u_race',
      status: 'active',
      deletedAt: null,
    });
  });
});

describe('cancelAccountDeletion — race window', () => {
  // Why this edge case matters : there is a tiny window where a user clicks
  // "Cancel" at exactly the moment the cron's `findMany` has already picked
  // up the row but hasn't issued the `update` yet. We model this by having
  // findUnique return state="active, scheduled in past" (1ms in the past) :
  // the user can still cancel, the cron's next iteration will skip the row
  // (deletedAt is now NULL → no longer matches `deletedAt <= now`).
  it('still cancels when grace has expired by 1ms but status is still active (cron not yet ran)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findUniqueMock.mockResolvedValueOnce({
      status: 'active',
      deletedAt: new Date(now.getTime() - 1),
    });
    updateMock.mockResolvedValueOnce({});

    await cancelAccountDeletion('u_race', { now });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'u_race' },
      data: { deletedAt: null },
    });
  });

  // Why this edge case matters : if the cron has already flipped status to
  // 'deleted' between the page load and the cancel click, the user must see
  // "not pending" rather than a misleading success.
  it('throws AccountDeletionNotPendingError when the cron materialised between page-load and click', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    // Page loaded showing "scheduled in 1h" but cron flipped status meanwhile.
    findUniqueMock.mockResolvedValueOnce({
      status: 'deleted',
      deletedAt: new Date(now.getTime() - 1_000),
    });

    await expect(cancelAccountDeletion('u1', { now })).rejects.toBeInstanceOf(
      AccountDeletionNotPendingError,
    );
    // Critical : update was NEVER called (no accidental restore).
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('materialisePendingDeletions — batch and PII edge cases', () => {
  // Why this edge case matters : `batchSize` is configurable for ops triage
  // (smaller batches when investigating, larger when catching up after an
  // outage). We confirm the option flows through to Prisma's `take`.
  it('honors a custom batchSize option (default is 200)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([]);

    await materialisePendingDeletions({ now, batchSize: 50 });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      }),
    );
  });

  // Why this edge case matters : two users with very similar IDs ("u1" and
  // "u11") must each end up with a distinct scrubbed email so the UNIQUE
  // constraint on User.email never collides on materialisation. The format
  // `deleted-${id}@fxmily.local` already prevents collisions because each
  // cuid is unique — we pin this property as a regression guard.
  it('produces distinct scrubbed emails for users with similar IDs (UNIQUE-safe)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    findManyMock.mockResolvedValueOnce([
      { id: 'u1', deletedAt: new Date(now.getTime() - 1) },
      { id: 'u11', deletedAt: new Date(now.getTime() - 1) },
      { id: 'u111', deletedAt: new Date(now.getTime() - 1) },
    ]);
    updateMock.mockResolvedValue({});

    await materialisePendingDeletions({ now });

    const emails = updateMock.mock.calls.map((c) => c[0]?.data?.email);
    expect(emails).toEqual([
      'deleted-u1@fxmily.local',
      'deleted-u11@fxmily.local',
      'deleted-u111@fxmily.local',
    ]);
    // All three values are distinct (UNIQUE constraint won't collide).
    expect(new Set(emails).size).toBe(3);
  });

  // Why this edge case matters : the materialisation step rewrites the
  // `deletedAt` field to `now` (overwriting the originally-scheduled time).
  // This is intentional : it gives Eliot a clean "PII scrub completed at"
  // timestamp for ops, and makes the 30d hard-purge window count from the
  // actual scrub, not from the original request. We pin this behaviour.
  it('rewrites deletedAt to `now` on materialisation (not the original schedule)', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    const originalScheduled = new Date('2026-05-07T11:00:00.000Z');
    findManyMock.mockResolvedValueOnce([{ id: 'u1', deletedAt: originalScheduled }]);
    updateMock.mockResolvedValueOnce({});

    await materialisePendingDeletions({ now });

    const data = updateMock.mock.calls[0]?.[0]?.data;
    expect(data?.deletedAt).toEqual(now);
    expect(data?.deletedAt).not.toEqual(originalScheduled);
  });
});
