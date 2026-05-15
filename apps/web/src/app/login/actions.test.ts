import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J10 Phase T — Server Action tests for signInAction.
 *
 * The action is the user-facing surface for /login. It composes Zod
 * validation, the per-email + per-IP token bucket rate-limiter, the
 * Auth.js v5 `signIn()` and the audit logger. Each branch flips a
 * different banner / HTTP-style result on the form, so we pin every
 * outcome here.
 *
 * Mocking strategy : we mock every collaborator
 * (`@/auth.signIn`, `next/headers`, the two limiter singletons,
 * `logAudit`) so the action's own branching logic is what we exercise,
 * not the real Auth.js or the real LRU map. The real bucket math has
 * its own unit tests in `lib/rate-limit/token-bucket.test.ts`.
 */

// Typed mocks — without the type parameter, vitest narrows `mock.calls`
// to `never[]` under TS5+ + `noUncheckedIndexedAccess`, and assertions
// on call args would fail the type-check.
const signInMock = vi.fn<(...args: unknown[]) => unknown>();
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();
const loginEmailConsumeMock = vi.fn<(...args: unknown[]) => unknown>();
const loginIpConsumeMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);

vi.mock('@/auth', () => ({
  signIn: signInMock,
}));

// `next-auth` transitively imports `next/server`, which Vitest's Node
// resolver can't follow (it's a Next.js bundler-shimmed module). The
// action only uses `AuthError` for an `instanceof` check, so a tiny
// class-shape stub is enough.
vi.mock('next-auth', () => {
  class AuthError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'AuthError';
    }
  }
  return { AuthError };
});

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

// We mock the two limiter singletons but keep `callerIdTrusted` real so the
// IP-extraction logic is still exercised end-to-end (the tests pin a
// specific x-forwarded-for and assert the IP key reaches the limiter).
// V1.10 sec hardening : login now uses `callerIdTrusted` (last-entry XFF
// from Caddy) instead of `callerId` (first-entry, spoofable).
vi.mock('@/lib/rate-limit/token-bucket', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/token-bucket')>(
    '@/lib/rate-limit/token-bucket',
  );
  return {
    ...actual,
    loginEmailLimiter: { consume: loginEmailConsumeMock },
    loginIpLimiter: { consume: loginIpConsumeMock },
  };
});

const { signInAction } = await import('./actions');

beforeEach(() => {
  signInMock.mockReset();
  headersMock.mockReset();
  loginEmailConsumeMock.mockReset();
  loginIpConsumeMock.mockReset();
  logAuditMock.mockClear();

  // Sensible defaults : real Headers carrying a stable x-forwarded-for
  // and both limiters allowing the request. Each test overrides what
  // it needs.
  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.42' }));
  loginEmailConsumeMock.mockReturnValue({ allowed: true, remaining: 4, retryAfterMs: 0 });
  loginIpConsumeMock.mockReturnValue({ allowed: true, remaining: 9, retryAfterMs: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('signInAction — happy path', () => {
  // Why this matters : the contract with Auth.js is that `signIn()`
  // throws a NEXT_REDIRECT to navigate to /dashboard. We must call
  // `signIn` with the parsed credentials and let the redirect bubble.
  // A regression that swallowed the throw would 500 the form.
  it('calls signIn with parsed credentials when both limiters allow', async () => {
    // Arrange : Auth.js redirect bubble.
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/dashboard',
    });
    signInMock.mockRejectedValueOnce(redirectErr);

    // Act
    await expect(
      signInAction(null, makeForm({ email: 'eliot@fxmilyapp.com', password: 'whatever12345' })),
    ).rejects.toBe(redirectErr);

    // Assert : signIn called with the lowercased/trimmed credentials.
    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith('credentials', {
      email: 'eliot@fxmilyapp.com',
      password: 'whatever12345',
      redirectTo: '/dashboard',
    });
    // Both limiters consulted, and audit NOT called (we only log
    // failures here ; success is logged by the Auth.js `signIn` event).
    expect(loginEmailConsumeMock).toHaveBeenCalledTimes(1);
    expect(loginIpConsumeMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  // Why this matters : the limiter must be keyed on the LOWERCASED
  // email (anti-enumeration : "Eliot@fxmilyapp.com" and
  // "eliot@fxmilyapp.com" must share one bucket). Same for the
  // x-forwarded-for last-hop value reaching the IP limiter (V1.10 sec
  // hardening : `callerIdTrusted` reads the END of the XFF chain, which
  // Caddy v2 appends with the immediate client IP it observed — non-
  // spoofable, unlike first-hop which is client-controlled).
  it('keys the email limiter on the lowercased email and the IP limiter on x-forwarded-for', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }));
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/dashboard',
    });
    signInMock.mockRejectedValueOnce(redirectErr);

    await expect(
      signInAction(null, makeForm({ email: '  Eliot@FXMILYAPP.com ', password: 'whatever12345' })),
    ).rejects.toBe(redirectErr);

    expect(loginEmailConsumeMock).toHaveBeenCalledWith('eliot@fxmilyapp.com');
    // Last hop in x-forwarded-for = trusted from Caddy (anti-spoofing).
    expect(loginIpConsumeMock).toHaveBeenCalledWith('10.0.0.1');
  });
});

