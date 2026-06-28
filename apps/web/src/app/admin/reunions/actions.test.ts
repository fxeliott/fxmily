import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.7 §30 J-M3 — Server Action tests for `/admin/reunions` cancel/uncancel.
 *
 * Pattern carbone J-M2 `app/reunions/actions.test.ts`. All module-level deps
 * mocked BEFORE importing the SUT. We pin the auth + role gates, Zod rejection,
 * cancel/uncancel happy paths, the not-found mapping (duck-typed), and — the
 * load-bearing posture invariant — that the audit row is PII-FREE (meetingId +
 * resulting state ONLY, NEVER the reason free-text, SPEC §30.7).
 */

const authMock = vi.fn();
const logAuditMock = vi.fn();
const cancelMeetingMock = vi.fn();
const uncancelMeetingMock = vi.fn();
const markMeetingPresenceMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
// Only VALUE exports are mocked. The action duck-types MeetingNotFoundError /
// MeetingPresenceNotMarkableError on `name` (never imports the class value), so
// the mock stays minimal.
vi.mock('@/lib/meeting/service', () => ({
  cancelMeeting: cancelMeetingMock,
  uncancelMeeting: uncancelMeetingMock,
  markMeetingPresence: markMeetingPresenceMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

const { cancelMeetingAction, markPresenceAction } = await import('./actions');

afterEach(() => {
  authMock.mockReset();
  logAuditMock.mockReset();
  cancelMeetingMock.mockReset();
  uncancelMeetingMock.mockReset();
  markMeetingPresenceMock.mockReset();
  revalidatePathMock.mockReset();
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ADMIN_SESSION = {
  user: { id: 'admin_1', status: 'active' as const, role: 'admin' as const },
};

describe('cancelMeetingAction — auth + role gate (defence in depth)', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'cancel' }),
    );

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(cancelMeetingMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when status is not "active"', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'admin_1', status: 'suspended', role: 'admin' } });

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'cancel' }),
    );

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(cancelMeetingMock).not.toHaveBeenCalled();
  });

  it('returns forbidden when the user is not an admin', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'member_1', status: 'active', role: 'member' } });

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'cancel' }),
    );

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(cancelMeetingMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('cancelMeetingAction — Zod safeParse rejection', () => {
  it('returns invalid_input when action is outside the enum', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'nuke' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('action');
    expect(cancelMeetingMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input when meetingId is missing', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);

    const result = await cancelMeetingAction(null, makeFormData({ action: 'cancel' }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('meetingId');
  });
});

describe('cancelMeetingAction — cancel happy path (PII-free audit)', () => {
  it('cancels, passes the reason to the service, audits {meetingId, cancelled} only', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    cancelMeetingMock.mockResolvedValueOnce({ id: 'm1', status: 'cancelled' });

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'cancel', reason: 'Pas dispo aujourd’hui' }),
    );

    expect(result).toEqual({ ok: true, status: 'cancelled' });

    // The reason FLOWS TO the service (safeFreeText sanitises it there)…
    expect(cancelMeetingMock).toHaveBeenCalledTimes(1);
    expect(cancelMeetingMock).toHaveBeenCalledWith('m1', 'Pas dispo aujourd’hui');
    expect(uncancelMeetingMock).not.toHaveBeenCalled();

    // …but it NEVER reaches the audit log (posture §2, PII-free §30.7).
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'admin.meeting.cancelled',
      userId: 'admin_1',
      metadata: { meetingId: 'm1', cancelled: true },
    });
    const auditArg = logAuditMock.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(JSON.stringify(auditArg.metadata)).not.toContain('dispo');

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/reunions');
  });

  it('omits an empty reason so the service gets undefined (clears the note)', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    cancelMeetingMock.mockResolvedValueOnce({ id: 'm1', status: 'cancelled' });

    await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'cancel', reason: '' }),
    );

    expect(cancelMeetingMock).toHaveBeenCalledWith('m1', undefined);
  });
});

describe('cancelMeetingAction — uncancel happy path', () => {
  it('uncancels, audits cancelled:false, revalidates', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    uncancelMeetingMock.mockResolvedValueOnce({ id: 'm1', status: 'scheduled' });

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'uncancel' }),
    );

    expect(result).toEqual({ ok: true, status: 'scheduled' });
    expect(uncancelMeetingMock).toHaveBeenCalledWith('m1');
    expect(cancelMeetingMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'admin.meeting.cancelled',
      userId: 'admin_1',
      metadata: { meetingId: 'm1', cancelled: false },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/reunions');
  });
});

