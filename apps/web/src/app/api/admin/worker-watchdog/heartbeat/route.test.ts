import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tour 12 — Tests for POST /api/admin/worker-watchdog/heartbeat.
 *
 * Pattern carbone `onboarding-batch/pull/route.test.ts` (same auth gate,
 * same 405 GET, same 500 path). Watchdog-specific pins :
 *   - zod .strict() rejects extra keys and out-of-range counts (400)
 *   - the audit row carries COUNTS ONLY (the whole §21.5 contract of the
 *     route) — pinned by asserting the exact metadata shape
 *   - optional errorLabels/watchdogVersion only appear when provided
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
  return new Request('https://app.fxmilyapp.com/api/admin/worker-watchdog/heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

const VALID_BODY = { tasksChecked: 6, tasksOk: 6, repaired: 0, errors: 0 };

describe('GET /api/admin/worker-watchdog/heartbeat', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/worker-watchdog/heartbeat — auth gate', () => {
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

describe('POST /api/admin/worker-watchdog/heartbeat — payload validation', () => {
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
        body: { ...VALID_BODY, memberEmail: 'leak@example.com' },
      }),
    );
    expect(res.status).toBe(400);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/worker-watchdog/heartbeat — happy path', () => {
  it('writes the counts-only heartbeat audit row and returns 200', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.84.0.5',
        body: {
          ...VALID_BODY,
          repaired: 2,
          errors: 1,
          errorLabels: ['task_missing:calendar'],
          watchdogVersion: '1.0.0',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'worker.watchdog.heartbeat',
      metadata: {
        tasksChecked: 6,
        tasksOk: 6,
        repaired: 2,
        errors: 1,
        errorLabels: ['task_missing:calendar'],
        watchdogVersion: '1.0.0',
      },
    });
  });

  it('omits optional fields from the audit metadata when absent', async () => {
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.84.0.6', body: VALID_BODY }));
    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'worker.watchdog.heartbeat',
      metadata: { tasksChecked: 6, tasksOk: 6, repaired: 0, errors: 0 },
    });
  });
});

describe('POST /api/admin/worker-watchdog/heartbeat — error path', () => {
  it('returns 500 + reportError when the audit write throws', async () => {
    logAuditMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.84.0.7', body: VALID_BODY }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('heartbeat_failed');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});
