import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J10 Phase A — Server Action tests for /account/delete.
 *
 * These actions are the only entry-point that combines the auth gate, the
 * confirmation phrase guard, and the deletion service. We mock the auth
 * session, the deletion service, the audit logger and `revalidatePath` so
 * each `RequestActionResult` / `CancelActionResult` branch is hit
 * deterministically.
 *
 * Why this surface deserves its own tests : the page maps each error code
 * to a distinct UI banner. A regression here ships the wrong message to a
 * member trying to delete their account — a high-trust moment.
 */

const authMock = vi.fn();
const requestAccountDeletionMock = vi.fn();
const cancelAccountDeletionMock = vi.fn();
const logAuditMock = vi.fn(async () => undefined);
const revalidatePathMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: authMock,
}));

// Mock @/lib/account/deletion to drive the service-layer branches without
// touching the DB. We re-export the real error classes so `instanceof` checks
// in the SUT still work.
vi.mock('@/lib/account/deletion', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/account/deletion')>('@/lib/account/deletion');
  return {
    ...actual,
    requestAccountDeletion: requestAccountDeletionMock,
    cancelAccountDeletion: cancelAccountDeletionMock,
  };
});

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

const { requestAccountDeletionAction, cancelAccountDeletionAction } = await import('./actions');
const { AccountDeletionAlreadyRequestedError, AccountDeletionNotPendingError } =
  await import('@/lib/account/deletion');

beforeEach(() => {
  authMock.mockReset();
  requestAccountDeletionMock.mockReset();
  cancelAccountDeletionMock.mockReset();
  logAuditMock.mockClear();
  revalidatePathMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeForm(confirmation: string | null): FormData {
  const fd = new FormData();
  if (confirmation !== null) fd.set('confirmation', confirmation);
  return fd;
}

describe('requestAccountDeletionAction', () => {
  // Why this matters : the action gates on `session.user.status === 'active'`.
  // A logged-out user (no session) must NEVER trigger the deletion service —
  // returning 'unauthorized' before any side effect.
  it("returns { ok: false, error: 'unauthorized' } when no session is present", async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await requestAccountDeletionAction(makeForm('SUPPRIMER'));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    // Critical : the deletion service was NOT called.
    expect(requestAccountDeletionMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  // Why this matters : a user whose status is 'deleted' (already materialised)
  // must NOT be allowed to re-trigger the service. The action must reject
  // with 'unauthorized' (same UI message — they shouldn't be here at all).
  it("returns 'unauthorized' when the session user status is not 'active' (e.g. already deleted)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'deleted' } });

    const result = await requestAccountDeletionAction(makeForm('SUPPRIMER'));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(requestAccountDeletionMock).not.toHaveBeenCalled();
  });

  // Why this matters : the type-to-confirm UX is the only anti-impulsivity
  // gate before the 24h grace timer starts. Wrong phrase → 'bad_confirmation'
  // and NO call to the service. We test multiple wrong-input shapes.
  it("returns 'bad_confirmation' when the typed phrase does not match SUPPRIMER", async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', status: 'active' } });

    expect(await requestAccountDeletionAction(makeForm('supprimer'))).toEqual({
      ok: false,
      error: 'bad_confirmation',
    });
    expect(await requestAccountDeletionAction(makeForm(''))).toEqual({
      ok: false,
      error: 'bad_confirmation',
    });
    expect(await requestAccountDeletionAction(makeForm(null))).toEqual({
      ok: false,
      error: 'bad_confirmation',
    });
    expect(await requestAccountDeletionAction(makeForm('DELETE'))).toEqual({
      ok: false,
      error: 'bad_confirmation',
    });
    expect(requestAccountDeletionMock).not.toHaveBeenCalled();
  });

  // Why this matters : the action must trim whitespace on the confirmation
  // (a member typing on a phone keyboard often gets a trailing space from
  // autocorrect). "SUPPRIMER " (trailing space) MUST still pass the gate.
  it('accepts the confirmation phrase with surrounding whitespace (mobile autocorrect)', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'active' } });
    requestAccountDeletionMock.mockResolvedValueOnce({
      scheduledAt: new Date('2026-05-09T10:00:00.000Z'),
    });

    const result = await requestAccountDeletionAction(makeForm('  SUPPRIMER  '));

    expect(result).toEqual({ ok: true });
    expect(requestAccountDeletionMock).toHaveBeenCalledWith('u1');
  });

  // Why this matters : the happy path must trigger the service, log the
  // audit row with the scheduledAt ISO, and revalidate the page so the
  // banner switches to "scheduled in 24h".
  it('returns { ok: true }, logs audit, and revalidates the page on success', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'active' } });
    const scheduledAt = new Date('2026-05-09T10:00:00.000Z');
    requestAccountDeletionMock.mockResolvedValueOnce({ scheduledAt });

    const result = await requestAccountDeletionAction(makeForm('SUPPRIMER'));

    expect(result).toEqual({ ok: true });
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'account.deletion.requested',
      userId: 'u1',
      metadata: { scheduledAt: scheduledAt.toISOString() },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/account/delete');
  });

  // Why this matters : the action specifically maps
  // AccountDeletionAlreadyRequestedError to the 'already_requested' UI
  // branch. A regression that swallowed the error class would surface a
  // generic 500 to a member who legitimately re-clicked.
  it("returns 'already_requested' when the service throws AccountDeletionAlreadyRequestedError", async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'active' } });
    requestAccountDeletionMock.mockRejectedValueOnce(new AccountDeletionAlreadyRequestedError());

    const result = await requestAccountDeletionAction(makeForm('SUPPRIMER'));

    expect(result).toEqual({ ok: false, error: 'already_requested' });
    // No audit row : we already logged the FIRST request, no need to spam.
    expect(logAuditMock).not.toHaveBeenCalled();
    // No revalidate : nothing to refresh, the page already reflects state.
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // Why this matters : any unrecognised error must propagate to the Next.js
  // error boundary so ops sees it in Sentry. We must NOT silently swallow
  // a real bug into a friendly error code.
  it('rethrows unknown errors so they bubble to the error boundary', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'active' } });
    requestAccountDeletionMock.mockRejectedValueOnce(new Error('unexpected DB outage'));

    await expect(requestAccountDeletionAction(makeForm('SUPPRIMER'))).rejects.toThrow(
      /unexpected DB outage/,
    );
  });
});

