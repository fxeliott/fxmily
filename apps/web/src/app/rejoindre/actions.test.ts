import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2.5 — Server Action tests for requestAccessAction (public `/rejoindre`).
 *
 * The action composes: pre-auth rate-limit (`accessRequestIpLimiter` via
 * `callerIdTrusted`), Zod validation (`accessRequestSchema`),
 * `createAccessRequest`, and a PII-free audit row. We pin every branch +
 * the anti-enumeration contract (same success regardless of dedup).
 *
 * We mock the service, headers, the limiter singleton, and logAudit; we keep
 * `callerIdTrusted` real so the trusted-IP extraction is exercised end-to-end.
 */

const createAccessRequestMock = vi.fn<(...args: unknown[]) => unknown>();
const countPendingMock = vi.fn<(...args: unknown[]) => unknown>();
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();
const accessRequestConsumeMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const sendAdminNotifMock = vi.fn<(...args: unknown[]) => unknown>();
const reportWarningMock = vi.fn();

vi.mock('@/lib/access-request/service', () => ({
  createAccessRequest: createAccessRequestMock,
  countPendingAccessRequests: countPendingMock,
}));

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

// `after()` defers the admin notification off the response path (anti-timing-
// oracle). Capture the callbacks so the tests can flush them deterministically.
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

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('@/lib/email/send', () => ({
  sendAccessRequestReceivedAlertEmail: sendAdminNotifMock,
}));

vi.mock('@/lib/observability', () => ({ reportWarning: reportWarningMock }));

// Force a configured admin recipient so the §26.2 notify branch is exercised
// (it short-circuits when WEEKLY_REPORT_RECIPIENT is unset).
vi.mock('@/lib/env', async () => {
  const actual = await vi.importActual<typeof import('@/lib/env')>('@/lib/env');
  return { ...actual, env: { ...actual.env, WEEKLY_REPORT_RECIPIENT: 'admin@fxmily.test' } };
});

vi.mock('@/lib/rate-limit/token-bucket', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/token-bucket')>(
    '@/lib/rate-limit/token-bucket',
  );
  return {
    ...actual,
    accessRequestIpLimiter: { consume: accessRequestConsumeMock },
  };
});

const { requestAccessAction } = await import('./actions');

beforeEach(() => {
  createAccessRequestMock.mockReset();
  countPendingMock.mockReset();
  headersMock.mockReset();
  accessRequestConsumeMock.mockReset();
  logAuditMock.mockClear();
  sendAdminNotifMock.mockReset();
  reportWarningMock.mockReset();
  afterCallbacks.length = 0;

  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.42' }));
  accessRequestConsumeMock.mockReturnValue({ allowed: true, remaining: 2, retryAfterMs: 0 });
  createAccessRequestMock.mockResolvedValue({ ok: true, created: true });
  countPendingMock.mockResolvedValue(1);
  sendAdminNotifMock.mockResolvedValue({ id: 'email-1', delivered: true });
});

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('requestAccessAction — happy path', () => {
  it('consumes the limiter, creates the request, audits PII-free, and returns demande en attente', async () => {
    const result = await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'eliot@fxmilyapp.com' }),
    );

    expect(result).toEqual({ ok: true, message: 'demande en attente' });
    expect(accessRequestConsumeMock).toHaveBeenCalledTimes(1);
    expect(createAccessRequestMock).toHaveBeenCalledWith({
      firstName: 'Eliot',
      lastName: 'Pena',
      email: 'eliot@fxmilyapp.com',
    });
    // Audit row carries NO PII (no email/name) — empty metadata.
    expect(logAuditMock).toHaveBeenCalledWith({ action: 'access_request.created', metadata: {} });
  });

  it('keys the limiter on the TRUSTED (last-hop) IP from x-forwarded-for', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }));

    await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'eliot@fxmilyapp.com' }),
    );

    // callerIdTrusted reads the END of the chain (Caddy-appended, non-spoofable).
    expect(accessRequestConsumeMock).toHaveBeenCalledWith('10.0.0.1');
  });

  it('returns the SAME success when the service dedups (no enumeration leak)', async () => {
    createAccessRequestMock.mockResolvedValue({ ok: true, created: false });

    const result = await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'already@member.com' }),
    );

    // Identical to the created:true branch — caller can't distinguish.
    expect(result).toEqual({ ok: true, message: 'demande en attente' });
  });
});

describe('requestAccessAction — admin notification (§26.2 "par email ET sur son profil")', () => {
  it('notifies the admin BY EMAIL (count-only) when a NEW request is created', async () => {
    createAccessRequestMock.mockResolvedValue({ ok: true, created: true });
    countPendingMock.mockResolvedValue(3);

    await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'new@prospect.com' }),
    );
    // Notification is deferred via after() — flush it to observe the side effect.
    await flushAfter();

    // §26.2 — the operator gets a count-only email, NO requester PII passed here.
    expect(sendAdminNotifMock).toHaveBeenCalledWith({ to: 'admin@fxmily.test', pendingCount: 3 });
  });

  it('schedules NOTHING on the response path when the service dedups (anti-enumeration + no timing oracle)', async () => {
    createAccessRequestMock.mockResolvedValue({ ok: true, created: false });

    const result = await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'already@member.com' }),
    );

    expect(result).toEqual({ ok: true, message: 'demande en attente' });
    // created:false → no after() callback queued at all (constant-time response).
    expect(afterCallbacks).toHaveLength(0);
    await flushAfter();
    expect(sendAdminNotifMock).not.toHaveBeenCalled();
  });

  it('still returns success (best-effort) when the admin notification email fails', async () => {
    createAccessRequestMock.mockResolvedValue({ ok: true, created: true });
    sendAdminNotifMock.mockRejectedValue(new Error('Resend down'));

    const result = await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'new@prospect.com' }),
    );

    // A delivery failure must NEVER break the public request — and the failure
    // happens in the deferred after() callback, never on the response path.
    expect(result).toEqual({ ok: true, message: 'demande en attente' });
    await flushAfter();
    expect(reportWarningMock).toHaveBeenCalledWith(
      'access-request.create',
      'admin_notify_failed',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});

describe('requestAccessAction — rate limited', () => {
  it('returns rate_limited BEFORE validation or service call', async () => {
    accessRequestConsumeMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 90_000,
    });

    const result = await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'eliot@fxmilyapp.com' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate_limited');
    expect(result.retryAfterSec).toBe(90);
    expect(createAccessRequestMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('requestAccessAction — invalid input', () => {
  it('returns fieldErrors for a malformed email and never calls the service', async () => {
    const result = await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'not-an-email' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(createAccessRequestMock).not.toHaveBeenCalled();
  });

  it('returns fieldErrors for empty names', async () => {
    const result = await requestAccessAction(
      null,
      makeForm({ firstName: '', lastName: '', email: 'eliot@fxmilyapp.com' }),
    );

    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors?.firstName).toBeTruthy();
    expect(result.fieldErrors?.lastName).toBeTruthy();
    expect(createAccessRequestMock).not.toHaveBeenCalled();
  });

  it('rate-limit is consumed even on invalid input (the bucket gates the surface)', async () => {
    await requestAccessAction(
      null,
      makeForm({ firstName: 'Eliot', lastName: 'Pena', email: 'bad' }),
    );
    expect(accessRequestConsumeMock).toHaveBeenCalledTimes(1);
  });
});
