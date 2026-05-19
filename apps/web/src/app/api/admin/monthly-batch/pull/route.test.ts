import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.4 §25 — Tests for POST /api/admin/monthly-batch/pull.
 * Carbon of the weekly-batch pull route test.
 */

const TEST_TOKEN = 'test_monthly_admin_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaaaaaa';

const loadMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/monthly-debrief/batch', () => ({
  loadAllSnapshotsForActiveMembers: loadMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  flushSentry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/env', () => ({
  env: {
    MONTHLY_ADMIN_BATCH_TOKEN: TEST_TOKEN,
    NODE_ENV: 'test',
    MEMBER_LABEL_SALT: 'test_salt_dummy_value_at_least_16_chars_xx',
  },
}));

const { POST, GET } = await import('./route');

beforeEach(() => {
  loadMock.mockReset();
  reportErrorMock.mockReset();
});

function makeRequest(opts: { token?: string; ip: string; query?: string }): Request {
  const url = `https://app.fxmilyapp.com/api/admin/monthly-batch/pull${opts.query ?? ''}`;
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  return new Request(url, { method: 'POST', headers });
}

describe('GET /api/admin/monthly-batch/pull', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/monthly-batch/pull — auth gate', () => {
  it('returns 401 when X-Admin-Token header is missing', async () => {
    const res = await POST(makeRequest({ ip: '10.80.0.1' }) as never);
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Token header is wrong', async () => {
    const res = await POST(
      makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip: '10.80.0.2' }) as never,
    );
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/monthly-batch/pull — happy path', () => {
  it('returns the envelope as JSON when token is valid (default = just-ended month)', async () => {
    const fakeEnvelope = {
      ranAt: '2026-05-01T02:00:00Z',
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      systemPrompt: 'mock',
      outputJsonSchema: { type: 'object' },
      entries: [],
    };
    loadMock.mockResolvedValueOnce(fakeEnvelope);

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.80.0.3' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fakeEnvelope);
    expect(loadMock).toHaveBeenCalledWith({ currentMonth: false });
  });

  it('forwards currentMonth: true when ?currentMonth=true', async () => {
    loadMock.mockResolvedValueOnce({
      ranAt: 'x',
      monthStart: 'x',
      monthEnd: 'x',
      systemPrompt: 'x',
      outputJsonSchema: {},
      entries: [],
    });

    await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.80.0.4',
        query: '?currentMonth=true',
      }) as never,
    );
    expect(loadMock).toHaveBeenCalledWith({ currentMonth: true });
  });
});

describe('POST /api/admin/monthly-batch/pull — error path', () => {
  it('returns 500 + reportError when loader throws', async () => {
    loadMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.80.0.5' }) as never);
    expect(res.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/monthly-batch/pull — MEMBER_LABEL_SALT prod guard', () => {
  it('returns 503 in production NODE_ENV when MEMBER_LABEL_SALT is unset', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: {
        MONTHLY_ADMIN_BATCH_TOKEN: TEST_TOKEN,
        NODE_ENV: 'production',
        MEMBER_LABEL_SALT: undefined,
      },
    }));
    const { POST: gated } = await import('./route');

    const res = await gated(makeRequest({ token: TEST_TOKEN, ip: '10.80.0.6' }) as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('member_label_salt_missing');

    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });
});
