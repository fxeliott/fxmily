import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-compatible Auth.js config (no Prisma, no argon2 imports).
 *
 * This is the slice of the config that runs inside `proxy.ts` (renamed from
 * `middleware.ts` in Next.js 16). It MUST stay free of Node-only modules so
 * that the proxy keeps starting up fast — heavy work (DB lookups, password
 * verification) lives in `auth.ts`.
 *
 * Reference: https://authjs.dev/getting-started/migrating-to-v5
 */

const PUBLIC_PREFIXES = ['/api/auth', '/legal', '/_next', '/favicon'];
const PUBLIC_EXACT = new Set(['/', '/login', '/forgot-password']);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/onboarding/')) return true;
  if (pathname.startsWith('/reset-password')) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    // Filled in `auth.ts` — split is required because Credentials uses argon2
    // and the Prisma adapter, neither of which is edge-safe.
  ],
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },
  callbacks: {
    /**
     * Used by the `auth()` middleware-style wrapper exported as `proxy` from
     * `proxy.ts`. Returning `true` lets the request through, `false` redirects
     * to `pages.signIn`, and a `Response` short-circuits with that response.
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      if (isPublic(pathname)) return true;

      if (pathname.startsWith('/admin')) {
        if (!isLoggedIn) return false;
        return auth.user.role === 'admin';
      }

      // Any other route requires a session.
      return isLoggedIn;
    },
    /**
     * Persist role + status in the JWT so the `proxy` and Server Components
     * can authorize without an extra DB round trip.
     */
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = user.role;
        token.status = user.status;
        if (user.id) token.sub = user.id;
      }
      // Allow `update()` from the client to refresh role/status without
      // re-logging in (e.g. after admin changes a member's status).
      if (trigger === 'update' && session && typeof session === 'object') {
        const next = session as Record<string, unknown>;
        if (typeof next.role === 'string') {
          token.role = next.role as NonNullable<typeof token.role>;
        }
        if (typeof next.status === 'string') {
          token.status = next.status as NonNullable<typeof token.status>;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.role) session.user.role = token.role;
      if (token.status) session.user.status = token.status;
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;

export default authConfig;