describe('cancelMeetingAction — not-found mapping (duck-typed)', () => {
  it('maps MeetingNotFoundError to not_found, no audit / revalidate', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    cancelMeetingMock.mockRejectedValueOnce(
      Object.assign(new Error('Meeting not found: m1'), { name: 'MeetingNotFoundError' }),
    );

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'cancel' }),
    );

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe('cancelMeetingAction — unexpected service failure', () => {
  it('returns unknown and does NOT audit / revalidate', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    cancelMeetingMock.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await cancelMeetingAction(
      null,
      makeFormData({ meetingId: 'm1', action: 'cancel' }),
    );

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();

    consoleErrSpy.mockRestore();
  });
});

// S10 §30.8 — markPresenceAction (recoupement admin↔membre) -------------------

describe('markPresenceAction — auth + role gate', () => {
  it('returns unauthorized without a session, never writes', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'present' }),
    );

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(markMeetingPresenceMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns forbidden for a non-admin', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'mem1', status: 'active', role: 'member' } });

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'present' }),
    );

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(markMeetingPresenceMock).not.toHaveBeenCalled();
  });
});

describe('markPresenceAction — Zod rejection', () => {
  it('rejects an invalid present value', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'maybe' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('present');
    expect(markMeetingPresenceMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('rejects a missing memberId', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', present: 'present' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('memberId');
  });
});

describe('markPresenceAction — happy paths (PII-free audit)', () => {
  it('present → marks true, audits {meetingId, present:true}, revalidates the surfaces', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    markMeetingPresenceMock.mockResolvedValueOnce({
      meetingId: 'm1',
      memberId: 'mem1',
      adminPresent: true,
    });

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'present' }),
    );

    expect(result).toEqual({ ok: true, adminPresent: true });
    expect(markMeetingPresenceMock).toHaveBeenCalledWith('admin_1', 'm1', 'mem1', true);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'admin.meeting.presence.marked',
      userId: 'admin_1',
      metadata: { meetingId: 'm1', present: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/members/mem1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/reunions');
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/health');
  });

  it('absent → marks false', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    markMeetingPresenceMock.mockResolvedValueOnce({
      meetingId: 'm1',
      memberId: 'mem1',
      adminPresent: false,
    });

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'absent' }),
    );

    expect(result).toEqual({ ok: true, adminPresent: false });
    expect(markMeetingPresenceMock).toHaveBeenCalledWith('admin_1', 'm1', 'mem1', false);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'admin.meeting.presence.marked',
      userId: 'admin_1',
      metadata: { meetingId: 'm1', present: false },
    });
  });

  it('clear → marks null', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    markMeetingPresenceMock.mockResolvedValueOnce({
      meetingId: 'm1',
      memberId: 'mem1',
      adminPresent: null,
    });

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'clear' }),
    );

    expect(result).toEqual({ ok: true, adminPresent: null });
    expect(markMeetingPresenceMock).toHaveBeenCalledWith('admin_1', 'm1', 'mem1', null);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'admin.meeting.presence.marked',
      userId: 'admin_1',
      metadata: { meetingId: 'm1', present: null },
    });
  });
});

describe('markPresenceAction — error mapping (duck-typed)', () => {
  it.each([['not_found'], ['cancelled'], ['member_not_found']] as const)(
    'maps MeetingPresenceNotMarkableError reason=%s, no audit',
    async (reason) => {
      authMock.mockResolvedValueOnce(ADMIN_SESSION);
      markMeetingPresenceMock.mockRejectedValueOnce(
        Object.assign(new Error(`Meeting presence not markable: ${reason}`), {
          name: 'MeetingPresenceNotMarkableError',
          reason,
        }),
      );

      const result = await markPresenceAction(
        null,
        makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'present' }),
      );

      expect(result).toEqual({ ok: false, error: reason });
      expect(logAuditMock).not.toHaveBeenCalled();
      expect(revalidatePathMock).not.toHaveBeenCalled();
    },
  );

  it('maps an unexpected failure to unknown', async () => {
    authMock.mockResolvedValueOnce(ADMIN_SESSION);
    markMeetingPresenceMock.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await markPresenceAction(
      null,
      makeFormData({ meetingId: 'm1', memberId: 'mem1', present: 'present' }),
    );

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
    consoleErrSpy.mockRestore();
  });
});
