import 'server-only';

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';

import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { signInSchema } from '@/lib/schemas/auth';
import authConfig from '@/auth.config';
import type { UserRole, UserStatus } from '@/generated/prisma/client';

/**
 * Lazily-computed dummy argon2id hash used to keep the timing of a missing
 * user identical to a wrong password. Computing at module-eval time would
 * delay the cold start by ~150 ms; a memoized Promise is amortized to zero
 * after the first login attempt.
 *
 * IMPORTANT: a previously-pinned static placeholder string was NOT a valid
 * PHC argon2 encoding, so `verify()` would early-return in microseconds and
 * defeat the very mitigation. Always go through the real hash function.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-defense');
  return dummyHashPromise;
}

/**
 * Auth.js v5 root configuration.
 *
 * Composition note (Auth.js v5 idiomatic split):
 *   - `auth.config.ts` — edge-compat slice (callbacks, pages, session strategy).
 *   - `auth.ts` (this file) — adapter, providers, anything that pulls in Node-
 *     only modules (Prisma, argon2).
 *
 * `proxy.ts` (renamed from `middleware.ts` in Next.js 16) imports `authConfig`
 * directly, never this file, to keep the proxy startup lean.
 */

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
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
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            image: true,
            passwordHash: true,
            role: true,
            status: true,
          },
        });

        // Constant-ish behavior: always run argon2 verify against either the
        // real hash or a runtime-computed dummy. The dummy uses real argon2
        // parameters so timing matches a successful verify path.
        if (!user || !user.passwordHash) {
          const dummyHash = await getDummyHash();
          await verifyPassword(password, dummyHash).catch(() => false);
          return null;
        }

        if (user.status !== 'active') {
          return null;
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        // Touch lastSeenAt; failures here should not block the login.
        await db.user
          .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
          .catch(() => undefined);

        return {
          id: user.id,
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
          image: user.image,
          role: user.role as UserRole,
          status: user.status as UserStatus,
        };
      },
    }),
  ],
});
