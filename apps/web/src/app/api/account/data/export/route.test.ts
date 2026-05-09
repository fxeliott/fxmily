import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J10 Phase A — Route handler tests for POST /api/account/data/export.
 *
 * The route is the user-facing surface for RGPD article 20 portability. We
 * pin the auth gate, the per-user rate-limiter (T3.15 — burst 3 /
 * 1 token / 15 min), the same-origin defence (T1.2), and the audit row
 * shape (no PII, just summary counts).
 *
 * Mocking strategy : we mock the upstream collaborators (`auth`,
 * `buildUserDataExport`, `summariseExport`, `buildExportFilename`,
 * `logAudit`) but use the REAL `exportLimiter` instance from
 * `@/lib/rate-limit/token-bucket` so the bucket-exhaustion test is end-to-end.
 */

// Typed mocks — see comment in purge-deleted/route.test.ts. Without the
// type parameter, vitest narrows `mock.calls` to `never[]` under TS5+ +
// `noUncheckedIndexedAccess`.
const authMock = vi.fn<(...args: unknown[]) => unknown>();
const buildUserDataExportMock = vi.fn<(...args: unknown[]) => unknown>();
const summariseExportMock = vi.fn<(...args: unknown[]) => unknown>();
const buildExportFilenameMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);

vi.mock('@/auth', () => ({
  auth: authMock,
}));

vi.mock('@/lib/account/export', () => ({
  buildUserDataExport: buildUserDataExportMock,
  summariseExport: summariseExportMock,
  buildExportFilename: buildExportFilenameMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

// Pin AUTH_URL so the same-origin check is deterministic.
vi.mock('@/lib/env', () => ({
  env: {
    AUTH_URL: 'https://app.fxmilyapp.com',
    NODE_ENV: 'test',
  },
}));

// We need the REAL exportLimiter to test rate-limit exhaustion, but we also
// want a fresh instance per test so order-dependence doesn't leak. The module
// export is a singleton ; we reset its internal map by calling consume on a
// unique key per test where bucket isolation matters. For the explicit
// rate-limit test, we drain the bucket on a known userId.
const { POST, GET } = await import('./route');

beforeEach(() => {
  authMock.mockReset();
  buildUserDataExportMock.mockReset();
  summariseExportMock.mockReset();
  buildExportFilenameMock.mockReset();
  logAuditMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://app.fxmilyapp.com/api/account/data/export', {
    method: 'POST',
    headers,
  });
}

describe('GET /api/account/data/export', () => {
  // Why this matters : the download must be a deliberate POST (a GET fetch
  // from a marketing iframe must NOT trigger an export download).
  it('returns 405 method_not_allowed', async () => {
    const res = GET();
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body).toEqual({ error: 'method_not_allowed' });
  });
});

describe('POST /api/account/data/export — auth gate', () => {
  // Why this matters : a logged-out user must NEVER reach the export builder.
  // Returning 401 BEFORE consuming a rate-limit token is intentional in this
  // route (auth gate is first) — but we don't pin order here, only that the
  // export builder is never called.
  it('returns 401 when no session is present', async () => {
    authMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ origin: 'https://app.fxmilyapp.com' }) as never);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'unauthorized' });
    expect(buildUserDataExportMock).not.toHaveBeenCalled();
  });

  // Why this matters : a soft-deleted user (status='deleted') keeps a session
  // briefly until next reload. They must NOT be able to download their data
  // post-materialisation (PII has been scrubbed — they'd just get a useless
  // "deleted-X@fxmily.local" snapshot).
  it('returns 401 when session.user.status is not active', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1', status: 'deleted' } });

    const res = await POST(makeRequest({ origin: 'https://app.fxmilyapp.com' }) as never);

    expect(res.status).toBe(401);
    expect(buildUserDataExportMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/data/export — same-origin defence', () => {
  // Why this matters : the route is a state-mutating POST (consumes a
  // rate-limit token + writes an audit row + reads the entire user dataset).
  // SameSite=Lax forwards the cookie on top-level POST navigations, so a
  // attacker form on a hostile origin could still trigger the route. The
  // route MUST reject when Origin/Referer headers don't match AUTH_URL.
  it('returns 403 origin_mismatch when Origin header is from a foreign domain', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_origin', status: 'active' } });

    const res = await POST(makeRequest({ origin: 'https://evil.example.com' }) as never);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'origin_mismatch' });
    expect(buildUserDataExportMock).not.toHaveBeenCalled();
  });

  // Why this matters : enterprise WebViews / strict corp proxies sometimes
  // strip BOTH Origin and Referer. Pre-J10 lenient code skipped the check
  // when both were null — that opened a CSRF window. The route MUST now
  // reject 403 when both headers are absent.
  it('returns 403 when both Origin and Referer are absent (no fallback skip)', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_strip', status: 'active' } });

    const res = await POST(makeRequest({}) as never);

    expect(res.status).toBe(403);
    expect(buildUserDataExportMock).not.toHaveBeenCalled();
  });

  // Why this matters : when Origin is missing but Referer matches AUTH_URL
  // (some Safari versions on iOS), the fallback to Referer must allow the
  // request through. We confirm the fallback path is wired.
  it('falls back to Referer when Origin is missing and Referer matches AUTH_URL', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_referer', status: 'active' } });
    buildUserDataExportMock.mockResolvedValueOnce({ schemaVersion: 1, exportedAt: 'x' });
    summariseExportMock.mockReturnValueOnce({ schemaVersion: 1, tradeCount: 0 });
    buildExportFilenameMock.mockReturnValueOnce('fxmily-data-eferer-2026-05-09.json');

    const res = await POST(
      makeRequest({
        referer: 'https://app.fxmilyapp.com/account/data',
      }) as never,
    );

    expect(res.status).toBe(200);
    expect(buildUserDataExportMock).toHaveBeenCalledWith('u_referer');
  });
});

