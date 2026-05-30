import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock all module-level dependencies BEFORE importing the SUT.
// Pattern J5 `app/checkin/actions.test.ts` / V2.3 `app/pre-trade/actions.test.ts`.
const authMock = vi.fn();
const logAuditMock = vi.fn();
const declareMeetingAttendanceMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  const err = new Error('NEXT_REDIRECT') as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};303`;
  throw err;
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
// Only the VALUE export `declareMeetingAttendance` is mocked. The action
// duck-types the not-declarable error on `name` + `reason` (it never imports
// the `MeetingNotDeclarableError` class value), so the mock stays minimal.
vi.mock('@/lib/meeting/service', () => ({
  declareMeetingAttendance: declareMeetingAttendanceMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const { declareMeetingAttendanceAction } = await import('./actions');

afterEach(() => {
  authMock.mockReset();
  logAuditMock.mockReset();
  declareMeetingAttendanceMock.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockClear();
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ACTIVE_SESSION = {
  user: { id: 'user_1', status: 'active' as const, timezone: 'Europe/Paris' },
};

const DECLARED_ROW = {
  id: 'att_1',
  meetingId: 'm1',
  attendanceMode: 'live' as const,
  contentReviewed: true,
};

describe('declareMeetingAttendanceAction — auth gate (defence in depth)', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await declareMeetingAttendanceAction(null, makeFormData({}));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(declareMeetingAttendanceMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when status is not "active"', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'user_1', status: 'pending', timezone: 'Europe/Paris' },
    });

    const result = await declareMeetingAttendanceAction(null, makeFormData({}));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(declareMeetingAttendanceMock).not.toHaveBeenCalled();
  });
});

describe('declareMeetingAttendanceAction — Zod safeParse rejection', () => {
  it('returns invalid_input when attendanceMode is outside the enum', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const result = await declareMeetingAttendanceAction(
      null,
      makeFormData({ meetingId: 'm1', attendanceMode: 'teleport', contentReviewed: 'on' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('attendanceMode');
    expect(declareMeetingAttendanceMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input when meetingId is missing', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const result = await declareMeetingAttendanceAction(
      null,
      makeFormData({ attendanceMode: 'live', contentReviewed: 'on' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('meetingId');
  });
});

describe('declareMeetingAttendanceAction — FormData boolean coercion (J5 footgun guard)', () => {
  it('coerces "on" to true and an absent checkbox to false', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    declareMeetingAttendanceMock.mockResolvedValueOnce({
      ...DECLARED_ROW,
      contentReviewed: false,
    });

    // contentReviewed ABSENT (unchecked checkboxes are not submitted).
    const fd = makeFormData({ meetingId: 'm1', attendanceMode: 'replay' });

    await expect(declareMeetingAttendanceAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(declareMeetingAttendanceMock).toHaveBeenCalledWith('user_1', {
      meetingId: 'm1',
      attendanceMode: 'replay',
      contentReviewed: false,
    });
  });

  it('coerces literal "false" to JS false (NOT the Boolean("false")===true footgun)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    declareMeetingAttendanceMock.mockResolvedValueOnce({ ...DECLARED_ROW, contentReviewed: false });

    const fd = makeFormData({ meetingId: 'm1', attendanceMode: 'live', contentReviewed: 'false' });

    await expect(declareMeetingAttendanceAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(declareMeetingAttendanceMock).toHaveBeenCalledWith('user_1', {
      meetingId: 'm1',
      attendanceMode: 'live',
      contentReviewed: false,
    });
  });
});

describe('declareMeetingAttendanceAction — happy path', () => {
  it('declares, audits PII-free {meetingId, mode, reviewed}, revalidates + redirects /reunions', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    declareMeetingAttendanceMock.mockResolvedValueOnce(DECLARED_ROW);

    const fd = makeFormData({ meetingId: 'm1', attendanceMode: 'live', contentReviewed: 'on' });

    await expect(declareMeetingAttendanceAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(declareMeetingAttendanceMock).toHaveBeenCalledTimes(1);
    expect(declareMeetingAttendanceMock).toHaveBeenCalledWith('user_1', {
      meetingId: 'm1',
      attendanceMode: 'live',
      contentReviewed: true,
    });

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'meeting.attendance.declared',
      userId: 'user_1',
      metadata: {
        meetingId: 'm1',
        attendanceMode: 'live',
        contentReviewed: true,
      },
    });

    expect(revalidatePathMock).toHaveBeenCalledWith('/reunions');
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith('/reunions');
  });
});

describe('declareMeetingAttendanceAction — HARD guard refusal', () => {
  it('maps MeetingNotDeclarableError to not_declarable + reason (duck-typed)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    declareMeetingAttendanceMock.mockRejectedValueOnce(
      Object.assign(new Error('Meeting not declarable: cancelled'), {
        name: 'MeetingNotDeclarableError',
        reason: 'cancelled',
      }),
    );

    const result = await declareMeetingAttendanceAction(
      null,
      makeFormData({ meetingId: 'm1', attendanceMode: 'live', contentReviewed: 'on' }),
    );

    expect(result).toEqual({
      ok: false,
      error: 'not_declarable',
      notDeclarableReason: 'cancelled',
    });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('declareMeetingAttendanceAction — unexpected service failure', () => {
  it('returns unknown and does NOT audit / revalidate / redirect', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    declareMeetingAttendanceMock.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await declareMeetingAttendanceAction(
      null,
      makeFormData({ meetingId: 'm1', attendanceMode: 'live', contentReviewed: 'on' }),
    );

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();

    consoleErrSpy.mockRestore();
  });
});