describe('signInAction — invalid input', () => {
  // Why this matters : the action must reject malformed input BEFORE
  // touching the rate limiters (otherwise an attacker could send 5
  // 'invalid_input' submissions to deplete a victim's bucket without
  // ever calling signIn). We pin both the result shape AND the
  // no-side-effect contract.
  it("returns { error: 'invalid_input', fieldErrors } when the email is malformed", async () => {
    const result = await signInAction(
      null,
      makeForm({ email: 'not-an-email', password: 'whatever' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toBeDefined();
    expect(result.fieldErrors?.email).toBeTruthy();

    // Critical : neither limiter consulted, signIn never called.
    expect(loginEmailConsumeMock).not.toHaveBeenCalled();
    expect(loginIpConsumeMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  // Why this matters : an empty password is the cheapest probe an
  // attacker can send. Same no-side-effect contract.
  it("returns { error: 'invalid_input' } when the password is empty", async () => {
    const result = await signInAction(
      null,
      makeForm({ email: 'eliot@fxmilyapp.com', password: '' }),
    );

    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors?.password).toBeTruthy();
    expect(loginEmailConsumeMock).not.toHaveBeenCalled();
  });
});

describe('signInAction — rate limited', () => {
  // Why this matters : a tripped email limiter must (a) return
  // 'rate_limited' (NOT 'invalid_credentials' — anti-enumeration) and
  // (b) write an audit row tagged `kind: 'email'` so ops can spot
  // dictionary attacks on a known account in the audit_log table.
  it("returns { error: 'rate_limited' } and logs kind 'email' when the email limiter trips", async () => {
    loginEmailConsumeMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 30_000,
    });
    // IP allowed → only email tripped.
    loginIpConsumeMock.mockReturnValueOnce({ allowed: true, remaining: 9, retryAfterMs: 0 });

    const result = await signInAction(
      null,
      makeForm({ email: 'eliot@fxmilyapp.com', password: 'whatever12345' }),
    );

    expect(result).toEqual({ ok: false, error: 'rate_limited', retryAfterSec: 30 });
    expect(signInMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.rate_limited',
      metadata: { kind: 'email', retryAfterMs: 30_000 },
    });
  });

  // Why this matters : a tripped IP limiter audits with `kind: 'ip'`
  // so ops can distinguish credential-stuffing-from-one-machine
  // (kind: 'ip') from dictionary-attack-on-one-account (kind: 'email').
  it("returns { error: 'rate_limited' } and logs kind 'ip' when only the IP limiter trips", async () => {
    loginEmailConsumeMock.mockReturnValueOnce({ allowed: true, remaining: 4, retryAfterMs: 0 });
    loginIpConsumeMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 12_500,
    });

    const result = await signInAction(
      null,
      makeForm({ email: 'eliot@fxmilyapp.com', password: 'whatever12345' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate_limited');
    // ceil(12_500 / 1000) = 13.
    expect(result.retryAfterSec).toBe(13);
    expect(signInMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.rate_limited',
      metadata: { kind: 'ip', retryAfterMs: 12_500 },
    });
  });

  // Why this matters : when BOTH trip, the longer retryAfterMs wins
  // (don't tell the caller "wait 5s" if the email bucket needs 60s) AND
  // the audit row is tagged `kind: 'both'` (a strong signal of a
  // distributed brute-force on a single account).
  it("logs kind 'both' and uses the longer retryAfter when both limiters trip", async () => {
    loginEmailConsumeMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 60_000,
    });
    loginIpConsumeMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 5_000,
    });

    const result = await signInAction(
      null,
      makeForm({ email: 'eliot@fxmilyapp.com', password: 'whatever12345' }),
    );

    // The longer (60_000) wins → ceil(60) = 60s.
    expect(result.retryAfterSec).toBe(60);
    expect(signInMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.rate_limited',
      metadata: { kind: 'both', retryAfterMs: 60_000 },
    });
  });

  // Why this matters : the audit `logAudit` is best-effort — a DB
  // outage during the audit write must NOT swallow the rate-limit
  // response (the user must still see the throttle UI). The action
  // wraps the call in `.catch(() => undefined)` ; this regression
  // test pins that contract.
  it('still returns rate_limited even if logAudit rejects', async () => {
    loginEmailConsumeMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 30_000,
    });
    loginIpConsumeMock.mockReturnValueOnce({ allowed: true, remaining: 9, retryAfterMs: 0 });
    logAuditMock.mockRejectedValueOnce(new Error('audit DB down'));

    const result = await signInAction(
      null,
      makeForm({ email: 'eliot@fxmilyapp.com', password: 'whatever12345' }),
    );

    expect(result).toEqual({ ok: false, error: 'rate_limited', retryAfterSec: 30 });
  });
});
