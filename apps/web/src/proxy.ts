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
  // Match every path EXCEPT static assets, the Next internal endpoints, and
  // common static files. Auth.js v5 docs ship this exact regex.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo.png|.*\\.svg).*)'],
};
