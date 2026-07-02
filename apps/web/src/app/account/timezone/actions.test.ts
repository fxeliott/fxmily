import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F2 — Server Action tests for /account/timezone.
 *
 * The action is the single write path for a member's IANA timezone. We mock the
 * auth session, the Prisma `user.update`, the audit logger and `revalidatePath`
 * so the auth gate / validation / persistence branches are hit deterministically
 * without a DB. The new value reaches the live session via the JWT refresh
 * (`refreshAndCheckToken`), so this action deliberately does NOT bump
 * `tokenVersion` — the test asserts the persistence + audit contract only.
 */

const authMock = vi.fn();
const userUpdateMock = vi.fn(async () => ({}));
const logAuditMock = vi.fn(async () => undefined);
const revalidatePathMock = vi.fn();

vi.mock('@/auth', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { update: userUpdateMock },
  },
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

const { updateTimezoneAction } = await import('./actions');

beforeEach(() => {
  authMock.mockReset();
  userUpdateMock.mockReset();
  userUpdateMock.mockResolvedValue({});
  logAuditMock.mockClear();
  revalidatePathMock.mockClear();
});

function activeSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: 'usr_1', status: 'active', ...overrides } };
}

describe('updateTimezoneAction', () => {
  it('fails unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await updateTimezoneAction({ timezone: 'Europe/Paris' });
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('fails unauthorized when the member is not active (suspended)', async () => {
    authMock.mockResolvedValueOnce(activeSession({ status: 'suspended' }));
    const result = await updateTimezoneAction({ timezone: 'Europe/Paris' });
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown timezone before touching the DB', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await updateTimezoneAction({ timezone: 'Mars/Olympus' });
    expect(result).toEqual({ ok: false, error: 'invalid_timezone' });
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('persists, audits and revalidates on the happy path', async () => {
    authMock.mockResolvedValueOnce(activeSession());
    const result = await updateTimezoneAction({ timezone: 'America/New_York' });

    expect(result).toEqual({ ok: true, timezone: 'America/New_York' });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: { timezone: 'America/New_York' },
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account.timezone.updated',
        userId: 'usr_1',
        metadata: { timezone: 'America/New_York' },
      }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/account/timezone');
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard');
  });
});
