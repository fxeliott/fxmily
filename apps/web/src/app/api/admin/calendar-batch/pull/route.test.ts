import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §26 — Tests for POST /api/admin/calendar-batch/pull (J-C2).
 *
 * What we pin :
 *   - 401 when X-Admin-Token missing / wrong (auth gate via requireCalendarAdminToken)
 *   - happy path returns the CalendarBatchPullEnvelope as JSON + calls the loader with {}
 *   - GET → 405
 *   - 500 + reportError when the underlying loader throws
 *   - 503 in production NODE_ENV when MEMBER_LABEL_SALT is unset
 */

const TEST_TOKEN = 'test_calendar_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaa';

const loadMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/calendar/batch', () => ({
  loadAllSnapshotsForCalendarGeneration: loadMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  flushSentry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/env', () => ({
  env: {
    CALENDAR_ADMIN_BATCH_TOKEN: TEST_TOKEN,
    NODE_ENV: 'test',
    MEMBER_LABEL_SALT: 'test_salt_dummy_value_at_least_16_chars_xx',
  },
}));

import { currentParisWeekStart } from '@/lib/calendar/week';
import { shiftLocalDate } from '@/lib/checkin/timezone';

const { POST, GET } = await import('./route');

beforeEach(() => {
  loadMock.mockReset();
  reportErrorMock.mockReset();
});

function makeRequest(opts: { token?: string; ip: string; body?: unknown }): Request {
  const url = 'https://app.fxmilyapp.com/api/admin/calendar-batch/pull';
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    return new Request(url, { method: 'POST', headers, body: JSON.stringify(opts.body) });
  }
  return new Request(url, { method: 'POST', headers });
}

describe('GET /api/admin/calendar-batch/pull', () => {
  it('returns 405 method_not_allowed', () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/calendar-batch/pull — auth gate', () => {
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

describe('POST /api/admin/calendar-batch/pull — happy path', () => {
  it('returns the envelope as JSON when token is valid and calls the loader with {}', async () => {
    const fakeEnvelope = {
      ranAt: '2026-06-08T07:00:00Z',
      weekStart: '2026-06-08',
      systemPrompt: 'mock',
      outputJsonSchema: { type: 'object' },
      entries: [],
    };
    loadMock.mockResolvedValueOnce(fakeEnvelope);

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.80.0.3' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fakeEnvelope);
    expect(loadMock).toHaveBeenCalledWith({});
  });
});

describe('POST /api/admin/calendar-batch/pull — optional weekStart catch-up body', () => {
  // Relative anchors (never a hard-coded future date): current Paris Monday
  // and shifts of it, computed with the same pure helpers the route uses.
  const currentMonday = currentParisWeekStart();
  const pastMonday = shiftLocalDate(currentMonday, -7);
  const tooOldMonday = shiftLocalDate(currentMonday, -35);
  const notAMonday = shiftLocalDate(currentMonday, 2);

  it('accepts a past Monday within range and forwards it to the loader', async () => {
    loadMock.mockResolvedValueOnce({ weekStart: pastMonday, entries: [] });

    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.80.0.6', body: { weekStart: pastMonday } }) as never,
    );
    expect(res.status).toBe(200);
    expect(loadMock).toHaveBeenCalledWith({ weekStart: pastMonday });
  });

  it('rejects a non-Monday weekStart with 400', async () => {
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.80.0.7', body: { weekStart: notAMonday } }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_week_start');
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('rejects a weekStart older than 28 days with 400', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.80.0.8',
        body: { weekStart: tooOldMonday },
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown body key with 400 (strict schema)', async () => {
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.80.0.9', body: { week: currentMonday } }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_body');
    expect(loadMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/calendar-batch/pull — error path', () => {
  it('returns 500 + reportError when loader throws', async () => {
    loadMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.80.0.4' }) as never);
    expect(res.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/calendar-batch/pull — MEMBER_LABEL_SALT prod guard', () => {
  it('returns 503 in production NODE_ENV when MEMBER_LABEL_SALT is unset', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: {
        CALENDAR_ADMIN_BATCH_TOKEN: TEST_TOKEN,
        NODE_ENV: 'production',
        MEMBER_LABEL_SALT: undefined,
      },
    }));
    const { POST: gated } = await import('./route');

    const res = await gated(makeRequest({ token: TEST_TOKEN, ip: '10.80.0.5' }) as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('member_label_salt_missing');

    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });
});
