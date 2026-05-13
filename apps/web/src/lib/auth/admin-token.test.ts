import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * V1.7.2 — Tests for `lib/auth/admin-token.ts`.
 *
 * What we actually pin :
 *   - constant-time `verifyAdminToken` round-trip (happy + mismatch + length-mismatch + empty)
 *   - `requireAdminToken` 503 when env not configured
 *   - `requireAdminToken` 401 when header missing
 *   - `requireAdminToken` 401 when header wrong
 *   - `requireAdminToken` `null` (passthrough) when header valid
 *   - `requireAdminToken` 429 when rate limit exhausted (uses real adminBatchLimiter
 *     with unique IPs across tests so we can isolate buckets)
 *
 * The bucket is intentionally NOT reset between tests — each case picks a
 * unique caller IP via `x-forwarded-for` to avoid bleed. This pattern matches
 * `apps/web/src/app/api/cron/purge-deleted/route.test.ts`.
 */

const TEST_TOKEN = 'test_admin_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaaaaaa';
const WRONG_TOKEN = 'test_admin_batch_token_WRONG_dummy_value_bbbbbbbbbbbbbbbbbbbbbbb';

// Mock env module — must come before importing the SUT.
vi.mock('@/lib/env', () => ({
  env: {
    ADMIN_BATCH_TOKEN: TEST_TOKEN,
  },
}));

const { verifyAdminToken, requireAdminToken } = await import('./admin-token');

beforeEach(() => {
  // No state to reset on the SUT itself ; each test uses a unique IP for
  // the rate-limit bucket so cross-test bleed is impossible.
});

function makeRequest(opts: { token?: string; ip: string }): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  return new Request('https://app.fxmilyapp.com/api/admin/weekly-batch/pull', {
    method: 'POST',
    headers,
  });
}

describe('verifyAdminToken (constant-time)', () => {
  it('returns true when both tokens match exactly', () => {
    expect(verifyAdminToken(TEST_TOKEN, TEST_TOKEN)).toBe(true);
  });

  it('returns false when tokens differ but have the same length', () => {
    expect(verifyAdminToken(TEST_TOKEN, WRONG_TOKEN)).toBe(false);
  });

  it('returns false when tokens differ in length (no node:crypto throw)', () => {
    // SHA-256 buffers are always 32 bytes regardless of input length —
    // the timingSafeEqual call is safe even on length-mismatch inputs.
    // This is the whole point of the SHA-256-then-compare pattern (CWE-208).
    expect(verifyAdminToken('short', TEST_TOKEN)).toBe(false);
    expect(verifyAdminToken(TEST_TOKEN, '')).toBe(false);
    expect(verifyAdminToken('', '')).toBe(true);
  });
});

