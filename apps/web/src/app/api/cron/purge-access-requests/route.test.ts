import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2.5 — Route handler tests for POST /api/cron/purge-access-requests.
 *
 * Carbon of the purge-deleted route test: pins the auth gate (CRON_SECRET via
 * SHA-256 + timingSafeEqual), the rate-limit (real `cronLimiter`, unique IP per
 * test), the GET → 405 contract, the purge `deleteMany` predicate (rejected OR
 * pending/approved > 30d), the PII-free heartbeat audit row, and the 500 error
 * path.
 */

const deleteManyMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/db', () => ({
  db: { accessRequest: { deleteMany: deleteManyMock } },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  flushSentry: vi.fn(async () => undefined),
}));

const TEST_CRON_SECRET = 'test_cron_secret_dummy_value_32chars_x';

vi.mock('@/lib/env', () => ({
  env: {
    AUTH_URL: 'https://app.fxmilyapp.com',
    NODE_ENV: 'test',
    CRON_SECRET: TEST_CRON_SECRET,
  },
}));

const { POST, GET } = await import('./route');

beforeEach(() => {
  deleteManyMock.mockReset();
  logAuditMock.mockClear();
  reportErrorMock.mockClear();
  deleteManyMock.mockResolvedValue({ count: 0 });
});

function makeRequest(opts: { secret?: string; ip?: string; query?: string }): Request {
  const url = `https://app.fxmilyapp.com/api/cron/purge-access-requests${opts.query ?? ''}`;
  const headers: Record<string, string> = {};
  if (opts.secret) headers['x-cron-secret'] = opts.secret;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return new Request(url, { method: 'POST', headers });
}

function uniqueIp(): string {
  return `192.0.2.${Math.floor(Math.random() * 250)}`;
}

describe('GET /api/cron/purge-access-requests', () => {
  it('returns 405 method_not_allowed', () => {
    expect(GET().status).toBe(405);
  });
});

describe('POST /api/cron/purge-access-requests — auth gate', () => {
  it('returns 401 when the secret header is missing (no DB work)', async () => {
    const res = await POST(makeRequest({ ip: uniqueIp() }) as never);
    expect(res.status).toBe(401);
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret is wrong', async () => {
    const res = await POST(
      makeRequest({ secret: 'wrong_value_with_same_general_shape_xxxx', ip: uniqueIp() }) as never,
    );
    expect(res.status).toBe(401);
    expect(deleteManyMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/purge-access-requests — happy path + purge logic', () => {
  it('deletes rejected + stale pending/approved rows and emits a PII-free heartbeat', async () => {
    deleteManyMock.mockResolvedValue({ count: 4 });

    const res = await POST(makeRequest({ secret: TEST_CRON_SECRET, ip: uniqueIp() }) as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; purged: number };
    expect(body).toEqual({ ok: true, purged: 4 });

    // Purge predicate: rejected (any age) OR pending/approved older than 30d.
    const arg = deleteManyMock.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    const or = arg.where.OR;
    expect(or).toHaveLength(3);
    expect(or).toContainEqual({ status: 'rejected' });
    expect(or.some((c) => c.status === 'pending' && 'createdAt' in c)).toBe(true);
    expect(or.some((c) => c.status === 'approved' && 'createdAt' in c)).toBe(true);

    // Heartbeat audit row — counts only, NO PII.
    const audit = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(audit.action).toBe('cron.purge_access_requests.scan');
    expect(audit.metadata.purged).toBe(4);
    expect(audit.metadata.thresholdDays).toBe(30);
    expect(JSON.stringify(audit.metadata)).not.toMatch(/@/); // no email leaked
  });

  it('uses a 30-day-ago threshold for the stale pending/approved cutoff', async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });

    const before = Date.now();
    await POST(makeRequest({ secret: TEST_CRON_SECRET, ip: uniqueIp() }) as never);
    const after = Date.now();

    const arg = deleteManyMock.mock.calls[0]?.[0] as {
      where: { OR: Array<{ status: string; createdAt?: { lt: Date } }> };
    };
    const pending = arg.where.OR.find((c) => c.status === 'pending');
    const thresholdMs = pending?.createdAt?.lt.getTime() ?? 0;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    // Threshold = now - 30d (the env mock's https AUTH_URL forces prod-runtime,
    // so the ?at override is intentionally ignored — real `new Date()` is used).
    expect(thresholdMs).toBeGreaterThanOrEqual(before - THIRTY_DAYS - 1000);
    expect(thresholdMs).toBeLessThanOrEqual(after - THIRTY_DAYS + 1000);
  });
});

describe('POST /api/cron/purge-access-requests — error path', () => {
  it('returns 500 scan_failed and reports to Sentry when deleteMany throws', async () => {
    deleteManyMock.mockRejectedValue(new Error('DB unavailable'));

    const res = await POST(makeRequest({ secret: TEST_CRON_SECRET, ip: uniqueIp() }) as never);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'scan_failed' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      'cron.purge-access-requests',
      expect.any(Error),
      expect.objectContaining({ route: '/api/cron/purge-access-requests' }),
    );
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
