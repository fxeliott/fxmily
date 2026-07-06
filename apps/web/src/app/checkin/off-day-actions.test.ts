import { beforeEach, describe, expect, it, vi } from 'vitest';

// The REAL timezone helpers — the test computes member-local dates exactly like
// the action does, so window assertions match without pinning a literal date.
// Imported statically (not via `await import`) so the binding is a real function.
import { localDateOf, shiftLocalDate } from '@/lib/checkin/timezone';

/**
 * Tour 14 — Server Action tests for the "jour off" surface.
 *
 * `declareOffDayAction` / `cancelOffDayAction` are the two member write paths for
 * an off-day declaration. We mock the auth session, the Prisma `memberOffDay`
 * writes, the audit logger and `revalidatePath` so the auth gate / validation /
 * window / persistence branches are hit deterministically without a DB.
 *
 * Dates are computed RELATIVE to the member's local "today" (Europe/Paris via the
 * real, unmocked timezone helpers) so the tests never go stale as the calendar
 * moves — a fixed literal would drift past the +30-day window over time.
 */

const authMock = vi.fn();
// Typed with a permissive arg so `mock.calls[n][0]` narrows to the Prisma
// where/create/update payload the assertions read (a zero-arg `vi.fn` freezes
// the call tuple to `[]`, which TS then rejects at `[0]`).
const upsertMock = vi.fn(async (_args: unknown) => ({}));
const deleteManyMock = vi.fn(async (_args: unknown) => ({ count: 1 }));
const userUpdateMock = vi.fn(async (_args: unknown) => ({}));
// `$transaction(ops[])` receives the array of already-invoked upsert promises;
// it just awaits them all (mirroring Prisma's array form).
const transactionMock = vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
const logAuditMock = vi.fn(async (_args: unknown) => undefined);
const revalidatePathMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db', () => ({
  db: {
    memberOffDay: { upsert: upsertMock, deleteMany: deleteManyMock },
    user: { update: userUpdateMock },
    $transaction: transactionMock,
  },
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('@/lib/observability', () => ({
  reportWarning: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

const {
  declareOffDayAction,
  cancelOffDayAction,
  declareOffDayRangeAction,
  updateWeekendsOffAction,
} = await import('./off-day-actions');

const TZ = 'Europe/Paris';
const today = () => localDateOf(new Date(), TZ);

beforeEach(() => {
  authMock.mockReset();
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({});
  deleteManyMock.mockReset();
  deleteManyMock.mockResolvedValue({ count: 1 });
  userUpdateMock.mockReset();
  userUpdateMock.mockResolvedValue({});
  transactionMock.mockClear();
  logAuditMock.mockClear();
  revalidatePathMock.mockClear();
});

function activeSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: 'usr_1', status: 'active', timezone: TZ, ...overrides } };
}

