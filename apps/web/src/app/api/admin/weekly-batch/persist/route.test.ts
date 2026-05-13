import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.7.2 — Tests for POST /api/admin/weekly-batch/persist.
 *
 * What we pin :
 *   - 401 missing X-Admin-Token
 *   - 405 GET
 *   - 400 empty body
 *   - 400 invalid JSON
 *   - 400 envelope validation failure (missing required field, malformed weekStart)
 *   - 413 Content-Length declared too large (cheap header reject)
 *   - happy path returns persistGeneratedReports counts + total
 *   - 500 + reportError when persistGeneratedReports throws
 */

const TEST_TOKEN = 'test_admin_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaaaaaa';

const persistMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);

vi.mock('@/lib/weekly-report/batch', () => ({
  persistGeneratedReports: persistMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  flushSentry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('@/lib/env', () => ({
  env: {
    ADMIN_BATCH_TOKEN: TEST_TOKEN,
  },
}));

const { POST, GET } = await import('./route');

beforeEach(() => {
  persistMock.mockReset();
  reportErrorMock.mockReset();
  logAuditMock.mockClear();
});

function makeRequest(opts: {
  token?: string;
  ip: string;
  body?: string;
  declaredLength?: number;
}): Request {
  const url = 'https://app.fxmilyapp.com/api/admin/weekly-batch/persist';
  const headers: Record<string, string> = {
    'x-forwarded-for': opts.ip,
    'content-type': 'application/json',
  };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  if (opts.declaredLength !== undefined) {
    headers['content-length'] = String(opts.declaredLength);
  }
  return new Request(url, {
    method: 'POST',
    headers,
    body: opts.body ?? '',
  });
}

const VALID_BODY = JSON.stringify({
  weekStart: '2026-05-04',
  weekEnd: '2026-05-10',
  results: [
    {
      userId: 'cuid_test_member_a',
      output: { summary: 's', risks: [], recommendations: ['r'], patterns: {} },
    },
  ],
});

describe('GET /api/admin/weekly-batch/persist', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/weekly-batch/persist — auth gate', () => {
  it('returns 401 when X-Admin-Token missing', async () => {
    const res = await POST(makeRequest({ ip: '10.70.0.1', body: VALID_BODY }) as never);
    expect(res.status).toBe(401);
    expect(persistMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/weekly-batch/persist — body validation', () => {
  it('returns 400 on empty body', async () => {
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.70.0.2', body: '' }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('empty_body');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.70.0.3', body: '{not_json' }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 on envelope validation failure (malformed weekStart)', async () => {
    const malformed = JSON.stringify({
      weekStart: '2026/05/04', // wrong separator
      weekEnd: '2026-05-10',
      results: [],
    });
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.70.0.4', body: malformed }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('envelope_validation_failed');
    expect(body.issues).toBeInstanceOf(Array);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 413 when declared Content-Length exceeds MAX_BODY_BYTES', async () => {
    const TWENTY_MIB = 20 * 1024 * 1024;
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.70.0.5',
        body: VALID_BODY,
        declaredLength: TWENTY_MIB,
      }) as never,
    );
    expect(res.status).toBe(413);
    expect(persistMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/weekly-batch/persist — happy path', () => {
  it('returns counts + total on success', async () => {
    persistMock.mockResolvedValueOnce({ persisted: 1, skipped: 0, errors: 0 });

    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.70.0.6', body: VALID_BODY }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ persisted: 1, skipped: 0, errors: 0, total: 1 });
    expect(persistMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/weekly-batch/persist — error path', () => {
  it('returns 500 + reportError + audit row when persistGeneratedReports throws', async () => {
    persistMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.70.0.7', body: VALID_BODY }) as never,
    );
    expect(res.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    // V1.7.2 audit fix : the catch site MUST emit an audit row so a
    // mid-flight throw leaves an operational trace.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const auditArg = logAuditMock.mock.calls[0]?.[0] as {
      action?: string;
      metadata?: Record<string, unknown>;
    };
    expect(auditArg?.action).toBe('weekly_report.batch.persist_failed');
    expect(auditArg?.metadata?.stage).toBe('route_handler');
    expect(auditArg?.metadata?.error).toContain('db_unreachable');
  });
});
