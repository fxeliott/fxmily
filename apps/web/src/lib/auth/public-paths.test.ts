import type { Session } from 'next-auth';
import { describe, expect, it } from 'vitest';

import authConfig from '@/auth.config';

import { isPublic } from './public-paths';

/**
 * Audit 2026-07-08 — parity tests for the PUBLIC route boundary.
 *
 * History: `auth.config.ts` (the REAL gate) and `app-shell.tsx` (the chrome
 * mirror) each kept a private copy of this predicate and drifted (`/offline`
 * public for auth but chromed in the shell; `/onboarding` vs `/onboarding/`).
 * Both now import the single `isPublic` from `public-paths.ts` — these tests
 * pin the remaining risk: that `isPublic` and the real `authorized()` callback
 * ever disagree again (e.g. someone re-inlines a check inside the callback).
 *
 * What we actually pin:
 *   - `isPublic` classification over an exhaustive path matrix (exact, prefix,
 *     near-miss traps like `/loginx` and bare `/onboarding`).
 *   - PARITY: for an ANONYMOUS request, `authorized()` returns exactly
 *     `isPublic(path)` for every path in the matrix — the mirror IS the gate.
 *   - suspended/deleted members are rejected on private routes (T1.1 gate)
 *     but still allowed on public ones.
 *   - `/admin` requires the admin role, not just a session.
 */

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/forgot-password',
  '/rejoindre',
  '/offline',
  '/opengraph-image',
  '/onboarding/welcome',
  '/onboarding/interview',
  '/reset-password',
  '/reset-password/some-token',
  '/api/auth/session',
  '/legal',
  '/legal/mentions-legales',
  '/favicon.ico',
] as const;

const PRIVATE_PATHS = [
  '/dashboard',
  '/journal',
  '/checkin',
  '/verification',
  '/pre-trade/new',
  '/account',
  '/admin',
  '/admin/members',
  '/api/uploads',
  // Near-miss traps — MUST stay private:
  '/onboarding', // bare segment (no page) — only `/onboarding/…` is public
  '/loginx', // exact-match trap (startsWith would wrongly pass)
  '/offline-drafts', // exact-match trap on `/offline`
] as const;

/** Calls the REAL edge gate exactly like the proxy does. */
function authorize(path: string, auth: Session | null): boolean | Response {
  const callback = authConfig.callbacks.authorized;
  // The callback only reads `auth?.user` and `request.nextUrl.pathname` — a
  // plain URL provides the same shape as NextRequest.nextUrl for this purpose.
  return callback({
    auth,
    request: { nextUrl: new URL(`https://app.fxmilyapp.com${path}`) },
  } as unknown as Parameters<typeof callback>[0]) as boolean | Response;
}

function sessionOf(role: 'member' | 'admin', status: string): Session {
  return {
    user: { id: 'u1', role, status, timezone: 'Europe/Paris' },
    expires: '2999-01-01T00:00:00.000Z',
  } as unknown as Session;
}

describe('isPublic (single source of truth)', () => {
  it.each(PUBLIC_PATHS)('classifies %s as PUBLIC', (path) => {
    expect(isPublic(path)).toBe(true);
  });

  it.each(PRIVATE_PATHS)('classifies %s as PRIVATE', (path) => {
    expect(isPublic(path)).toBe(false);
  });
});

describe('authorized() parity with isPublic (anonymous)', () => {
  it.each([...PUBLIC_PATHS, ...PRIVATE_PATHS])(
    'anonymous on %s -> authorized === isPublic',
    (path) => {
      expect(authorize(path, null)).toBe(isPublic(path));
    },
  );
});

describe('authorized() beyond the public boundary', () => {
  it('lets an active member into a private route', () => {
    expect(authorize('/dashboard', sessionOf('member', 'active'))).toBe(true);
  });

  it.each(['suspended', 'deleted'])('rejects a %s member on a private route (T1.1)', (status) => {
    expect(authorize('/dashboard', sessionOf('member', status))).toBe(false);
  });

  it('still serves public routes to a suspended member (no dead-end)', () => {
    expect(authorize('/login', sessionOf('member', 'suspended'))).toBe(true);
  });

  it('blocks a non-admin member on /admin', () => {
    expect(authorize('/admin', sessionOf('member', 'active'))).toBe(false);
  });

  it('lets an active admin into /admin', () => {
    expect(authorize('/admin/members', sessionOf('admin', 'active'))).toBe(true);
  });
});