describe('declareOffDayAction', () => {
  it('fails unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await declareOffDayAction(today());
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('fails unauthorized when the member is suspended', async () => {
    authMock.mockResolvedValueOnce(activeSession({ status: 'suspended' }));
    const result = await declareOffDayAction(today());
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('defaults to TODAY (member-local) when no date is passed', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await declareOffDayAction();
    expect(result).toEqual({ ok: true, date: today() });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const arg = upsertMock.mock.calls[0]?.[0] as {
      where: { userId_date: { userId: string; date: Date } };
      create: { userId: string; date: Date; reason: string | null };
    };
    expect(arg.where.userId_date.userId).toBe('usr_1');
    // Stored as the UTC-midnight pin of the civil day (@db.Date).
    expect(arg.where.userId_date.date.toISOString().slice(0, 10)).toBe(today());
    expect(arg.create.reason).toBeNull();
  });

  it('upserts (idempotent), audits PII-free and revalidates on the happy path', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const date = shiftLocalDate(today(), 3);
    const result = await declareOffDayAction(date, 'Congés');

    expect(result).toEqual({ ok: true, date });
    const arg = upsertMock.mock.calls[0]?.[0] as {
      create: { reason: string | null };
      update: { reason: string | null };
    };
    // The reason is sanitised + persisted on both create and update paths.
    expect(arg.create.reason).toBe('Congés');
    expect(arg.update.reason).toBe('Congés');
    // Audit carries the opaque date + a boolean, NEVER the free-text reason.
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'checkin.off_day.declared',
        userId: 'usr_1',
        metadata: { date, hasReason: true },
      }),
    );
    const auditArg = logAuditMock.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(JSON.stringify(auditArg.metadata)).not.toContain('Congés');
    expect(revalidatePathMock).toHaveBeenCalledWith('/checkin');
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard');
  });

  it('rejects a PAST day before touching the DB (TZ-aware window)', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const yesterday = shiftLocalDate(today(), -1);
    const result = await declareOffDayAction(yesterday);
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('rejects a day beyond the +30-day horizon before touching the DB', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const tooFar = shiftLocalDate(today(), 45);
    const result = await declareOffDayAction(tooFar);
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed date', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await declareOffDayAction('not-a-date');
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects a reason carrying bidi / zero-width control characters', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    // U+202E RIGHT-TO-LEFT OVERRIDE hidden in the reason.
    const result = await declareOffDayAction(today(), 'repos‮malveillant');
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('surfaces an unknown error and does NOT audit when the upsert throws', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    upsertMock.mockRejectedValueOnce(new Error('db down'));
    const result = await declareOffDayAction(today());
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe('cancelOffDayAction', () => {
  it('fails unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await cancelOffDayAction(today());
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it('deletes (scoped to the member), audits and revalidates on the happy path', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const date = shiftLocalDate(today(), 2);
    const result = await cancelOffDayAction(date);

    expect(result).toEqual({ ok: true, date });
    const arg = deleteManyMock.mock.calls[0]?.[0] as {
      where: { userId: string; date: Date };
    };
    // BOLA-safe: the delete is keyed on the authenticated id, never a param.
    expect(arg.where.userId).toBe('usr_1');
    expect(arg.where.date.toISOString().slice(0, 10)).toBe(date);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'checkin.off_day.cancelled',
        userId: 'usr_1',
        metadata: { date },
      }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/checkin');
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard');
  });

  it('is idempotent — cancelling a day that was never off is a no-op success', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    // deleteMany returns count 0 (nothing to delete) but never throws → ok.
    deleteManyMock.mockResolvedValueOnce({ count: 0 });
    const result = await cancelOffDayAction(today());
    expect(result).toEqual({ ok: true, date: today() });
  });

  it('rejects a malformed date before touching the DB', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await cancelOffDayAction('nope');
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it('surfaces an unknown error when the delete throws', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    deleteManyMock.mockRejectedValueOnce(new Error('db down'));
    const result = await cancelOffDayAction(today());
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  // Review P2 (Tour 14) — cancelling is allowed up to 7 days into the past so a
  // recent mislabelled off day can be corrected; declaring stays forward-only.
  it('allows cancelling a PAST off day within the 7-day back window (-3 days)', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const threeDaysAgo = shiftLocalDate(today(), -3);
    const result = await cancelOffDayAction(threeDaysAgo);
    expect(result).toEqual({ ok: true, date: threeDaysAgo });
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
  });

  it('rejects cancelling beyond the 7-day back window (-8 days)', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const eightDaysAgo = shiftLocalDate(today(), -8);
    const result = await cancelOffDayAction(eightDaysAgo);
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });
});

describe('declareOffDayRangeAction', () => {
  it('fails unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await declareOffDayRangeAction(today(), shiftLocalDate(today(), 2));
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('upserts one row per day of the inclusive span in a single transaction', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const from = shiftLocalDate(today(), 1);
    const to = shiftLocalDate(today(), 4); // 4 inclusive days
    const result = await declareOffDayRangeAction(from, to, 'Vacances');

    // Tour 15 — the action returns the written days with server-formatted
    // labels so the client list updates immediately (no reload needed).
    expect(result).toEqual({
      ok: true,
      from,
      to,
      days: 4,
      upcoming: [0, 1, 2, 3].map((i) => ({
        date: shiftLocalDate(from, i),
        label: expect.stringMatching(/^[a-zéû]+ \d{1,2} [a-zéû]+$/) as unknown as string,
        reason: 'Vacances',
      })),
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(4);
    // Each upsert is member-scoped and carries the shared sanitised reason.
    const firstArg = upsertMock.mock.calls[0]?.[0] as {
      where: { userId_date: { userId: string; date: Date } };
      create: { reason: string | null };
    };
    expect(firstArg.where.userId_date.userId).toBe('usr_1');
    expect(firstArg.create.reason).toBe('Vacances');
    // Audit is PII-free: bounds + count + boolean, never the reason text.
    const auditArg = logAuditMock.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(auditArg.metadata).toEqual({ from, to, days: 4, hasReason: true });
    expect(JSON.stringify(auditArg.metadata)).not.toContain('Vacances');
  });

  it('accepts a single-day span (from === to)', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const d = shiftLocalDate(today(), 2);
    const result = await declareOffDayRangeAction(d, d);
    expect(result).toEqual({
      ok: true,
      from: d,
      to: d,
      days: 1,
      upcoming: [{ date: d, label: expect.any(String) as unknown as string, reason: null }],
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an inverted range (from after to) before touching the DB', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await declareOffDayRangeAction(
      shiftLocalDate(today(), 4),
      shiftLocalDate(today(), 1),
    );
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects a range that starts in the past', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await declareOffDayRangeAction(
      shiftLocalDate(today(), -1),
      shiftLocalDate(today(), 2),
    );
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects a span longer than a month before touching the DB', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    // from today → +40 days = 41 inclusive days > the 31-day cap.
    const result = await declareOffDayRangeAction(today(), shiftLocalDate(today(), 40));
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rolls back and surfaces unknown when the transaction throws', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    transactionMock.mockRejectedValueOnce(new Error('db down'));
    const result = await declareOffDayRangeAction(today(), shiftLocalDate(today(), 2));
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('updateWeekendsOffAction', () => {
  it('fails unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await updateWeekendsOffAction(false);
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('persists the toggle, audits and revalidates on the happy path', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await updateWeekendsOffAction(false);
    expect(result).toEqual({ ok: true, weekendsOff: false });
    const arg = userUpdateMock.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { weekendsOff: boolean };
    };
    expect(arg.where.id).toBe('usr_1');
    expect(arg.data.weekendsOff).toBe(false);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'checkin.off_day.weekends_updated',
        userId: 'usr_1',
        metadata: { weekendsOff: false },
      }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/account');
  });

  it('surfaces an unknown error when the update throws', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    userUpdateMock.mockRejectedValueOnce(new Error('db down'));
    const result = await updateWeekendsOffAction(true);
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
