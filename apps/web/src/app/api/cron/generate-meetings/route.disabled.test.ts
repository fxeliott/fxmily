import { describe, expect, it, vi } from 'vitest';

/**
 * V1.7 §30 J-M3 — the refuse-by-default 503 branch of the generate-meetings
 * cron, isolated in its own file because the env mock is module-level (static
 * per test file). Here `CRON_SECRET` is UNDEFINED, so the route must 503
 * BEFORE any rate-limit / generation work — it refuses to run unauthenticated,
 * even in dev (SPEC §J5 audit Security HIGH H2, carbone recompute-scores).
 */

const generateMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/meeting/service', () => ({
  generateMeetingsForWindow: generateMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  flushSentry: vi.fn(async () => undefined),
}));

// CRON_SECRET intentionally absent → 503 refuse-by-default.
vi.mock('@/lib/env', () => ({
  env: {
    AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    CRON_SECRET: undefined,
  },
}));

const { POST } = await import('./route');

describe('POST /api/cron/generate-meetings — CRON_SECRET not configured', () => {
  it('returns 503 cron_disabled and never runs the generation', async () => {
    const req = new Request('http://localhost:3000/api/cron/generate-meetings', {
      method: 'POST',
      headers: { 'x-cron-secret': 'whatever' },
    });

    const res = await POST(req as never);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('cron_disabled');
    expect(generateMock).not.toHaveBeenCalled();
  });
});
