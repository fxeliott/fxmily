import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2.5 — Server Action tests for the admin access-request queue.
 *
 * Pins: the admin gate (non-admin → forbidden, no service call), the approve
 * happy path (service → email → audit → revalidate), the delete-on-email-
 * failure rollback, the reject path, and PII-free audit metadata.
 *
 * We mock `@/auth`, the service, the email send, logAudit, and
 * `next/cache.revalidatePath`.
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const approveMock = vi.fn<(...args: unknown[]) => unknown>();
const rejectMock = vi.fn<(...args: unknown[]) => unknown>();
const rollbackMock = vi.fn<(...args: unknown[]) => unknown>();
const sendEmailMock = vi.fn<(...args: unknown[]) => unknown>();
const sendRejectedEmailMock = vi.fn<(...args: unknown[]) => unknown>();
const reportWarningMock = vi.fn();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const revalidateMock = vi.fn();

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/access-request/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/access-request/service')>(
    '@/lib/access-request/service',
  );
  return {
    ...actual,
    approveAccessRequest: approveMock,
    rejectAccessRequest: rejectMock,
    rollbackApproval: rollbackMock,
  };
});

vi.mock('@/lib/email/send', () => ({
  sendAccessApprovedEmail: sendEmailMock,
  sendAccessRejectedEmail: sendRejectedEmailMock,
}));
vi.mock('@/lib/observability', () => ({ reportWarning: reportWarningMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));

const { approveAccessRequestAction, rejectAccessRequestAction } = await import('./actions');
const { AccessRequestNotPendingError, AccessRequestUserExistsError } =
  await import('@/lib/access-request/service');

const ADMIN_SESSION = { user: { id: 'admin-1', role: 'admin', status: 'active' } };

beforeEach(() => {
  authMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
  rollbackMock.mockReset();
  sendEmailMock.mockReset();
  sendRejectedEmailMock.mockReset();
  reportWarningMock.mockReset();
  logAuditMock.mockClear();
  revalidateMock.mockReset();

  authMock.mockResolvedValue(ADMIN_SESSION);
});

// ---------------------------------------------------------------------------
// Admin gate
// ---------------------------------------------------------------------------

describe('admin gate', () => {
  it('approve returns forbidden for a non-admin and never touches the service', async () => {
    authMock.mockResolvedValue({ user: { id: 'm-1', role: 'member' } });
    const result = await approveAccessRequestAction('ar-1');
    expect(result.error).toBe('forbidden');
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('reject returns forbidden for an unauthenticated caller', async () => {
    authMock.mockResolvedValue(null);
    const result = await rejectAccessRequestAction('ar-1');
    expect(result.error).toBe('forbidden');
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('approve returns forbidden for a suspended admin (defense-in-depth, even with a still-valid JWT)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin', status: 'suspended' } });
    const result = await approveAccessRequestAction('ar-1');
    expect(result.error).toBe('forbidden');
    expect(approveMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// approveAccessRequestAction
// ---------------------------------------------------------------------------

describe('approveAccessRequestAction', () => {
  it('approves, sends the email, audits PII-free, and revalidates', async () => {
    approveMock.mockResolvedValue({
      invitationId: 'inv-1',
      plainToken: 'tok',
      expiresAt: new Date('2026-06-14T12:00:00Z'),
      email: 'eliot@fxmilyapp.com',
      firstName: 'Eliot',
    });
    sendEmailMock.mockResolvedValue({ id: 'email-1', delivered: true });

    const result = await approveAccessRequestAction('ar-1');

    expect(result.ok).toBe(true);
    expect(approveMock).toHaveBeenCalledWith('ar-1', 'admin-1');
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'eliot@fxmilyapp.com',
      firstName: 'Eliot',
      plainToken: 'tok',
      expiresAt: new Date('2026-06-14T12:00:00Z'),
    });
    // Audit PII-free: requestId only, no email/name.
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'access_request.approved',
      userId: 'admin-1',
      metadata: { requestId: 'ar-1' },
    });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/access-requests');
    expect(rollbackMock).not.toHaveBeenCalled();
  });

  it('rolls back (delete invitation + revert to pending) when the email fails', async () => {
    approveMock.mockResolvedValue({
      invitationId: 'inv-1',
      plainToken: 'tok',
      expiresAt: new Date('2026-06-14T12:00:00Z'),
      email: 'eliot@fxmilyapp.com',
      firstName: 'Eliot',
    });
    sendEmailMock.mockRejectedValue(new Error('Resend down'));
    rollbackMock.mockResolvedValue(undefined);

    const result = await approveAccessRequestAction('ar-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('email_failed');
    expect(rollbackMock).toHaveBeenCalledWith('ar-1', 'inv-1');
    // No success audit row when the approval is rolled back.
    expect(logAuditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access_request.approved' }),
    );
  });

  it('reports a PII-free warning when the rollback ITSELF fails (stranded-approval observability)', async () => {
    approveMock.mockResolvedValue({
      invitationId: 'inv-1',
      plainToken: 'tok',
      expiresAt: new Date('2026-06-14T12:00:00Z'),
      email: 'eliot@fxmilyapp.com',
      firstName: 'Eliot',
    });
    sendEmailMock.mockRejectedValue(new Error('Resend down'));
    // Correlated failure: the rollback transaction also throws (e.g. pool
    // saturated by the same infra incident). The request would be stranded
    // 'approved' + invisible — so it MUST be observed, not swallowed.
    rollbackMock.mockRejectedValue(new Error('pool exhausted'));

    const result = await approveAccessRequestAction('ar-1');

    expect(result.error).toBe('email_failed');
    expect(reportWarningMock).toHaveBeenCalledWith(
      'access-request.approve',
      'rollback_failed',
      expect.objectContaining({ requestId: 'ar-1' }),
    );
  });

  it('surfaces not_pending when the service rejects an already-resolved request', async () => {
    approveMock.mockRejectedValue(new AccessRequestNotPendingError());
    const result = await approveAccessRequestAction('ar-1');
    expect(result.error).toBe('not_pending');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('surfaces user_exists when the email already belongs to a member', async () => {
    approveMock.mockRejectedValue(new AccessRequestUserExistsError());
    const result = await approveAccessRequestAction('ar-1');
    expect(result.error).toBe('user_exists');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rejectAccessRequestAction
// ---------------------------------------------------------------------------

describe('rejectAccessRequestAction', () => {
  it('rejects, sends the refusal email (§26.4), audits PII-free, and revalidates', async () => {
    rejectMock.mockResolvedValue({ email: 'ana@example.com', firstName: 'Ana' });
    sendRejectedEmailMock.mockResolvedValue({ id: 'email-1', delivered: true });

    const result = await rejectAccessRequestAction('ar-1');

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Demande refusée — email envoyé.');
    expect(rejectMock).toHaveBeenCalledWith('ar-1', 'admin-1');
    // §26.4 — refusal email goes to the requester with their first name.
    expect(sendRejectedEmailMock).toHaveBeenCalledWith({
      to: 'ana@example.com',
      firstName: 'Ana',
    });
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'access_request.rejected',
      userId: 'admin-1',
      metadata: { requestId: 'ar-1' },
    });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/access-requests');
  });

  it('still rejects (best-effort email) when the refusal email fails — no rollback, warning observed', async () => {
    rejectMock.mockResolvedValue({ email: 'ana@example.com', firstName: 'Ana' });
    sendRejectedEmailMock.mockRejectedValue(new Error('Resend down'));

    const result = await rejectAccessRequestAction('ar-1');

    // A rejection is terminal: an email hiccup must NOT undo it.
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Demande refusée.');
    expect(reportWarningMock).toHaveBeenCalledWith(
      'access-request.reject',
      'rejection_email_failed',
      expect.objectContaining({ requestId: 'ar-1' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'access_request.rejected',
      userId: 'admin-1',
      metadata: { requestId: 'ar-1' },
    });
  });

  it('surfaces not_pending when the request was already resolved (no email)', async () => {
    rejectMock.mockRejectedValue(new AccessRequestNotPendingError());
    const result = await rejectAccessRequestAction('ar-1');
    expect(result.error).toBe('not_pending');
    expect(sendRejectedEmailMock).not.toHaveBeenCalled();
  });
});
