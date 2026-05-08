/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts` and changed the export name
 * from `middleware` → `proxy`. We use Auth.js v5's `auth()` helper as a thin
 * wrapper around the edge-compat `authConfig` so route protection runs without
 * pulling Prisma / argon2 into the proxy bundle.
 *
 * The `authorized` callback in `auth.config.ts` makes the actual decisions.
 */

import NextAuth from 'next-auth';

import authConfig from '@/auth.config';

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Match every path EXCEPT:
  //   - `/api/*`              → owned by their route handlers (each one calls
  //                              `auth()` itself). The proxy emits a 307
  //                              redirect to `/login`, which is wrong for
  //                              JSON APIs — clients expect a 401 JSON body.
  //   - `/monitoring/*`       → Sentry tunnelRoute (J10 Phase I — defense
  //                              against `/monitoring` being treated as
  //                              authenticated and 307-redirected to /login,
  //                              which would silently drop browser-side
  //                              error reports). The tunnel itself is rate-
  //                              limited inside the route's withSentryConfig
  //                              wrapper — no auth needed (Sentry's DSN
  //                              already gates ingestion).
  //   - `/_next/static/*`, `/_next/image/*` → Next runtime
  //   - common static files (favicon, logo, *.svg)
  //
  // Defense in depth: every `/api/*` handler MUST verify `await auth()`
  // before doing anything privileged. See `app/api/uploads/*` for the pattern.
  matcher: ['/((?!api|monitoring|_next/static|_next/image|favicon.ico|logo.png|.*\\.svg).*)'],
};
