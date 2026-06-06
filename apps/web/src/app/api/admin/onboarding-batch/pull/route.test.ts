import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CP13 — Tests for POST /api/admin/onboarding-batch/pull (V2.4 Phase A.2).
 *
 * Closes the route-coverage asymmetry vs weekly-batch / monthly-batch.
 * Pattern carbone `weekly-batch/pull/route.test.ts`, minus the onboarding
 * divergences :
 *   - the pull endpoint takes NO query params (no ?currentWeek / previousFullWeek)
 *   - there is NO route-level MEMBER_LABEL_SALT 503 guard (the 503/429/401
 *     refuse-by-default behavior lives in `requireAdminToken` and is covered
 *     by `lib/auth/admin-token.test.ts` — we don't duplicate it here)
 *
 * What we pin :
 *   - 401 missing / wrong X-Admin-Token (auth gate wired)
 *   - 405 GET
 *   - happy path returns the BatchPullEnvelope as JSON, loader called once
 *   - 500 + reportError when the underlying loader throws
 */

const TEST_TOKEN = 'test_admin_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaaaaaa';

const loadMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/onboarding-interview/batch', () => ({
  loadAllSnapshotsForCompletedInterviews: loadMock,
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
  loadMock.mockReset();
  reportErrorMock.mockReset();
});

function makeRequest(opts: { token?: string; ip: string }): Request {
  const url = 'https://app.fxmilyapp.com/api/admin/onboarding-batch/pull';
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  return new Request(url, { method: 'POST', headers });
}

describe('GET /api/admin/onboarding-batch/pull', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/onboarding-batch/pull — auth gate', () => {
  it('returns 401 when X-Admin-Token header is missing', async () => {
    const res = await POST(makeRequest({ ip: '10.83.0.1' }) as never);
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Token header is wrong', async () => {
    const res = await POST(
      makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip: '10.83.0.2' }) as never,
    );
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/onboarding-batch/pull — happy path', () => {
  it('returns the envelope as JSON when token is valid', async () => {
    const fakeEnvelope = {
      ranAt: '2026-05-29T12:00:00.000Z',
      instrumentVersion: 'v1',
      systemPrompt: 'mock-system-prompt',
      outputJsonSchema: { type: 'object' },
      entries: [],
    };
    loadMock.mockResolvedValueOnce(fakeEnvelope);

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.83.0.3' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fakeEnvelope);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/onboarding-batch/pull — error path', () => {
  it('returns 500 + reportError when loader throws', async () => {
    loadMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.83.0.4' }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('batch_pull_failed');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});
