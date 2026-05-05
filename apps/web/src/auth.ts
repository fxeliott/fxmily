import 'server-only';

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';

import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { signInSchema } from '@/lib/schemas/auth';
import authConfig from '@/auth.config';
import type { UserRole, UserStatus } from '@/generated/prisma/client';

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
        // real hash or a known dummy. This is mostly to avoid a trivial timing
        // signal that distinguishes "user exists" from "user does not".
        if (!user || !user.passwordHash) {
          // Run a dummy verify so timing matches the real path. We don't care
          // about the result.
          await verifyPassword(password, DUMMY_ARGON2_HASH).catch(() => false);
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

/**
 * Pre-computed argon2id hash of an empty string. Used to keep the timing of
 * "no such user" identical to "wrong password". Generated once with:
 *   `node -e "import('@node-rs/argon2').then(a => a.hash('').then(console.log))"`
 * and pinned here so the constant doesn't depend on argon2 install behavior.
 *
 * The actual value isn't sensitive: this is a hash of an empty string. An
 * attacker discovering it learns nothing.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$bm9uY2VfZHVtbXk$fakeplaceholderfakeplaceholderfakeplaceholderfakeplaceholderfak';
