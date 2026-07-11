import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for POST /api/admin/backup/heartbeat.
 *
 * Pattern carbone `autoheal/heartbeat/route.test.ts` (same auth gate, same 405
 * GET, same 500 path). Backup-specific pins :
 *   - zod .strict() rejects extra keys and out-of-range counts (400)
 *   - the audit row carries COUNTS ONLY (the whole §21.5 contract of the route)
 *   - `offsiteUploaded: false` is mirrored into `metadata.errors: 1` so a
 *     local-only backup escalates green → amber on the board
 *   - optional scriptVersion only appears when provided
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
  return new Request('https://app.fxmilyapp.com/api/admin/backup/heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

const VALID_BODY = { dumpBytes: 52_428_800, durationSecs: 42, offsiteUploaded: true };

describe('GET /api/admin/backup/heartbeat', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/backup/heartbeat — auth gate', () => {
  it('returns 401 when X-Admin-Token header is missing', async () => {
    const res = await POST(makeRequest({ ip: '10.85.0.1', body: VALID_BODY }));
    expect(res.status).toBe(401);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Token header is wrong', async () => {
    const res = await POST(
      makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip: '10.85.0.2', body: VALID_BODY }),
    );
    expect(res.status).toBe(401);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/backup/heartbeat — payload validation', () => {
  it('returns 400 on a non-schema payload (missing counts)', async () => {
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.85.0.3', body: {} }));
    expect(res.status).toBe(400);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns 400 on extra keys (.strict() — a payload smuggling PII is refused)', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.85.0.4',
        body: { ...VALID_BODY, bucketName: 'fxmily-backups-secret' },
      }),
    );
    expect(res.status).toBe(400);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/backup/heartbeat — happy path', () => {
  it('writes the counts-only heartbeat with errors=0 when offsite succeeded, returns 200', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.85.0.5',
        body: {
          dumpBytes: 52_428_800,
          durationSecs: 42,
          offsiteUploaded: true,
          scriptVersion: '1.1.0',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'cron.backup.heartbeat',
      metadata: {
        dumpBytes: 52_428_800,
        durationSecs: 42,
        offsiteUploaded: true,
        errors: 0,
        scriptVersion: '1.1.0',
      },
    });
  });

  it('mirrors offsiteUploaded=false into errors=1 (local-only backup → amber)', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.85.0.6',
        body: { dumpBytes: 52_428_800, durationSecs: 42, offsiteUploaded: false },
      }),
    );
    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'cron.backup.heartbeat',
      metadata: {
        dumpBytes: 52_428_800,
        durationSecs: 42,
        offsiteUploaded: false,
        errors: 1,
      },
    });
  });
});

describe('POST /api/admin/backup/heartbeat — error path', () => {
  it('returns 500 + reportError when the audit write throws', async () => {
    logAuditMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.85.0.7', body: VALID_BODY }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('heartbeat_failed');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});
