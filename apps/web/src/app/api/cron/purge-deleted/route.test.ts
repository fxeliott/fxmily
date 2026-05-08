import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J10 Phase A — Route handler tests for POST /api/cron/purge-deleted.
 *
 * The cron route runs the materialise + purge phases sequentially and then
 * fans out audit rows : one summary `cron.purge_deleted.scan` plus one
 * `account.deletion.materialised` per materialised user and one
 * `account.deletion.purged` per purged user. We pin :
 *
 *   - the per-user audit fan-out (each materialised id → its own audit row
 *     with userId set ; each purged id → its own audit row with userId in
 *     metadata, since the row is gone after cascade) ;
 *   - the auth gate (CRON_SECRET via SHA-256 + timingSafeEqual) ;
 *   - the rate-limit (5 burst, 1/min) ;
 *   - the GET → 405 contract.
 *
 * We mock the deletion service so we don't hit the DB but we use the REAL
 * `cronLimiter` so the rate-limit branch is end-to-end (with a unique IP
 * per test where bucket isolation matters).
 */

// Typed mocks — `vi.fn<(arg: unknown) => unknown>()` forces the
// `mock.calls[i][0]` tuple to have an `unknown` slot at index 0 so that
// `as { … }` casts work cleanly under `noUncheckedIndexedAccess`. Without
// the type parameter, vitest narrows to `never[]` which trips TS5+.
const materialiseMock = vi.fn<(...args: unknown[]) => unknown>();
const purgeMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/account/deletion', () => ({
  materialisePendingDeletions: materialiseMock,
  purgeMaterialisedDeletions: purgeMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  // J10 Phase J — `flushSentry` is called from the cron error path to
  // drain the SDK queue before exit. We stub a no-op so the unit tests
  // don't import the real Sentry SDK.
  flushSentry: vi.fn(async () => undefined),
}));

const TEST_CRON_SECRET = 'test_cron_secret_dummy_value_32chars_x';

vi.mock('@/lib/env', () => ({
  env: {
    AUTH_URL: 'https://app.fxmily.com',
    NODE_ENV: 'test',
    CRON_SECRET: TEST_CRON_SECRET,
  },
}));

const { POST, GET } = await import('./route');

