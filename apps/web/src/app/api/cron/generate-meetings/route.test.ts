import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.7 §30 J-M3 — Route handler tests for POST /api/cron/generate-meetings.
 *
 * Carbone the J10 `purge-deleted` route test. We pin :
 *   - 503 when CRON_SECRET is not configured (handled in a separate suite with
 *     its own env mock — refuse-by-default) ;
 *   - the auth gate (CRON_SECRET via SHA-256 + timingSafeEqual) → 401 ;
 *   - the rate-limit (5 burst, 1/min) → 429 + Retry-After (REAL cronLimiter,
 *     unique IP per test where bucket isolation matters) ;
 *   - happy-path : generation runs + a PII-free `meeting.generated` heartbeat
 *     audit row (counts + ranAt only) ;
 *   - idempotent re-run : a second call with all occurrences already present
 *     reports `generated: 0` (skipDuplicates) — still 200 + heartbeat ;
 *   - the GET → 405 contract.
 *
 * We mock the generation service so we don't hit the DB but we use the REAL
 * `cronLimiter` so the rate-limit branch is end-to-end.
 */

const generateMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/meeting/service', () => ({
  generateMeetingsForWindow: generateMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

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
  generateMock.mockReset();
  logAuditMock.mockClear();
  reportErrorMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRequest(opts: { secret?: string; ip?: string; query?: string }): Request {
  const url = `https://app.fxmilyapp.com/api/cron/generate-meetings${opts.query ?? ''}`;
  const headers: Record<string, string> = {};
  if (opts.secret) headers['x-cron-secret'] = opts.secret;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return new Request(url, { method: 'POST', headers });
}

describe('GET /api/cron/generate-meetings', () => {
  it('returns 405 method_not_allowed', () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/cron/generate-meetings — auth gate', () => {
  it('returns 401 when X-Cron-Secret header is missing', async () => {
    const res = await POST(
      makeRequest({ ip: `10.1.0.${Math.floor(Math.random() * 200)}` }) as never,
    );

    expect(res.status).toBe(401);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Cron-Secret is wrong', async () => {
    const res = await POST(
      makeRequest({
        secret: 'wrong_value_with_same_general_shape_xxxx',
        ip: `10.1.0.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(res.status).toBe(401);
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/generate-meetings — rate limit', () => {
  // Why this matters : the per-IP token bucket (5 burst) is the DoS + secret-
  // brute-force oracle protection. The 6th request from a single IP within the
  // refill window must 429 with a Retry-After header.
  it('returns 429 + Retry-After once the per-IP burst is exhausted', async () => {
    generateMock.mockResolvedValue({ generated: 0, skipped: 0 });
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;

    // Burst = 5 → first 5 pass the limiter (all 200 with the right secret).
    for (let i = 0; i < 5; i++) {
      const ok = await POST(makeRequest({ secret: TEST_CRON_SECRET, ip }) as never);
      expect(ok.status).toBe(200);
    }
    // 6th from the same IP → rate-limited BEFORE the secret check.
    const limited = await POST(makeRequest({ secret: TEST_CRON_SECRET, ip }) as never);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('POST /api/cron/generate-meetings — happy path + idempotence', () => {
  it('generates the window and emits a PII-free meeting.generated heartbeat', async () => {
    generateMock.mockResolvedValueOnce({ generated: 10, skipped: 0 });

    const res = await POST(
      makeRequest({
        secret: TEST_CRON_SECRET,
        ip: `192.0.2.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; generated: number; skipped: number };
    expect(body.ok).toBe(true);
    expect(body.generated).toBe(10);
    expect(body.skipped).toBe(0);

    // Service called with a YYYY-MM-DD fromLocalDate + the window day-span.
    expect(generateMock).toHaveBeenCalledTimes(1);
    const args = generateMock.mock.calls[0] as [string, number];
    expect(args[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args[1]).toBeGreaterThan(0);

    // Exactly one heartbeat audit row, PII-free (counts + ranAt only).
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const audit = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      userId?: string;
      metadata: Record<string, unknown>;
    };
    expect(audit.action).toBe('meeting.generated');
    expect(audit.userId).toBeUndefined();
    expect(audit.metadata.generated).toBe(10);
    expect(audit.metadata.skipped).toBe(0);
    expect(typeof audit.metadata.ranAt).toBe('string');
    // No member identity / no Ichor content ever in the heartbeat.
    expect(Object.keys(audit.metadata).sort()).toEqual(['generated', 'ranAt', 'skipped']);
  });

  it('re-run is idempotent: all occurrences already present → generated 0 + heartbeat', async () => {
    generateMock.mockResolvedValueOnce({ generated: 0, skipped: 10 });

    const res = await POST(
      makeRequest({
        secret: TEST_CRON_SECRET,
        ip: `192.0.2.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { generated: number; skipped: number };
    expect(body.generated).toBe(0);
    expect(body.skipped).toBe(10);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect((logAuditMock.mock.calls[0]?.[0] as { action: string }).action).toBe(
      'meeting.generated',
    );
  });
});

describe('POST /api/cron/generate-meetings — error path', () => {
  it('returns 500 scan_failed when generation throws, reports to Sentry, no heartbeat', async () => {
    generateMock.mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await POST(
      makeRequest({
        secret: TEST_CRON_SECRET,
        ip: `192.0.2.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'scan_failed' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      'cron.generate-meetings',
      expect.any(Error),
      expect.objectContaining({ route: '/api/cron/generate-meetings' }),
    );
    // No phantom heartbeat on a failed run.
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
