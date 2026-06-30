import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action tests for the admin "Modération" tab — F5 (overhaul
 * 2026-06-30), SPEC §7.1.
 *
 * Pins the EDGE contract (the service has its own Prisma-mocked suite):
 *   - admin gate: non-admin / unauthenticated / suspended-admin → forbidden,
 *     service never touched (defense-in-depth on top of the /admin proxy gate),
 *   - the two hard guards: cannot suspend SELF, cannot suspend an ADMIN target,
 *   - the pre-flight status checks (member_not_found / already_suspended /
 *     not_suspended) short-circuit BEFORE the service,
 *   - the motif is re-validated server-side (bidi/Trojan-Source rejected),
 *   - happy paths: service → PII-FREE audit ({memberId, eventId}, no motif) →
 *     revalidate (member page + list),
 *   - the guarded-race fallback (service returns ok:false) maps to a safe error,
 *   - a thrown service error degrades to `unknown` (no leak).
 *
 * Mocks: `@/auth`, the moderation service, `@/lib/db` (target lookup),
 * `logAudit`, `next/cache`. The Zod motif schema stays REAL.
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const suspendMemberMock = vi.fn<(...args: unknown[]) => unknown>();
const reinstateMemberMock = vi.fn<(...args: unknown[]) => unknown>();
const findUniqueMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const revalidateMock = vi.fn();

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/admin/member-moderation', () => ({
  suspendMember: suspendMemberMock,
  reinstateMember: reinstateMemberMock,
}));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: findUniqueMock } } }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));

const { suspendMemberAction, reinstateMemberAction } = await import('./actions');

const ADMIN_SESSION = { user: { id: 'admin-1', role: 'admin', status: 'active' } };

/** Build a FormData payload for the motif field. */
function fd(reason?: string): FormData {
  const f = new FormData();
  if (reason !== undefined) f.set('reason', reason);
  return f;
}

beforeEach(() => {
  authMock.mockReset();
  suspendMemberMock.mockReset();
  reinstateMemberMock.mockReset();
  findUniqueMock.mockReset();
  logAuditMock.mockClear();
  revalidateMock.mockReset();

  authMock.mockResolvedValue(ADMIN_SESSION);
});

// ---------------------------------------------------------------------------
// Admin gate
// ---------------------------------------------------------------------------

