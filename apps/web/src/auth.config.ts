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

      // Phase P review T1.1 — defense-in-depth global gate. A user whose
      // status flipped to `suspended` or `deleted` keeps a valid JWT for
      // up to 30 days (session.maxAge). Without this gate, only the admin
      // pages explicitly checking `status === 'active'` would block them
      // — every other Server Component would happily render. Returning
      // false here forces an immediate redirect to /login on the next
      // request, regardless of route.
      if (isLoggedIn && auth.user.status !== 'active') return false;

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
     *
     * Audit J5 fix (security HIGH H3): the previous `trigger === 'update'`
     * branch accepted client-supplied `session.role` / `session.status` and
     * wrote them straight into the token — privilege escalation hole. A
     * non-admin authenticated member could call `useSession().update({ role:
     * 'admin' })` and earn full admin access until token expiry. The branch
     * is REMOVED on purpose: there is no current call site for `update()`
     * in the app, and any future need to refresh role/status will flow
     * through `signIn()` again (re-issues a JWT from DB) or via a Node-side
     * `jwt` override in `auth.ts` that re-fetches from Prisma.
     */
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.status = user.status;
        token.timezone = user.timezone;
        if (user.id) token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.role) session.user.role = token.role;
      if (token.status) session.user.status = token.status;
      // Always emit a string for the consumer — defaults to Europe/Paris
      // (matches the DB default in `User.timezone`). J5.5 plumbing.
      session.user.timezone = token.timezone ?? 'Europe/Paris';
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;

export default authConfig;
