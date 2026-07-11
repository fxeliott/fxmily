import { NextRequest } from 'next/server';
import type { NextFetchEvent } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P2 quick-win (2026-07-11) — `/monitoring` (Sentry tunnelRoute) rate-limit
 * branch of the proxy wrapper.
 *
 * The limiter (`sentryTunnelLimiter`, bucketSize 50 / refill 1 token per
 * second) is a MODULE-LEVEL singleton shared by every test in this file, so:
 *
 * - each test uses its own unique client IP (last XFF hop) to get a fresh
 *   bucket;
 * - `vi.useFakeTimers()` freezes `Date.now()` so the bucket never refills
 *   mid-test (deterministic exhaustion: 50 allowed, 51st → 429).
 *
 * Auth.js is mocked: the wrapper must NEVER call the auth middleware for
 * `/monitoring[/*]` (a 307→/login would silently drop browser error reports),
 * and must delegate every other matched path to it untouched.
 */

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  default: () => ({ auth: authMock }),
}));

import proxy, { config } from './proxy';

const event = {} as NextFetchEvent;

function monitoringRequest(xff: string, path = '/monitoring') {
  return new NextRequest(`https://app.fxmilyapp.com${path}`, {
    headers: { 'x-forwarded-for': xff },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
  authMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('proxy — /monitoring rate-limit branch', () => {
  it('lets an allowed envelope fall through to the Sentry rewrite without touching auth', () => {
    const res = proxy(monitoringRequest('203.0.113.10'), event);

    // NextResponse.next() marks the response so the pipeline continues —
    // the Sentry plugin rewrite (which runs after middleware) still applies.
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get('x-middleware-next')).toBe('1');
    expect(authMock).not.toHaveBeenCalled();
  });

  it('short-circuits /monitoring subpaths through the same branch', () => {
    const res = proxy(monitoringRequest('203.0.113.11', '/monitoring/envelope/abc'), event);

    expect((res as Response).headers.get('x-middleware-next')).toBe('1');
    expect(authMock).not.toHaveBeenCalled();
  });

  it('answers 429 + Retry-After once the per-IP bucket is drained (51st request)', () => {
    const ip = '203.0.113.12';

    for (let i = 0; i < 50; i += 1) {
      const res = proxy(monitoringRequest(ip), event);
      expect((res as Response).status).not.toBe(429);
    }

    const rejected = proxy(monitoringRequest(ip), event) as Response;

    expect(rejected.status).toBe(429);
    // Frozen clock + refillRate 1 token/sec → exactly 1s until the next token.
    expect(rejected.headers.get('Retry-After')).toBe('1');
    expect(rejected.body).toBeNull();
    expect(authMock).not.toHaveBeenCalled();
  });

  it('keys the bucket on the TRUSTED last XFF hop (spoofed first entries share the bucket)', () => {
    const trustedIp = '203.0.113.13';

    // Drain the bucket while rotating the attacker-controlled FIRST entry.
    for (let i = 0; i < 50; i += 1) {
      proxy(monitoringRequest(`10.0.0.${i % 250}, ${trustedIp}`), event);
    }

    // A fresh spoofed first entry does NOT escape the drained bucket…
    const spoofed = proxy(monitoringRequest(`6.6.6.6, ${trustedIp}`), event) as Response;
    expect(spoofed.status).toBe(429);

    // …while a genuinely different client (different LAST hop) is untouched.
    const otherClient = proxy(monitoringRequest(`${trustedIp}, 203.0.113.14`), event) as Response;
    expect(otherClient.status).not.toBe(429);
    expect(otherClient.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('proxy — auth delegation for every other matched path', () => {
  it('delegates non-monitoring paths to the Auth.js middleware untouched', () => {
    const sentinel = new Response(null, { status: 307 });
    authMock.mockReturnValue(sentinel);

    const req = new NextRequest('https://app.fxmilyapp.com/dashboard', {
      headers: { 'x-forwarded-for': '203.0.113.15' },
    });
    const res = proxy(req, event);

    expect(res).toBe(sentinel);
    expect(authMock).toHaveBeenCalledTimes(1);
    expect(authMock).toHaveBeenCalledWith(req, event);
  });
});

describe('proxy — matcher config', () => {
  it('excludes /monitoring from the auth matcher and routes it via the dedicated entry', () => {
    expect(config.matcher).toHaveLength(2);
    // The auth matcher's negative lookahead must list `monitoring` so the
    // tunnel never hits the auth branch through the catch-all…
    expect(config.matcher[0]).toContain('monitoring');
    expect(config.matcher[0]).toMatch(/^\/\(\(\?!/);
    // …and the second entry routes the tunnel into the rate-limit branch
    // (`:path*` matches zero segments, so bare `/monitoring` is covered).
    expect(config.matcher[1]).toBe('/monitoring/:path*');
  });
});
