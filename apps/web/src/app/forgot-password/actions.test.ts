import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action tests for requestPasswordResetAction (public `/forgot-password`).
 *
 * The action's whole reason to exist is ANTI-ENUMERATION, so these tests pin
 * exactly that contract — the part `password-reset.test.ts` (service-level)
 * cannot reach:
 *   - identical neutral `{ status: 'sent' }` for existing / unknown / inactive
 *     / email-failure cases (response body never leaks existence);
 *   - CONSTANT-TIME response: the DB lookup + token mint + email send are all
 *     deferred via `after()`, never on the response path (no timing oracle —
 *     parity with `rejoindre/actions.test.ts`);
 *   - token rollback when the email send fails;
 *   - rate-limit returns BEFORE any deferred work and carries the trusted IP.
 *
 * Mocks mirror `rejoindre/actions.test.ts`. `callerIdTrusted` stays REAL so the
 * trusted-IP (last-hop XFF) extraction is exercised end-to-end.
 */

const findUniqueMock = vi.fn<(...args: unknown[]) => unknown>();
const deleteManyMock = vi.fn<(...args: unknown[]) => unknown>();
const createTokenMock = vi.fn<(...args: unknown[]) => unknown>();
const sendEmailMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const reportWarningMock = vi.fn();
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();
const emailConsumeMock = vi.fn<(...args: unknown[]) => unknown>();
const ipConsumeMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: findUniqueMock },
    passwordResetToken: { deleteMany: deleteManyMock },
  },
}));

vi.mock('@/lib/auth/password-reset', () => ({
  createPasswordResetToken: createTokenMock,
}));

vi.mock('@/lib/email/send', () => ({
  sendPasswordResetEmail: sendEmailMock,
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/observability', () => ({ reportWarning: reportWarningMock }));

vi.mock('next/headers', () => ({ headers: headersMock }));

// `after()` defers existence-dependent work off the response path (the
// anti-timing-oracle fix). Capture callbacks so tests can both assert what is
// on the response path (before flush) and flush them deterministically.
const afterCallbacks: Array<() => unknown | Promise<unknown>> = [];
async function flushAfter(): Promise<void> {
  const cbs = afterCallbacks.splice(0);
  for (const cb of cbs) await cb();
}
vi.mock('next/server', () => ({
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb);
  },
}));

vi.mock('@/lib/rate-limit/token-bucket', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/token-bucket')>(
    '@/lib/rate-limit/token-bucket',
  );
  return {
    ...actual,
    passwordResetEmailLimiter: { consume: emailConsumeMock },
    passwordResetIpLimiter: { consume: ipConsumeMock },
  };
});

const { requestPasswordResetAction } = await import('./actions');

const ALLOW = { allowed: true, remaining: 2, retryAfterMs: 0 };

beforeEach(() => {
  findUniqueMock.mockReset();
  deleteManyMock.mockReset();
  createTokenMock.mockReset();
  sendEmailMock.mockReset();
  logAuditMock.mockClear();
  reportWarningMock.mockReset();
  headersMock.mockReset();
  emailConsumeMock.mockReset();
  ipConsumeMock.mockReset();
  afterCallbacks.length = 0;

  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.42' }));
  emailConsumeMock.mockReturnValue(ALLOW);
  ipConsumeMock.mockReturnValue(ALLOW);
  findUniqueMock.mockResolvedValue({ id: 'user-1', status: 'active', firstName: 'Alice' });
  createTokenMock.mockResolvedValue({ plainToken: 'tok', expiresAt: new Date(Date.now() + 1000) });
  sendEmailMock.mockResolvedValue({ id: 'email-1', delivered: true });
  deleteManyMock.mockResolvedValue({ count: 1 });
});

function makeForm(email: string): FormData {
  const fd = new FormData();
  fd.set('email', email);
  return fd;
}

describe('requestPasswordResetAction — anti-enumeration response', () => {
  it('returns neutral { status: sent } for an ACTIVE account', async () => {
    const result = await requestPasswordResetAction(null, makeForm('alice@fxmily.local'));
    expect(result).toEqual({ status: 'sent' });
  });

  it('returns the SAME { status: sent } for an UNKNOWN email', async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await requestPasswordResetAction(null, makeForm('nobody@nowhere.invalid'));
    expect(result).toEqual({ status: 'sent' });
  });

  it('returns the SAME { status: sent } for a SUSPENDED account', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-9', status: 'suspended', firstName: 'Bob' });
    const result = await requestPasswordResetAction(null, makeForm('bob@fxmily.local'));
    expect(result).toEqual({ status: 'sent' });
  });

  it('still returns { status: sent } when the email send FAILS (no leak)', async () => {
    sendEmailMock.mockRejectedValue(new Error('Resend down'));
    const result = await requestPasswordResetAction(null, makeForm('alice@fxmily.local'));
    expect(result).toEqual({ status: 'sent' });
  });
});

describe('requestPasswordResetAction — constant-time (no timing oracle)', () => {
  it('does NOT touch the DB or send email on the RESPONSE path (all deferred via after)', async () => {
    const result = await requestPasswordResetAction(null, makeForm('alice@fxmily.local'));

    expect(result).toEqual({ status: 'sent' });
    // Nothing existence-dependent ran synchronously — exactly one after() task queued.
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
  });

  it('the deferred task mints a token + sends the email for an active user', async () => {
    await requestPasswordResetAction(null, makeForm('alice@fxmily.local'));
    await flushAfter();

    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(createTokenMock).toHaveBeenCalledWith('user-1');
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alice@fxmily.local', plainToken: 'tok', firstName: 'Alice' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_reset.requested', userId: 'user-1' }),
    );
  });

  it('the deferred task sends NOTHING for an unknown email (audits matched:false)', async () => {
    findUniqueMock.mockResolvedValue(null);
    await requestPasswordResetAction(null, makeForm('nobody@nowhere.invalid'));
    await flushAfter();

    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.password_reset.requested',
        metadata: { matched: false },
      }),
    );
  });

  it('the deferred task rolls back the token when the email send fails', async () => {
    sendEmailMock.mockRejectedValue(new Error('Resend down'));
    await requestPasswordResetAction(null, makeForm('alice@fxmily.local'));
    await flushAfter();

    expect(createTokenMock).toHaveBeenCalledTimes(1);
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(reportWarningMock).toHaveBeenCalledWith(
      'password_reset.request',
      'email_delivery_failed',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});

describe('requestPasswordResetAction — rate limited', () => {
  it('returns rate_limited and queues NO existence-dependent work', async () => {
    emailConsumeMock.mockReturnValue({ allowed: false, remaining: 0, retryAfterMs: 90_000 });
    const result = await requestPasswordResetAction(null, makeForm('alice@fxmily.local'));

    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSec).toBe(90);
    expect(findUniqueMock).not.toHaveBeenCalled();
    // only the (deferred) rate_limited audit is queued — no lookup/token/email task
    await flushAfter();
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_reset.rate_limited', ip: '203.0.113.42' }),
    );
  });

  it('keys the IP limiter on the TRUSTED (last-hop) IP from x-forwarded-for', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }));
    await requestPasswordResetAction(null, makeForm('alice@fxmily.local'));
    expect(ipConsumeMock).toHaveBeenCalledWith('10.0.0.1');
  });
});

describe('requestPasswordResetAction — invalid input', () => {
  it('returns a fieldError for a malformed email and never looks anything up', async () => {
    const result = await requestPasswordResetAction(null, makeForm('not-an-email'));
    expect(result.status).toBe('invalid');
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});