describe('admin gate', () => {
  it('suspend returns forbidden for a non-admin and never touches the service', async () => {
    authMock.mockResolvedValue({ user: { id: 'm-1', role: 'member', status: 'active' } });
    const result = await suspendMemberAction('member-9', null, fd());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('forbidden');
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(suspendMemberMock).not.toHaveBeenCalled();
  });

  it('reinstate returns forbidden for an unauthenticated caller', async () => {
    authMock.mockResolvedValue(null);
    const result = await reinstateMemberAction('member-9', null, fd());
    expect(result.error).toBe('forbidden');
    expect(reinstateMemberMock).not.toHaveBeenCalled();
  });

  it('suspend returns forbidden for a SUSPENDED admin (still-valid JWT, defense-in-depth)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin', status: 'suspended' } });
    const result = await suspendMemberAction('member-9', null, fd());
    expect(result.error).toBe('forbidden');
    expect(suspendMemberMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Hard guards
// ---------------------------------------------------------------------------

describe('hard guards', () => {
  it('refuses to suspend SELF before any DB read', async () => {
    const result = await suspendMemberAction('admin-1', null, fd());
    expect(result.error).toBe('cannot_suspend_self');
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(suspendMemberMock).not.toHaveBeenCalled();
  });

  it('refuses to suspend an ADMIN target', async () => {
    findUniqueMock.mockResolvedValue({ id: 'admin-2', role: 'admin', status: 'active' });
    const result = await suspendMemberAction('admin-2', null, fd());
    expect(result.error).toBe('cannot_suspend_admin');
    expect(suspendMemberMock).not.toHaveBeenCalled();
  });

  it('rejects an empty member id (invalid_input) without a DB read', async () => {
    const result = await suspendMemberAction('', null, fd());
    expect(result.error).toBe('invalid_input');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('rejects an over-long member id (anti-DoS on the Prisma parser)', async () => {
    const result = await suspendMemberAction('x'.repeat(65), null, fd());
    expect(result.error).toBe('invalid_input');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Motif re-validation (server is the authority)
// ---------------------------------------------------------------------------

describe('motif validation', () => {
  it('rejects a motif with bidi/zero-width control chars (Trojan-Source) before any DB read', async () => {
    const result = await suspendMemberAction('member-9', null, fd('Abus‮evil'));
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors?.reason).toBeTruthy();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(suspendMemberMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// suspendMemberAction
// ---------------------------------------------------------------------------

describe('suspendMemberAction', () => {
  it('suspends an active member, audits PII-FREE, and revalidates both surfaces', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', role: 'member', status: 'active' });
    suspendMemberMock.mockResolvedValue({ ok: true, event: { id: 'evt-1' } });

    const result = await suspendMemberAction('member-9', null, fd('Spam répété'));

    expect(result.ok).toBe(true);
    expect(suspendMemberMock).toHaveBeenCalledWith({
      memberId: 'member-9',
      actorId: 'admin-1',
      reason: 'Spam répété',
    });
    // Audit carries NO motif — only ids (the free text lives in the event row).
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'admin.member.suspended',
      userId: 'admin-1',
      metadata: { memberId: 'member-9', eventId: 'evt-1' },
    });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/members/member-9');
    expect(revalidateMock).toHaveBeenCalledWith('/admin/members');
  });

  it('normalises an empty/whitespace motif to null (suspend "sans motif")', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', role: 'member', status: 'active' });
    suspendMemberMock.mockResolvedValue({ ok: true, event: { id: 'evt-2' } });

    await suspendMemberAction('member-9', null, fd('   '));

    expect(suspendMemberMock).toHaveBeenCalledWith({
      memberId: 'member-9',
      actorId: 'admin-1',
      reason: null,
    });
  });

  it('returns member_not_found when the target does not exist (no service call)', async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await suspendMemberAction('ghost', null, fd());
    expect(result.error).toBe('member_not_found');
    expect(suspendMemberMock).not.toHaveBeenCalled();
  });

  it('returns already_suspended when the target is not active (pre-flight)', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', role: 'member', status: 'suspended' });
    const result = await suspendMemberAction('member-9', null, fd());
    expect(result.error).toBe('already_suspended');
    expect(suspendMemberMock).not.toHaveBeenCalled();
  });

  it('maps a lost guarded race (service ok:false) to already_suspended, no audit', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', role: 'member', status: 'active' });
    suspendMemberMock.mockResolvedValue({ ok: false, reason: 'not_active' });

    const result = await suspendMemberAction('member-9', null, fd());

    expect(result.error).toBe('already_suspended');
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('degrades a thrown service error to unknown (no leak, no audit)', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', role: 'member', status: 'active' });
    suspendMemberMock.mockRejectedValue(new Error('pool exhausted'));

    const result = await suspendMemberAction('member-9', null, fd());

    expect(result.error).toBe('unknown');
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reinstateMemberAction
// ---------------------------------------------------------------------------

describe('reinstateMemberAction', () => {
  it('reinstates a suspended member, audits PII-FREE, and revalidates', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', status: 'suspended' });
    reinstateMemberMock.mockResolvedValue({ ok: true, event: { id: 'evt-3' } });

    const result = await reinstateMemberAction('member-9', null, fd('Reprise'));

    expect(result.ok).toBe(true);
    expect(reinstateMemberMock).toHaveBeenCalledWith({
      memberId: 'member-9',
      actorId: 'admin-1',
      reason: 'Reprise',
    });
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'admin.member.reinstated',
      userId: 'admin-1',
      metadata: { memberId: 'member-9', eventId: 'evt-3' },
    });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/members/member-9');
    expect(revalidateMock).toHaveBeenCalledWith('/admin/members');
  });

  it('returns not_suspended when the target is active (pre-flight, no service call)', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', status: 'active' });
    const result = await reinstateMemberAction('member-9', null, fd());
    expect(result.error).toBe('not_suspended');
    expect(reinstateMemberMock).not.toHaveBeenCalled();
  });

  it('returns member_not_found when the target does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await reinstateMemberAction('ghost', null, fd());
    expect(result.error).toBe('member_not_found');
    expect(reinstateMemberMock).not.toHaveBeenCalled();
  });

  it('maps a lost guarded race (service ok:false) to not_suspended', async () => {
    findUniqueMock.mockResolvedValue({ id: 'member-9', status: 'suspended' });
    reinstateMemberMock.mockResolvedValue({ ok: false, reason: 'not_suspended' });

    const result = await reinstateMemberAction('member-9', null, fd());

    expect(result.error).toBe('not_suspended');
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