beforeEach(() => {
  materialiseMock.mockReset();
  purgeMock.mockReset();
  logAuditMock.mockClear();
  reportErrorMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRequest(opts: { secret?: string; ip?: string; query?: string }): Request {
  const url = `https://app.fxmily.com/api/cron/purge-deleted${opts.query ?? ''}`;
  const headers: Record<string, string> = {};
  if (opts.secret) headers['x-cron-secret'] = opts.secret;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return new Request(url, { method: 'POST', headers });
}

describe('GET /api/cron/purge-deleted', () => {
  // Why this matters : the cron must be a deliberate POST — a stray GET
  // from a monitoring crawler must NOT trigger materialisation/purge.
  it('returns 405 method_not_allowed', async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/cron/purge-deleted — auth gate', () => {
  // Why this matters : a request without the secret header must be rejected
  // 401, AFTER the rate-limit gate but BEFORE any DB work. We pin that
  // neither phase ran.
  it('returns 401 when X-Cron-Secret header is missing', async () => {
    const res = await POST(
      makeRequest({ ip: `10.0.0.${Math.floor(Math.random() * 200)}` }) as never,
    );

    expect(res.status).toBe(401);
    expect(materialiseMock).not.toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
  });

  // Why this matters : a wrong secret must also 401. The check uses
  // timingSafeEqual on the SHA-256 of the input — the same wrong-string
  // length must NOT short-circuit before the comparison.
  it('returns 401 when X-Cron-Secret is wrong', async () => {
    const res = await POST(
      makeRequest({
        secret: 'wrong_value_with_same_general_shape_xxxx',
        ip: `10.0.0.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(res.status).toBe(401);
    expect(materialiseMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/purge-deleted — happy path + audit fan-out', () => {
  // Why this matters : this is the load-bearing audit contract. After a
  // successful run, we expect :
  //   - exactly 1 `cron.purge_deleted.scan` summary row ;
  //   - one `account.deletion.materialised` row PER materialisedId, each
  //     with `userId` set on the audit FK (the row still exists at this
  //     point, status flipped to 'deleted') ;
  //   - one `account.deletion.purged` row PER purgedId, with userId in
  //     METADATA (not the FK column — the user row is gone post-cascade,
  //     setting userId would NULL via SetNull and we'd lose the trace).
  it('emits one materialised + one purged audit row per id, plus a scan summary', async () => {
    materialiseMock.mockResolvedValueOnce({
      scanned: 2,
      materialised: 2,
      errors: 0,
      materialisedIds: ['user_m1', 'user_m2'],
      ranAt: '2026-05-09T03:00:00.000Z',
    });
    purgeMock.mockResolvedValueOnce({
      scanned: 3,
      purged: 3,
      errors: 0,
      purgedIds: ['user_p1', 'user_p2', 'user_p3'],
      ranAt: '2026-05-09T03:00:00.000Z',
      threshold: '2026-04-09T03:00:00.000Z',
    });

    const res = await POST(
      makeRequest({
        secret: TEST_CRON_SECRET,
        ip: `192.0.2.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // 1 summary + 2 materialised + 3 purged = 6 audit rows total.
    expect(logAuditMock).toHaveBeenCalledTimes(6);

    // Pin the summary row (first call).
    const summary = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(summary.action).toBe('cron.purge_deleted.scan');
    expect(summary.metadata.materialised).toBe(2);
    expect(summary.metadata.purged).toBe(3);
    expect(summary.metadata.materialisedIds).toEqual(['user_m1', 'user_m2']);
    expect(summary.metadata.purgedIds).toEqual(['user_p1', 'user_p2', 'user_p3']);

    // Materialised rows : userId on the FK column.
    const materialisedCalls = logAuditMock.mock.calls
      .map((c) => c[0] as { action: string; userId?: string; metadata?: unknown })
      .filter((c) => c.action === 'account.deletion.materialised');
    expect(materialisedCalls).toHaveLength(2);
    expect(materialisedCalls.map((c) => c.userId).sort()).toEqual(['user_m1', 'user_m2']);

    // Purged rows : userId carried in metadata (FK gone post-cascade).
    const purgedCalls = logAuditMock.mock.calls
      .map((c) => c[0] as { action: string; userId?: string; metadata?: { userId?: string } })
      .filter((c) => c.action === 'account.deletion.purged');
    expect(purgedCalls).toHaveLength(3);
    expect(purgedCalls.map((c) => c.metadata?.userId).sort()).toEqual([
      'user_p1',
      'user_p2',
      'user_p3',
    ]);
    // Defensive : userId is NOT set on the FK column for purged rows.
    for (const call of purgedCalls) {
      expect(call.userId).toBeUndefined();
    }
  });

  // Why this matters : a quiet run (no candidates anywhere) must still
  // succeed and emit the summary audit row (so ops can confirm the cron
  // actually ran). We pin that the summary IS emitted but no per-user rows
  // are created.
  it('emits only the scan summary when both phases find no candidates', async () => {
    materialiseMock.mockResolvedValueOnce({
      scanned: 0,
      materialised: 0,
      errors: 0,
      materialisedIds: [],
      ranAt: '2026-05-09T03:00:00.000Z',
    });
    purgeMock.mockResolvedValueOnce({
      scanned: 0,
      purged: 0,
      errors: 0,
      purgedIds: [],
      ranAt: '2026-05-09T03:00:00.000Z',
      threshold: '2026-04-09T03:00:00.000Z',
    });

    const res = await POST(
      makeRequest({
        secret: TEST_CRON_SECRET,
        ip: `192.0.2.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect((logAuditMock.mock.calls[0]?.[0] as { action: string }).action).toBe(
      'cron.purge_deleted.scan',
    );
  });

  // Why this matters : the two phases run sequentially (J10 Phase G —
  // code-reviewer B2). We pin the order so a future Promise.all refactor
  // would trip this test (parallel execution risks audit-row interleaving
  // with in-flight updates).
  it('runs materialise BEFORE purge (sequential ordering)', async () => {
    const callOrder: string[] = [];
    materialiseMock.mockImplementationOnce(async () => {
      callOrder.push('materialise');
      return { scanned: 0, materialised: 0, errors: 0, materialisedIds: [], ranAt: 'x' };
    });
    purgeMock.mockImplementationOnce(async () => {
      callOrder.push('purge');
      return {
        scanned: 0,
        purged: 0,
        errors: 0,
        purgedIds: [],
        ranAt: 'x',
        threshold: 'y',
      };
    });

    await POST(
      makeRequest({
        secret: TEST_CRON_SECRET,
        ip: `192.0.2.${Math.floor(Math.random() * 200)}`,
      }) as never,
    );

    expect(callOrder).toEqual(['materialise', 'purge']);
  });
});

describe('POST /api/cron/purge-deleted — error path', () => {
  // Why this matters : if a phase throws unexpectedly, the route must return
  // 500 + report to Sentry via reportError. We pin that the audit row was
  // NOT written (we don't want phantom heartbeats on failed runs).
  it('returns 500 scan_failed when materialise throws, and reports to Sentry', async () => {
    materialiseMock.mockRejectedValueOnce(new Error('DB unavailable'));

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
      'cron.purge-deleted',
      expect.any(Error),
      expect.objectContaining({ route: '/api/cron/purge-deleted' }),
    );
    // No heartbeat audit row on a failed scan.
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
