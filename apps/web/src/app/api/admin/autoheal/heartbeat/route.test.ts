import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tour 14 — Tests for POST /api/admin/autoheal/heartbeat.
 *
 * Pattern carbone `worker-watchdog/heartbeat/route.test.ts` (same auth gate,
 * same 405 GET, same 500 path). Autoheal-specific pins :
 *   - zod .strict() rejects extra keys and out-of-range counts (400)
 *   - the audit row carries COUNTS ONLY (the whole §21.5 contract of the route)
 *   - `escalations` is mirrored into `metadata.errors` so a fresh-but-escalating
 *     watchdog escalates green → amber on the board
 *   - optional watchdogVersion only appears when provided
 */

const TEST_TOKEN = 'test_admin_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaaaaaa';

const logAuditMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  flushSentry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/env', () => ({
  env: {
    ADMIN_BATCH_TOKEN: TEST_TOKEN,
  },
}));

const { POST, GET } = await import('./route');

beforeEach(() => {
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
  reportErrorMock.mockReset();
});

function makeRequest(opts: { token?: string; ip: string; body?: unknown }): Request {
  const headers: Record<string, string> = {
    'x-forwarded-for': opts.ip,
    'content-type': 'application/json',
  };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  return new Request('https://app.fxmilyapp.com/api/admin/autoheal/heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

const VALID_BODY = { containersChecked: 2, restarts: 0, escalations: 0 };

describe('GET /api/admin/autoheal/heartbeat', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/autoheal/heartbeat — auth gate', () => {
  it('returns 401 when X-Admin-Token header is missing', async () => {
    const res = await POST(makeRequest({ ip: '10.84.0.1', body: VALID_BODY }));
    expect(res.status).toBe(401);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Token header is wrong', async () => {
    const res = await POST(
      makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip: '10.84.0.2', body: VALID_BODY }),
    );
    expect(res.status).toBe(401);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/autoheal/heartbeat — payload validation', () => {
  it('returns 400 on a non-schema payload (missing counts)', async () => {
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.84.0.3', body: {} }));
    expect(res.status).toBe(400);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns 400 on extra keys (.strict() — a payload smuggling PII is refused)', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.84.0.4',
        body: { ...VALID_BODY, containerName: 'fxmily-web-secret' },
      }),
    );
    expect(res.status).toBe(400);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/autoheal/heartbeat — happy path', () => {
  it('writes the counts-only heartbeat, mirrors escalations into errors, returns 200', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.84.0.5',
        body: {
          containersChecked: 2,
          restarts: 3,
          escalations: 1,
          watchdogVersion: '1.1.0',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'cron.autoheal.heartbeat',
      metadata: {
        containersChecked: 2,
        restarts: 3,
        escalations: 1,
        errors: 1,
        watchdogVersion: '1.1.0',
      },
    });
  });

  it('omits optional watchdogVersion but always carries errors=escalations', async () => {
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.84.0.6', body: VALID_BODY }));
    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'cron.autoheal.heartbeat',
      metadata: { containersChecked: 2, restarts: 0, escalations: 0, errors: 0 },
    });
  });
});

describe('POST /api/admin/autoheal/heartbeat — error path', () => {
  it('returns 500 + reportError when the audit write throws', async () => {
    logAuditMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.84.0.7', body: VALID_BODY }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('heartbeat_failed');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});
