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
  //   - `/api/auth/*`         → Auth.js handlers (own auth)
  //   - `/_next/static/*`, `/_next/image/*` → Next runtime
  //   - common static files (favicon, logo, *.svg)
  //
  // Crucially, `/api/admin/*`, `/api/journal/*` etc. ARE matched by the
  // proxy so the `authorized()` callback gates them. Each future API route
  // handler must still call `await auth()` itself (defense in depth) since
  // the proxy can be bypassed in some Next.js edge cases.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|logo.png|.*\\.svg).*)'],
};
