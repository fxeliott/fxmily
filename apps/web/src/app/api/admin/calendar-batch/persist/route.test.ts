import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §26 — Tests for POST /api/admin/calendar-batch/persist (J-C2).
 *
 * What we pin :
 *   - 401 missing X-Admin-Token
 *   - 405 GET
 *   - 400 empty body
 *   - 400 invalid JSON
 *   - 400 envelope validation failure (malformed weekStart)
 *   - 413 declared Content-Length too large (cheap header reject)
 *   - 413 UTF-8 byte length > 16 MiB (emoji 4-byte amplification)
 *   - 400 envelope_validation_failed when results.length > 1000 (cap)
 *   - happy path returns persistGeneratedCalendars counts + total
 *   - 500 + reportError + audit row when persistGeneratedCalendars throws
 */

const TEST_TOKEN = 'test_calendar_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaa';

const persistMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);

vi.mock('@/lib/calendar/batch', () => ({
  persistGeneratedCalendars: persistMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  reportWarning: vi.fn(),
  flushSentry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('@/lib/env', () => ({
  env: {
    CALENDAR_ADMIN_BATCH_TOKEN: TEST_TOKEN,
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
  const url = 'https://app.fxmilyapp.com/api/admin/calendar-batch/persist';
  const headers: Record<string, string> = {
    'x-forwarded-for': opts.ip,
    'content-type': 'application/json',
  };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  if (opts.declaredLength !== undefined) headers['content-length'] = String(opts.declaredLength);
  return new Request(url, { method: 'POST', headers, body: opts.body ?? '' });
}

const VALID_BODY = JSON.stringify({
  weekStart: '2026-06-08',
  results: [{ userId: 'cuid_test_member_a', output: { weekStart: '2026-06-08' } }],
});

describe('GET /api/admin/calendar-batch/persist', () => {
  it('returns 405 method_not_allowed', () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/calendar-batch/persist — auth gate', () => {
  it('returns 401 when X-Admin-Token missing', async () => {
    const res = await POST(makeRequest({ ip: '10.90.0.1', body: VALID_BODY }) as never);
    expect(res.status).toBe(401);
    expect(persistMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/calendar-batch/persist — body validation', () => {
  it('returns 400 on empty body', async () => {
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.90.0.2', body: '' }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('empty_body');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.90.0.3', body: '{not_json' }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 on envelope validation failure (malformed weekStart)', async () => {
    const malformed = JSON.stringify({ weekStart: '2026/06/08', results: [] });
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.90.0.4', body: malformed }) as never,
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
        ip: '10.90.0.5',
        body: VALID_BODY,
        declaredLength: TWENTY_MIB,
      }) as never,
    );
    expect(res.status).toBe(413);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 413 when UTF-8 byte length > 16 MiB (emoji 4-byte amplification, lying content-length)', async () => {
    const body = JSON.stringify({
      weekStart: '2026-06-08',
      results: [{ userId: 'cuid_emoji', output: { o: '🚀'.repeat(5_000_000) } }],
    });
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.91.0.1', body, declaredLength: 100 }) as never,
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('payload_too_large');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 envelope_validation_failed when results.length > 1000 (cap)', async () => {
    const oversized = Array.from({ length: 1001 }, (_, i) => ({
      userId: `cuid_member_${i.toString().padStart(4, '0')}`,
      output: { weekStart: '2026-06-08' },
    }));
    const body = JSON.stringify({ weekStart: '2026-06-08', results: oversized });
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.91.0.2', body }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('envelope_validation_failed');
    expect(persistMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/calendar-batch/persist — happy path', () => {
  it('returns counts + total on success', async () => {
    persistMock.mockResolvedValueOnce({ persisted: 1, skipped: 0, errors: 0 });

    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.90.0.6', body: VALID_BODY }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ persisted: 1, skipped: 0, errors: 0, total: 1 });
    expect(persistMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/calendar-batch/persist — error path', () => {
  it('returns 500 + reportError + persist_failed audit when persistGeneratedCalendars throws', async () => {
    persistMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.90.0.7', body: VALID_BODY }) as never,
    );
    expect(res.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const auditArg = logAuditMock.mock.calls[0]?.[0] as {
      action?: string;
      metadata?: Record<string, unknown>;
    };
    expect(auditArg?.action).toBe('calendar.batch.persist_failed');
    expect(auditArg?.metadata?.stage).toBe('route_handler');
    expect(auditArg?.metadata?.error).toContain('db_unreachable');
  });
});
