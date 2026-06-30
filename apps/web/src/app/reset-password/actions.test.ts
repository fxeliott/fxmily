import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action tests for resetPasswordAction (public `/reset-password`).
 *
 * The service-level contract (token consume, tokenVersion bump, active-only
 * guard) is already pinned by `lib/auth/password-reset.test.ts`. These tests
 * pin the ACTION's own responsibilities, which the service can't see:
 *   - schema → fieldError mapping (password / passwordConfirm);
 *   - a tampered/short token with no field to attach to surfaces as a top-level
 *     `invalid_token` (never a silent no-op);
 *   - every `completePasswordReset` failure reason is forwarded verbatim;
 *   - success ends in `redirect('/login?reset=success')` (no auto-login);
 *   - the trusted (last-hop) IP + user-agent are threaded into the service.
 *
 * `callerIdTrusted` stays REAL; `redirect` is mocked to throw a tagged sentinel
 * (mirroring Next's NEXT_REDIRECT) so we can assert the target without a router.
 */

const completePasswordResetMock = vi.fn<(...args: unknown[]) => unknown>();
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();

class RedirectError extends Error {
  constructor(public readonly to: string) {
    super('NEXT_REDIRECT');
  }
}
const redirectMock = vi.fn((to: string) => {
  throw new RedirectError(to);
});

vi.mock('@/lib/auth/password-reset', () => ({
  completePasswordReset: completePasswordResetMock,
}));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const { resetPasswordAction } = await import('./actions');

const VALID_TOKEN = 'a'.repeat(32); // 32 url-safe chars, passes min(20)/max(128)
const STRONG = 'Brand-New-Pwd!2026';

beforeEach(() => {
  completePasswordResetMock.mockReset();
  headersMock.mockReset();
  redirectMock.mockClear();
  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.5' }));
  completePasswordResetMock.mockResolvedValue({ ok: true, userId: 'user-1' });
});

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('resetPasswordAction — success', () => {
  it('consumes the token and redirects to /login?reset=success (no auto-login)', async () => {
    await expect(
      resetPasswordAction(
        null,
        makeForm({ token: VALID_TOKEN, password: STRONG, passwordConfirm: STRONG }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(completePasswordResetMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith('/login?reset=success');
  });

  it('threads the trusted last-hop IP + user-agent into the service', async () => {
    headersMock.mockResolvedValue(
      new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'user-agent': 'jest-ua' }),
    );
    await expect(
      resetPasswordAction(
        null,
        makeForm({ token: VALID_TOKEN, password: STRONG, passwordConfirm: STRONG }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(completePasswordResetMock).toHaveBeenCalledWith(
      expect.objectContaining({ plainToken: VALID_TOKEN, ip: '10.0.0.1', userAgent: 'jest-ua' }),
    );
  });
});

describe('resetPasswordAction — input validation', () => {
  it('maps a password mismatch to a passwordConfirm fieldError (no service call)', async () => {
    const result = await resetPasswordAction(
      null,
      makeForm({ token: VALID_TOKEN, password: STRONG, passwordConfirm: 'Different-Pwd!2026' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors?.passwordConfirm).toBeTruthy();
    expect(completePasswordResetMock).not.toHaveBeenCalled();
  });

  it('maps a too-short password to a password fieldError', async () => {
    const result = await resetPasswordAction(
      null,
      makeForm({ token: VALID_TOKEN, password: 'short', passwordConfirm: 'short' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors?.password).toBeTruthy();
    expect(completePasswordResetMock).not.toHaveBeenCalled();
  });

  it('surfaces a tampered/short token (no field to attach) as invalid_token', async () => {
    const result = await resetPasswordAction(
      null,
      makeForm({ token: 'short', password: STRONG, passwordConfirm: STRONG }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_token');
    expect(result.fieldErrors).toBeUndefined();
    expect(completePasswordResetMock).not.toHaveBeenCalled();
  });

  it('treats a missing token as invalid_token, never reaching the service', async () => {
    const result = await resetPasswordAction(
      null,
      makeForm({ password: STRONG, passwordConfirm: STRONG }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_token');
    expect(completePasswordResetMock).not.toHaveBeenCalled();
  });
});

describe('resetPasswordAction — service failure mapping', () => {
  it.each(['invalid_token', 'expired', 'already_used', 'inactive'] as const)(
    'forwards the "%s" reason verbatim and does NOT redirect',
    async (reason) => {
      completePasswordResetMock.mockResolvedValue({ ok: false, reason });
      const result = await resetPasswordAction(
        null,
        makeForm({ token: VALID_TOKEN, password: STRONG, passwordConfirm: STRONG }),
      );
      expect(result).toEqual({ ok: false, error: reason });
      expect(redirectMock).not.toHaveBeenCalled();
    },
  );
});