describe('cancelAccountDeletionAction', () => {
  // Why this matters : same auth gate as the request action — no session →
  // no side effect. Critical because cancellation is a state transition.
  it("returns 'unauthorized' when no session is present", async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await cancelAccountDeletionAction();

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(cancelAccountDeletionMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  // Why this matters : if the cron flipped status to 'deleted' between page
  // load and click, the session.user.status check should reject. This guards
  // against the race where the user keeps a stale tab open past materialisation.
  it("returns 'unauthorized' when status is no longer 'active' (post-materialisation)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'deleted' } });

    const result = await cancelAccountDeletionAction();

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(cancelAccountDeletionMock).not.toHaveBeenCalled();
  });

  // Why this matters : happy path — service called, audit logged, path
  // revalidated so the page switches back to "active" state.
  it('returns { ok: true } and logs audit on successful cancellation', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'active' } });
    cancelAccountDeletionMock.mockResolvedValueOnce(undefined);

    const result = await cancelAccountDeletionAction();

    expect(result).toEqual({ ok: true });
    expect(cancelAccountDeletionMock).toHaveBeenCalledWith('u1');
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'account.deletion.cancelled',
      userId: 'u1',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/account/delete');
  });

  // Why this matters : if the user never scheduled a deletion (or already
  // cancelled), the service throws AccountDeletionNotPendingError which the
  // action MUST map to 'not_pending'. A misclassified error here would
  // ship a confusing "deletion cancelled" toast to a user who never deleted.
  it("returns 'not_pending' when the service throws AccountDeletionNotPendingError", async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'active' } });
    cancelAccountDeletionMock.mockRejectedValueOnce(new AccountDeletionNotPendingError());

    const result = await cancelAccountDeletionAction();

    expect(result).toEqual({ ok: false, error: 'not_pending' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // Why this matters : same as the request action — unknown errors must
  // bubble up rather than become a friendly false-success.
  it('rethrows unknown errors so they bubble to the error boundary', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'active' } });
    cancelAccountDeletionMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(cancelAccountDeletionAction()).rejects.toThrow(/connection refused/);
  });
});
