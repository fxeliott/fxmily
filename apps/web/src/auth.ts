import 'server-only';

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { authorizeCredentials } from '@/lib/auth/authorize-credentials';
import { refreshAndCheckToken } from '@/lib/auth/session-revocation';
import authConfig from '@/auth.config';

/**
 * Auth.js v5 root configuration.
 *
 * Composition note (Auth.js v5 idiomatic split):
 *   - `auth.config.ts` — edge-compat slice (callbacks, pages, session strategy).
 *   - `auth.ts` (this file) — adapter, providers, anything that pulls in Node-
 *     only modules (Prisma, argon2).
 *   - `lib/auth/authorize-credentials.ts` — V1.12 P4 extract of the
 *     Credentials `authorize()` callback. Moved out-of-line so unit tests
 *     can `vi.mock()` its dependencies without spinning up the full
 *     NextAuth module-top instantiation (security-auditor V1.12 P3 I1).
 *
 * `proxy.ts` (renamed from `middleware.ts` in Next.js 16) imports `authConfig`
 * directly, never this file, to keep the proxy startup lean.
 */

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  // J4 (security T2-1) — Node-side `jwt` override. The edge slice in
  // `auth.config.ts` (used by `proxy.ts`) cannot touch the DB, so the
  // session-revocation re-check lives here, where `auth()` runs in the
  // Node runtime (Server Components / route handlers / Server Actions).
  // We re-compose the edge callbacks so `authorized` + `session` are
  // preserved, then wrap `jwt`:
  //   1. run the edge base (sign-in claim writes, incl. tokenVersion);
  //   2. on subsequent calls, re-read the DB counter + status/role and
  //      tear the session down (return null) when the token is stale.
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const base = await authConfig.callbacks.jwt(params);
      // Sign-in just minted the token from the DB — nothing to re-check.
      // A null base (defensive) short-circuits unchanged.
      if (params.user || base === null) return base;
      return refreshAndCheckToken(base);
    },
  },
  // Cast: @auth/prisma-adapter's exported types are slightly stale relative to
  // Auth.js v5 — the runtime contract is correct.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(db as any),
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      authorize: authorizeCredentials,
    }),
  ],
  events: {
    // Auth.js v5 fires `signIn` after authorize() returns a user object —
    // success path only. Failure paths are logged inline above so we don't
    // miss them.
    async signIn({ user }) {
      if (!user?.id) return;
      await logAudit({
        action: 'auth.login.success',
        userId: user.id,
      });
    },
    async signOut(message) {
      // Auth.js v5 signOut event payload is a discriminated union: with the
      // JWT strategy we get `{ token }`, with the database strategy `{ session }`.
      const userId =
        'token' in message ? (message.token?.sub ?? null) : (message.session?.userId ?? null);
      await logAudit({
        action: 'auth.logout',
        userId,
      });
    },
  },
});