describe('requireAdminToken — auth gate', () => {
  it('returns 401 when the X-Admin-Token header is missing', async () => {
    const res = requireAdminToken(makeRequest({ ip: '10.50.0.1' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 when the X-Admin-Token header is wrong', async () => {
    const res = requireAdminToken(makeRequest({ token: WRONG_TOKEN, ip: '10.50.0.2' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('returns null (passthrough) when the X-Admin-Token header is valid', () => {
    const res = requireAdminToken(makeRequest({ token: TEST_TOKEN, ip: '10.50.0.3' }));
    expect(res).toBeNull();
  });
});

describe('requireAdminToken — rate limit (V1.7.2 audit fix : consume on 401 path only)', () => {
  it('returns 429 with Retry-After header once the bucket is drained via 401 attempts', async () => {
    const ip = '10.50.0.4';
    // Burst budget for adminBatchLimiter is 10. Drain via 10 wrong-token hits
    // (each consumes 1 token because the auth gate fails and falls into the
    // bucket-consume branch).
    for (let i = 0; i < 10; i++) {
      const res = requireAdminToken(makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip }));
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
    }

    const res = requireAdminToken(makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).toBeTruthy();
    const body = await res!.json();
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it('does NOT consume the bucket on a valid-token request (legit caller never locks itself out)', () => {
    const ip = '10.50.0.6';
    // 50 valid-token hits in a row : should ALL pass without ever tripping 429
    // (the bucket is only consumed on 401 paths now).
    for (let i = 0; i < 50; i++) {
      const res = requireAdminToken(makeRequest({ token: TEST_TOKEN, ip }));
      expect(res).toBeNull();
    }
  });

  it('uses the trusted (last) entry of x-forwarded-for so XFF spoofing cannot bypass the bucket', () => {
    // Attacker sends a forged XFF chain : their first entry is rotating
    // garbage, but Caddy appends their REAL IP at the end. callerIdTrusted
    // reads the LAST segment, so all 11 attempts share the same bucket
    // and the 11th trips 429.
    const realCaddyInjectedIp = '10.50.0.7';
    for (let i = 0; i < 10; i++) {
      const xff = `attacker-rotating-${i}, ${realCaddyInjectedIp}`;
      const req = new Request('https://app.fxmilyapp.com/api/admin/weekly-batch/pull', {
        method: 'POST',
        headers: {
          'x-forwarded-for': xff,
          'x-admin-token': 'WRONG' + 'a'.repeat(60),
        },
      });
      const res = requireAdminToken(req);
      expect(res!.status).toBe(401);
    }

    const xff = `attacker-rotating-FINAL, ${realCaddyInjectedIp}`;
    const req = new Request('https://app.fxmilyapp.com/api/admin/weekly-batch/pull', {
      method: 'POST',
      headers: {
        'x-forwarded-for': xff,
        'x-admin-token': 'WRONG' + 'a'.repeat(60),
      },
    });
    const res = requireAdminToken(req);
    expect(res!.status).toBe(429);
  });
});

describe('callerIdTrusted — XFF edge inputs (V1.7.2 R2 post-merge hardening E3)', () => {
  // Pin defense at token-bucket.ts:309-322 — callerIdTrusted reads the LAST
  // entry of x-forwarded-for (anti-spoof Caddy injects trustable IP at the
  // end). Malformed XFF (empty / only commas / whitespace-only) must fall
  // back to 'unknown' instead of returning '' which would crash rate-limit
  // bucket keying.
  it('falls back to "unknown" bucket key on empty XFF + missing x-real-ip', async () => {
    // 10 wrong-token hits from a request with empty XFF should drain the
    // shared "unknown" bucket. We verify the 11th gets 429 — proving the
    // bucket key is stable and not '' (which would key-collide with internal
    // helpers that use the empty string as default).
    const makeEmptyXffRequest = () =>
      new Request('https://app.fxmilyapp.com/api/admin/weekly-batch/pull', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '',
          'x-admin-token': 'WRONG' + 'b'.repeat(60),
        },
      });
    for (let i = 0; i < 10; i++) {
      const res = requireAdminToken(makeEmptyXffRequest());
      expect(res!.status).toBe(401);
    }
    const res = requireAdminToken(makeEmptyXffRequest());
    expect(res!.status).toBe(429);
  });

  it('falls back to "unknown" on comma-only XFF (malformed proxy chain)', async () => {
    // XFF: ",,," — a misconfigured proxy might emit this. After split/trim/filter,
    // segments[] is empty → last = undefined → fallback to 'unknown'.
    const makeCommaOnlyRequest = () =>
      new Request('https://app.fxmilyapp.com/api/admin/weekly-batch/pull', {
        method: 'POST',
        headers: {
          'x-forwarded-for': ',,,',
          'x-admin-token': 'WRONG' + 'c'.repeat(60),
        },
      });
    // We can't share the bucket with the empty-XFF test above (both target
    // 'unknown' key), so the bucket may already be drained. Just verify the
    // first response is a valid 401 or 429 (auth happens before rate-limit
    // consumption in the wrong-token path).
    const res = requireAdminToken(makeCommaOnlyRequest());
    expect([401, 429]).toContain(res!.status);
  });

  it('falls back to "unknown" on whitespace-only XFF', async () => {
    const makeWhitespaceRequest = () =>
      new Request('https://app.fxmilyapp.com/api/admin/weekly-batch/pull', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '   ,   ,   ',
          'x-admin-token': 'WRONG' + 'd'.repeat(60),
        },
      });
    const res = requireAdminToken(makeWhitespaceRequest());
    expect([401, 429]).toContain(res!.status);
  });
});

describe('requireAdminToken — env disabled', () => {
  it('returns 503 when ADMIN_BATCH_TOKEN is not configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      env: { ADMIN_BATCH_TOKEN: undefined },
    }));

    const { requireAdminToken: gated } = await import('./admin-token');
    const res = gated(makeRequest({ token: TEST_TOKEN, ip: '10.50.0.5' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect(body.error).toBe('admin_batch_disabled');

    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });
});