describe('POST /api/account/data/export — happy path', () => {
  // Why this matters : the response must be a JSON attachment with explicit
  // no-store cache + the schema version in a custom header for ops triage.
  // A regression that drops Content-Disposition would render the JSON inline
  // in the browser instead of downloading.
  it('returns 200 with attachment headers, schema-version tag, and no-store cache', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_ok', status: 'active' } });
    buildUserDataExportMock.mockResolvedValueOnce({
      schemaVersion: 1,
      exportedAt: '2026-05-09T08:00:00.000Z',
      trades: [],
    });
    summariseExportMock.mockReturnValueOnce({ schemaVersion: 1, tradeCount: 0 });
    buildExportFilenameMock.mockReturnValueOnce('fxmily-data-uok-2026-05-09.json');

    const res = await POST(makeRequest({ origin: 'https://app.fxmilyapp.com' }) as never);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="fxmily-data-uok-2026-05-09.json"',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Fxmily-Export-Schema')).toBe('1');
  });

  // Why this matters : the audit row must NOT contain PII (no email, no
  // names, no IP) — only counts. A regression that wired the snapshot into
  // metadata would leak data into the audit log.
  it('writes an audit row with summary counts only (no PII)', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_audit', status: 'active' } });
    buildUserDataExportMock.mockResolvedValueOnce({ schemaVersion: 1, exportedAt: 'x' });
    summariseExportMock.mockReturnValueOnce({
      schemaVersion: 1,
      tradeCount: 42,
      auditLogCount: 7,
    });
    buildExportFilenameMock.mockReturnValueOnce('fxmily-data-uaudit-2026-05-09.json');

    await POST(
      makeRequest({
        origin: 'https://app.fxmilyapp.com',
        'user-agent': 'Mozilla/5.0 (test)',
      }) as never,
    );

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const auditCall = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      userId: string;
      metadata: Record<string, unknown>;
    };
    expect(auditCall.action).toBe('account.data.exported');
    expect(auditCall.userId).toBe('u_audit');
    // Only counts are present, no email/names/IP fields.
    expect(auditCall.metadata).toEqual({
      schemaVersion: 1,
      tradeCount: 42,
      auditLogCount: 7,
    });
    expect(JSON.stringify(auditCall.metadata)).not.toMatch(/email|password|ipHash/i);
  });
});

describe('POST /api/account/data/export — error path', () => {
  // Why this matters : if the export builder throws (DB outage / bug), the
  // route must return a generic 500 rather than leaking the underlying
  // Prisma error to the client. We pin that the JSON shape is `export_failed`.
  it('returns 500 export_failed when the builder throws', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u_err', status: 'active' } });
    buildUserDataExportMock.mockRejectedValueOnce(new Error('connection refused'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await POST(makeRequest({ origin: 'https://app.fxmilyapp.com' }) as never);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'export_failed' });
    // The original error message is NOT leaked.
    expect(JSON.stringify(body)).not.toMatch(/connection refused/);
    errSpy.mockRestore();
  });
});

describe('POST /api/account/data/export — per-user rate-limit (T3.15)', () => {
  // Why this matters : the per-user export limiter is bucketSize=3, refill
  // 1 / 15 min. The 4th call within a short window must return 429 with a
  // Retry-After header (in seconds) so the UI can show a sensible countdown.
  // We use a unique userId per test so the singleton bucket starts fresh.
  it('returns 429 with Retry-After header on the 4th call within burst window', async () => {
    const userId = `u_rate_${Date.now()}_${Math.random()}`;
    authMock.mockResolvedValue({ user: { id: userId, status: 'active' } });
    buildUserDataExportMock.mockResolvedValue({ schemaVersion: 1, exportedAt: 'x' });
    summariseExportMock.mockReturnValue({ schemaVersion: 1, tradeCount: 0 });
    buildExportFilenameMock.mockReturnValue('fxmily-data-test-2026-05-09.json');

    // Burn the 3 burst tokens with valid same-origin POSTs.
    for (let i = 0; i < 3; i++) {
      const r = await POST(makeRequest({ origin: 'https://app.fxmilyapp.com' }) as never);
      expect(r.status).toBe(200);
    }

    // 4th call within the burst window → 429.
    const limited = await POST(makeRequest({ origin: 'https://app.fxmilyapp.com' }) as never);

    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toBe('rate_limited');
    expect(typeof body.retryAfterMs).toBe('number');
    expect(body.retryAfterMs).toBeGreaterThan(0);
    // Retry-After header in seconds (HTTP spec — integer seconds).
    const retryAfterHeader = limited.headers.get('Retry-After');
    expect(retryAfterHeader).toBeTruthy();
    expect(Number(retryAfterHeader)).toBeGreaterThan(0);
    expect(Number.isInteger(Number(retryAfterHeader))).toBe(true);
  });
});
