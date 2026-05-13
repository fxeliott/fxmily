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

describe('POST /api/admin/weekly-batch/persist — hardening tests pin V1.7.2 (R2 post-merge)', () => {
  it('returns 413 when UTF-8 byte length > 16 MiB (emoji 4-byte amplification)', async () => {
    // Pin defense at route.ts:107 — Buffer.byteLength('utf8') !== string.length.
    // 4-byte codepoints (🚀, 4 UTF-8 bytes) inflate the wire size 2-4× vs
    // JS UTF-16 char count. Without this check, attacker could lie about
    // Content-Length and pass a body that explodes after req.text().
    const emoji = '🚀'; // 4 UTF-8 bytes per char
    const oversizedSummary = emoji.repeat(5_000_000); // ~20 MiB UTF-8
    const body = JSON.stringify({
      weekStart: '2026-05-04',
      weekEnd: '2026-05-10',
      results: [
        {
          userId: 'cuid_emoji_test',
          output: { summary: oversizedSummary, risks: [], recommendations: ['r'], patterns: {} },
        },
      ],
    });
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.71.0.1',
        body,
        declaredLength: 100, // lying low content-length to bypass cheap header check
      }) as never,
    );
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe('payload_too_large');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 body_read_failed when req.text() rejects (stream error)', async () => {
    // Pin defense at route.ts:95-101 — try/catch around req.text(). If the
    // underlying ReadableStream errors mid-read, return a clear 400 instead
    // of crashing the route handler with an unhandled rejection.
    const req = new Request('https://app.fxmilyapp.com/api/admin/weekly-batch/persist', {
      method: 'POST',
      headers: {
        'x-admin-token': TEST_TOKEN,
        'x-forwarded-for': '10.71.0.2',
        'content-type': 'application/json',
      },
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error('simulated_stream_abort'));
        },
      }),
      // @ts-expect-error — duplex is required when body is a ReadableStream
      duplex: 'half',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('body_read_failed');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 envelope_validation_failed when results.length > 1000 (H4 cap)', async () => {
    // Pin V1.7.2 post-merge security-auditor R2 H4 fix : results capped at
    // 1000 entries (V1 30 members × 1 = 30 entries ; V2 1000 × 1 = 1000).
    // Above 1000 = malicious/corrupted, refuse before JSON.parse heap blow.
    const oversizedResults = Array.from({ length: 1001 }, (_, i) => ({
      userId: `cuid_member_${i.toString().padStart(4, '0')}`,
      output: { summary: 's', risks: [], recommendations: ['r'], patterns: {} },
    }));
    const body = JSON.stringify({
      weekStart: '2026-05-04',
      weekEnd: '2026-05-10',
      results: oversizedResults,
    });
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.71.0.3', body }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('envelope_validation_failed');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('accepts results.length === 1000 (boundary exact, no off-by-one)', async () => {
    persistMock.mockResolvedValueOnce({ persisted: 0, skipped: 1000, errors: 0 });
    const exactlyMaxResults = Array.from({ length: 1000 }, (_, i) => ({
      userId: `cuid_member_${i.toString().padStart(4, '0')}`,
      output: { summary: 's', risks: [], recommendations: ['r'], patterns: {} },
    }));
    const body = JSON.stringify({
      weekStart: '2026-05-04',
      weekEnd: '2026-05-10',
      results: exactlyMaxResults,
    });
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.71.0.4', body }) as never);
    expect(res.status).toBe(200);
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
