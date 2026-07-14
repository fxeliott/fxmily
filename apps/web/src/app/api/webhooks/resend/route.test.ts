import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

/**
 * J2 — Resend webhook route unit tests (item 9 : "signature webhook").
 *
 * We drive the handler through its full decision tree without a real Postgres
 * or a real svix secret: `resend` (the signature verifier), `@/lib/env`,
 * `@/lib/db` and `@/lib/observability` are all mocked. `@/lib/email/suppression`
 * stays REAL — it only touches `db.emailSuppression.upsert`, which the db mock
 * provides, so the bounce → suppression side-effect is exercised end-to-end.
 */

const mocks = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  env: {
    RESEND_WEBHOOK_SECRET: 'whsec_test' as string | undefined,
    RESEND_API_KEY: 're_test' as string | undefined,
  },
  db: {
    emailEvent: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    emailSuppression: { upsert: vi.fn() },
  },
  reportInfo: vi.fn(),
  reportWarning: vi.fn(),
  reportError: vi.fn(),
  flushSentry: vi.fn(async () => {}),
}));

vi.mock('resend', () => ({
  // NB: `new Resend(...)` runs at module top-level, so the mock must be
  // constructible — a `function` expression is (an arrow function is NOT).
  Resend: vi.fn(function ResendMock() {
    return { webhooks: { verify: mocks.verifyMock } };
  }),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/observability', () => ({
  reportInfo: mocks.reportInfo,
  reportWarning: mocks.reportWarning,
  reportError: mocks.reportError,
  flushSentry: mocks.flushSentry,
}));

import { GET, POST } from './route';

const VALID_HEADERS = {
  'svix-id': 'msg_2abc',
  'svix-timestamp': '1720000000',
  'svix-signature': 'v1,fakebase64signature',
};

/** Minimal NextRequest stand-in: the route only reads `.headers` and `.text()`. */
function makeReq(headers: Record<string, string>, body = '{}'): NextRequest {
  return {
    headers: new Headers(headers),
    text: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.RESEND_WEBHOOK_SECRET = 'whsec_test';
  mocks.env.RESEND_API_KEY = 're_test';
  mocks.db.user.findFirst.mockResolvedValue(null);
  mocks.db.emailEvent.create.mockResolvedValue({});
  mocks.db.emailSuppression.upsert.mockResolvedValue({});
  mocks.verifyMock.mockReturnValue({ type: 'email.delivered', data: { to: ['x@y.com'] } });
});

describe('POST /api/webhooks/resend — signature & guards', () => {
  it('returns 503 when RESEND_WEBHOOK_SECRET is not configured (route disarmed)', async () => {
    mocks.env.RESEND_WEBHOOK_SECRET = undefined;

    const res = await POST(makeReq(VALID_HEADERS));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'webhook_disabled' });
    expect(mocks.verifyMock).not.toHaveBeenCalled();
  });

  it('returns 400 when a svix signature header is missing', async () => {
    const res = await POST(makeReq({ 'svix-id': 'msg_1' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'missing_signature_headers' });
    expect(mocks.verifyMock).not.toHaveBeenCalled();
  });

  it('returns 400 (never 500) when signature verification throws', async () => {
    mocks.verifyMock.mockImplementation(() => {
      throw new Error('No matching signature found');
    });

    const res = await POST(makeReq(VALID_HEADERS, '{"tampered":true}'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_signature' });
    expect(mocks.db.emailEvent.create).not.toHaveBeenCalled();
  });

  it('verifies the RAW body bytes with the configured secret', async () => {
    const raw = '{"type":"email.delivered","data":{"to":["x@y.com"]}}';

    await POST(makeReq(VALID_HEADERS, raw));

    expect(mocks.verifyMock).toHaveBeenCalledWith({
      payload: raw,
      headers: {
        id: VALID_HEADERS['svix-id'],
        timestamp: VALID_HEADERS['svix-timestamp'],
        signature: VALID_HEADERS['svix-signature'],
      },
      webhookSecret: 'whsec_test',
    });
  });
});

describe('POST /api/webhooks/resend — idempotency & side-effects', () => {
  it('acknowledges a duplicate delivery (P2002) with 200 without replaying', async () => {
    mocks.verifyMock.mockReturnValue({
      type: 'email.bounced',
      data: { to: ['x@y.com'], bounce: { type: 'Permanent' } },
    });
    mocks.db.emailEvent.create.mockRejectedValue({ code: 'P2002' });

    const res = await POST(makeReq(VALID_HEADERS));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true, duplicate: true });
    // Duplicate → side-effects were already applied on first delivery.
    expect(mocks.db.emailSuppression.upsert).not.toHaveBeenCalled();
  });

  it('suppresses the address on a permanent (hard) bounce', async () => {
    mocks.verifyMock.mockReturnValue({
      type: 'email.bounced',
      data: {
        to: ['User@Bounce.COM'],
        email_id: 'eid_1',
        bounce: { type: 'Permanent', subType: 'General' },
      },
    });

    const res = await POST(makeReq(VALID_HEADERS));

    expect(res.status).toBe(200);
    expect(mocks.db.emailSuppression.upsert).toHaveBeenCalledTimes(1);
    const arg = mocks.db.emailSuppression.upsert.mock.calls[0]?.[0];
    // normalizeEmail lowercases + trims for the suppression key.
    expect(arg?.where).toEqual({ email: 'user@bounce.com' });
    expect(arg?.create).toMatchObject({ reason: 'hard_bounce' });
  });

  it('suppresses the address on a spam complaint', async () => {
    mocks.verifyMock.mockReturnValue({
      type: 'email.complained',
      data: { to: ['spam@y.com'] },
    });

    await POST(makeReq(VALID_HEADERS));

    expect(mocks.db.emailSuppression.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.db.emailSuppression.upsert.mock.calls[0]?.[0]?.create).toMatchObject({
      reason: 'complaint',
    });
  });

  it('does NOT suppress on a transient bounce', async () => {
    mocks.verifyMock.mockReturnValue({
      type: 'email.bounced',
      data: { to: ['x@y.com'], bounce: { type: 'Transient' } },
    });

    const res = await POST(makeReq(VALID_HEADERS));

    expect(res.status).toBe(200);
    expect(mocks.db.emailSuppression.upsert).not.toHaveBeenCalled();
  });

  it('acknowledges an event without a recipient without persisting', async () => {
    mocks.verifyMock.mockReturnValue({ type: 'email.delivered', data: {} });

    const res = await POST(makeReq(VALID_HEADERS));

    expect(res.status).toBe(200);
    expect(mocks.db.emailEvent.create).not.toHaveBeenCalled();
    expect(mocks.reportInfo).toHaveBeenCalled();
  });
});

describe('GET /api/webhooks/resend', () => {
  it('is method-not-allowed (405)', async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});
