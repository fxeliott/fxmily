import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J9 — tests for POST /api/cron/health, focused on the WORKER fold.
 *
 * Why this file exists. This endpoint is the only thing that turns "a batch
 * stopped running" into a signal that reaches a human without anyone opening
 * /admin/system: `cron-watch.yml` calls it hourly and goes red on a 503. J9
 * folded the AI worker into it — and that fold had no test at all, on the one
 * route whose entire job is to be honest about failure.
 *
 * What we pin :
 *   - `WORKER_HOST=pc` (default) → the contract is UNCHANGED: the worker is not
 *     consulted, absent from the body, and a red worker cannot 503 the route.
 *     This is deliberate, not an oversight: a PC that is legitimately off at
 *     night would have opened an alert every evening.
 *   - `WORKER_HOST=server` → a red worker DOES return 503 even when every cron
 *     is green. That is the whole point of the jalon.
 *   - a green/amber worker keeps the route at 200 (amber is a degradation to
 *     look at, not an incident to page for).
 *   - the audit row carries the worker counts.
 */

const cronReportMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const workerReportMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const diskMock = vi.fn<(...args: unknown[]) => unknown>();
const isWorkerOnServerMock = vi.fn<() => boolean>();
const logAuditMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('@/lib/system/health', () => ({
  getCronHealthReport: cronReportMock,
  getWorkerHealthReport: workerReportMock,
  getDiskHealth: diskMock,
  isWorkerOnServer: isWorkerOnServerMock,
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));

vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  flushSentry: vi.fn(async () => undefined),
}));

const CRON_SECRET = 'test_cron_secret_at_least_24_chars_long_xxxx';

vi.mock('@/lib/env', () => ({
  env: { CRON_SECRET, NODE_ENV: 'test' },
}));

const { POST, GET } = await import('./route');

/** Minimal report shape the route reads: `overall` + `entries[].status`. */
function report(overall: string, statuses: string[] = []) {
  return {
    ranAt: '2026-08-02T12:00:00.000Z', // allow-absolute-date opaque-fixture
    overall,
    entries: statuses.map((status, i) => ({ action: `a${i}`, status })),
  };
}

let ipCounter = 0;
/** Fresh IP per call: the shared `cronLimiter` is module state across tests. */
function makeRequest(secret: string | null = CRON_SECRET): Request {
  ipCounter += 1;
  const headers: Record<string, string> = { 'x-forwarded-for': `10.9.0.${ipCounter}` };
  if (secret !== null) headers['x-cron-secret'] = secret;
  return new Request('https://app.fxmilyapp.com/api/cron/health', { method: 'POST', headers });
}

beforeEach(() => {
  cronReportMock.mockReset();
  workerReportMock.mockReset();
  diskMock.mockReset();
  isWorkerOnServerMock.mockReset();
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
  diskMock.mockReturnValue({ status: 'green', freeBytes: 100 * 1024 ** 3 });
});

describe('POST /api/cron/health — auth', () => {
  it('returns 405 on GET (the URL never leaks via referer)', () => {
    expect(GET().status).toBe(405);
  });

  it('returns 401 without the shared secret', async () => {
    const res = await POST(makeRequest(null) as never);
    expect(res.status).toBe(401);
    expect(cronReportMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/health — WORKER_HOST=pc (unchanged contract)', () => {
  it('does not consult the worker at all, and omits it from the body', async () => {
    isWorkerOnServerMock.mockReturnValue(false);
    cronReportMock.mockResolvedValue(report('green', ['green']));

    const res = await POST(makeRequest() as never);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(workerReportMock).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('worker');
  });

  it('stays 200 even if the worker board is red — the PC is allowed to be off', async () => {
    isWorkerOnServerMock.mockReturnValue(false);
    cronReportMock.mockResolvedValue(report('green', ['green']));
    // Would be red if it were consulted. It must not be.
    workerReportMock.mockResolvedValue(report('red', ['red']));

    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(200);
    expect(workerReportMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/health — WORKER_HOST=server (J9)', () => {
  it('returns 503 on a red worker even when every cron is green', async () => {
    isWorkerOnServerMock.mockReturnValue(true);
    cronReportMock.mockResolvedValue(report('green', ['green', 'green']));
    workerReportMock.mockResolvedValue(report('red', ['green', 'red']));

    const res = await POST(makeRequest() as never);
    const body = (await res.json()) as { worker?: { overall: string } };

    expect(res.status).toBe(503);
    expect(body.worker?.overall).toBe('red');
  });

  it('returns 503 on a worker that never ran (a pipeline that was never installed)', async () => {
    isWorkerOnServerMock.mockReturnValue(true);
    cronReportMock.mockResolvedValue(report('green', ['green']));
    workerReportMock.mockResolvedValue(report('never_ran', ['never_ran']));

    expect((await POST(makeRequest() as never)).status).toBe(503);
  });

  it('stays 200 on an amber worker — a degradation is not a page-out', async () => {
    isWorkerOnServerMock.mockReturnValue(true);
    cronReportMock.mockResolvedValue(report('green', ['green']));
    workerReportMock.mockResolvedValue(report('amber', ['amber']));

    expect((await POST(makeRequest() as never)).status).toBe(200);
  });

  it('records the worker counts in the audit row', async () => {
    isWorkerOnServerMock.mockReturnValue(true);
    cronReportMock.mockResolvedValue(report('green', ['green']));
    workerReportMock.mockResolvedValue(report('red', ['red', 'red', 'never_ran', 'green']));

    await POST(makeRequest() as never);

    const call = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(call.action).toBe('cron.health.scan');
    expect(call.metadata.workerOverall).toBe('red');
    expect(call.metadata.workerRed).toBe(2);
    expect(call.metadata.workerNeverRan).toBe(1);
  });

  it('still 503s on a red DISK while the worker is green (no regression)', async () => {
    isWorkerOnServerMock.mockReturnValue(true);
    cronReportMock.mockResolvedValue(report('green', ['green']));
    workerReportMock.mockResolvedValue(report('green', ['green']));
    diskMock.mockReturnValue({ status: 'red', freeBytes: 1024 });

    expect((await POST(makeRequest() as never)).status).toBe(503);
  });
});
