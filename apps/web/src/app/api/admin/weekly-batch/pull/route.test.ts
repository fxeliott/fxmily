import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.7.2 — Tests for POST /api/admin/weekly-batch/pull.
 *
 * What we pin :
 *   - 401 when X-Admin-Token missing (auth gate)
 *   - 401 when X-Admin-Token wrong
 *   - happy path returns the BatchPullEnvelope as JSON
 *   - happy path with ?currentWeek=true forwards `previousFullWeek: false`
 *   - GET → 405
 *   - 500 + reportError when the underlying loader throws
 */

const TEST_TOKEN = 'test_admin_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaaaaaa';

const loadMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/weekly-report/batch', () => ({
  loadAllSnapshotsForActiveMembers: loadMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  flushSentry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/env', () => ({
  env: {
    ADMIN_BATCH_TOKEN: TEST_TOKEN,
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
  const url = `https://app.fxmilyapp.com/api/admin/weekly-batch/pull${opts.query ?? ''}`;
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  return new Request(url, { method: 'POST', headers });
}

describe('GET /api/admin/weekly-batch/pull', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/weekly-batch/pull — auth gate', () => {
  it('returns 401 when X-Admin-Token header is missing', async () => {
    const res = await POST(makeRequest({ ip: '10.60.0.1' }) as never);
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Token header is wrong', async () => {
    const res = await POST(
      makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip: '10.60.0.2' }) as never,
    );
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/weekly-batch/pull — happy path', () => {
  it('returns the envelope as JSON when token is valid', async () => {
    const fakeEnvelope = {
      ranAt: '2026-05-13T12:00:00Z',
      weekStart: '2026-05-04',
      weekEnd: '2026-05-10',
      systemPrompt: 'mock',
      outputJsonSchema: { type: 'object' },
      entries: [],
    };
    loadMock.mockResolvedValueOnce(fakeEnvelope);

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.60.0.3' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fakeEnvelope);
    expect(loadMock).toHaveBeenCalledWith({ previousFullWeek: true });
  });

  it('forwards previousFullWeek: false when ?currentWeek=true', async () => {
    loadMock.mockResolvedValueOnce({
      ranAt: 'x',
      weekStart: 'x',
      weekEnd: 'x',
      systemPrompt: 'x',
      outputJsonSchema: {},
      entries: [],
    });

    await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.60.0.4',
        query: '?currentWeek=true',
      }) as never,
    );
    expect(loadMock).toHaveBeenCalledWith({ previousFullWeek: false });
  });
});

describe('POST /api/admin/weekly-batch/pull — error path', () => {
  it('returns 500 + reportError when loader throws', async () => {
    loadMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.60.0.5' }) as never);
    expect(res.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/weekly-batch/pull — V1.7.2 audit fix : MEMBER_LABEL_SALT prod guard', () => {
  it('returns 503 in production NODE_ENV when MEMBER_LABEL_SALT is unset', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: {
        ADMIN_BATCH_TOKEN: TEST_TOKEN,
        NODE_ENV: 'production',
        MEMBER_LABEL_SALT: undefined,
      },
    }));
    const { POST: gated } = await import('./route');

    const res = await gated(makeRequest({ token: TEST_TOKEN, ip: '10.60.0.6' }) as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('member_label_salt_missing');

    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });
});
