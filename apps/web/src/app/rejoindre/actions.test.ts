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
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();
const accessRequestConsumeMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);

vi.mock('@/lib/access-request/service', () => ({
  createAccessRequest: createAccessRequestMock,
}));

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

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
  headersMock.mockReset();
  accessRequestConsumeMock.mockReset();
  logAuditMock.mockClear();

  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.42' }));
  accessRequestConsumeMock.mockReturnValue({ allowed: true, remaining: 2, retryAfterMs: 0 });
  createAccessRequestMock.mockResolvedValue({ ok: true, created: true });
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
