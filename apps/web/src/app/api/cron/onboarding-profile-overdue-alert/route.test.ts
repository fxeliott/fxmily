import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S2 — route handler tests for POST /api/cron/onboarding-profile-overdue-alert.
 *
 * Carbon of the monthly-debrief-overdue-alert route test: pins the auth gate
 * (CRON_SECRET SHA-256 + timingSafeEqual), the rate-limit (real `cronLimiter`,
 * unique IP per test), GET → 405, the count-only happy-path JSON, and the 500
 * path. The DB/notification logic lives in `lib/onboarding-interview/overdue.ts`
 * (its own test) — here `runOnboardingProfileOverdueAlert` is mocked.
 */

const runAlertMock = vi.fn<(...args: unknown[]) => unknown>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/onboarding-interview/overdue', () => ({
  runOnboardingProfileOverdueAlert: runAlertMock,
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
  runAlertMock.mockReset();
  reportErrorMock.mockClear();
  runAlertMock.mockResolvedValue({
    overdueCount: 0,
    oldestCompletedAt: null,
    withinGrace: false,
    scannedAt: '2026-06-11T11:20:00.000Z',
    alerted: false,
    emailOutcome: 'not_attempted',
  });
});

function makeRequest(opts: { secret?: string; ip?: string; query?: string }): Request {
  const url = `https://app.fxmilyapp.com/api/cron/onboarding-profile-overdue-alert${opts.query ?? ''}`;
  const headers: Record<string, string> = {};
  if (opts.secret) headers['x-cron-secret'] = opts.secret;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return new Request(url, { method: 'POST', headers });
}

function uniqueIp(): string {
  return `192.0.2.${Math.floor(Math.random() * 250)}`;
}

describe('GET /api/cron/onboarding-profile-overdue-alert', () => {
  it('returns 405 method_not_allowed', () => {
    expect(GET().status).toBe(405);
  });
});

describe('POST /api/cron/onboarding-profile-overdue-alert — auth gate', () => {
  it('returns 401 when the secret header is missing (no scan work)', async () => {
    const res = await POST(makeRequest({ ip: uniqueIp() }) as never);
    expect(res.status).toBe(401);
    expect(runAlertMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret is wrong', async () => {
    const res = await POST(
      makeRequest({ secret: 'wrong_value_with_same_general_shape_xxxx', ip: uniqueIp() }) as never,
    );
    expect(res.status).toBe(401);
    expect(runAlertMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/onboarding-profile-overdue-alert — happy path', () => {
  it('runs the alert and returns the count-only JSON (no PII)', async () => {
    runAlertMock.mockResolvedValue({
      overdueCount: 2,
      oldestCompletedAt: '2026-06-09T09:00:00.000Z',
      withinGrace: false,
      scannedAt: '2026-06-11T11:20:00.000Z',
      alerted: true,
      emailOutcome: 'sent',
    });

    const res = await POST(makeRequest({ secret: TEST_CRON_SECRET, ip: uniqueIp() }) as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      overdueCount: 2,
      oldestCompletedAt: '2026-06-09T09:00:00.000Z',
      withinGrace: false,
      emailOutcome: 'sent',
    });
    expect(runAlertMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it('returns ok with overdueCount 0 when nothing is overdue', async () => {
    const res = await POST(makeRequest({ secret: TEST_CRON_SECRET, ip: uniqueIp() }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; overdueCount: number };
    expect(body.ok).toBe(true);
    expect(body.overdueCount).toBe(0);
  });
});

describe('POST /api/cron/onboarding-profile-overdue-alert — error path', () => {
  it('returns 500 scan_failed and reports to Sentry when the scan throws', async () => {
    runAlertMock.mockRejectedValue(new Error('DB unavailable'));

    const res = await POST(makeRequest({ secret: TEST_CRON_SECRET, ip: uniqueIp() }) as never);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'scan_failed' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      'cron.onboarding-profile-overdue-alert',
      expect.any(Error),
      expect.objectContaining({ route: '/api/cron/onboarding-profile-overdue-alert' }),
    );
  });
});
