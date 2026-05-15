import 'server-only';

import { headers } from 'next/headers';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { reportWarning } from '@/lib/observability';
import { callerIdTrusted, loginEmailLimiter, loginIpLimiter } from '@/lib/rate-limit/token-bucket';
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

        // Phase T security promotion (2026-05-09) — credential-stuffing
        // defense at the AUTH PROVIDER level (covers
        // /api/auth/callback/credentials direct hits, not just the
        // signInAction Server Action). Per-email bucket.
        //
        // V1.12 P3 (2026-05-15) — IP gate promoted to authorize() level via
        // `headers()` from `next/headers`. Previously the IP bucket lived
        // only in `app/login/actions.ts`, leaving the direct
        // `/api/auth/callback/credentials` POST path covered only by the
        // per-email bucket. An attacker rotating across many emails from
        // a single IP could drain the email buckets one-at-a-time without
        // ever tripping an IP-wide limit. With Caddy's `header_up
        // X-Forwarded-For {remote_host}` (V1.12 P1) the last-XFF entry
        // is non-spoofable, so `callerIdTrusted` gives a real client IP.
        //
        // V1.12 P4 (2026-05-15) — L3 enhancement : extract `ip` once at the
        // top of authorize() and propagate to BOTH audit rows (email +
        // IP bucket). The `ipHash` top-level column on `audit_logs` lets
        // forensic queries pivot by SHA-256(AUTH_SECRET + ip) — correlate
        // rotated-email attacks from the same IP without exposing raw IP
        // (RGPD §16 data minimisation). Previously V1.12 P3 only fetched
        // `ip` inside the IP-rate-limit branch, so email-bucket trips had
        // no ipHash → no cross-event correlation.
        //
        // Defensive try-catch on `headers()` — Auth.js v5 calls authorize()
        // from inside its Route Handler chain so the request context IS
        // available in Next 16, but a future evolution (e.g. edge-runtime
        // promotion) might break that. Fail-open : keep the email bucket
        // as the only gate. The Server Action path
        // (`signInAction → loginIpLimiter.consume`) still hard-enforces
        // the IP limit for the legit user flow.
        let ip: string | null = null;
        try {
          const reqHeaders = await headers();
          ip = callerIdTrusted({ headers: reqHeaders });
        } catch (err) {
          // headers() unavailable in this context (Auth.js v5 future
          // regression or non-Route-Handler invocation). Fail-open : the
          // signInAction Server Action still enforces the IP limit for
          // the legit user flow, and per-email bucket above still catches
          // dictionary attacks on a known account.
          //
          // Sentry warning surfaces the regression so we don't silently
          // lose this defense. `reportWarning` (not `reportError`) keeps
          // the on-call dashboard clean — this is a degraded-mode signal,
          // not an outage. Cf. security-auditor V1.12 P3 finding L1.
          reportWarning('auth.authorize', 'headers_unavailable_ip_limit_skipped', {
            errorName: err instanceof Error ? err.name : 'unknown',
          });
        }

        const emailDecision = loginEmailLimiter.consume(email.toLowerCase());
        if (!emailDecision.allowed) {
          await logAudit({
            action: 'auth.login.rate_limited',
            userId: null,
            ip,
            metadata: {
              kind: 'email',
              retryAfterMs: emailDecision.retryAfterMs,
              source: 'authorize',
            },
          }).catch(() => undefined);
          return null;
        }

        let ipDecision: { allowed: boolean; retryAfterMs: number } = {
          allowed: true,
          retryAfterMs: 0,
        };
        if (ip !== null) {
          ipDecision = loginIpLimiter.consume(ip);
        }
        if (!ipDecision.allowed) {
          await logAudit({
            action: 'auth.login.rate_limited',
            userId: null,
            ip,
            metadata: {
              kind: 'ip',
              retryAfterMs: ipDecision.retryAfterMs,
              source: 'authorize',
            },
          }).catch(() => undefined);
          return null;
        }

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
            timezone: true,
          },
        });

        // Constant-ish behavior: always run argon2 verify against either the
        // real hash or a runtime-computed dummy. The dummy uses real argon2
        // parameters so timing matches a successful verify path.
        if (!user || !user.passwordHash) {
          const dummyHash = await getDummyHash();
          await verifyPassword(password, dummyHash).catch(() => false);
          // Audit failure without leaking which guard caught the attempt.
          // userId stays null because we deliberately don't tie a failed
          // login to a known account (would create an enumeration oracle).
          await logAudit({
            action: 'auth.login.failure',
            userId: null,
            metadata: { reason: 'unknown_or_no_password' },
          });
          return null;
        }

        if (user.status !== 'active') {
          await logAudit({
            action: 'auth.login.failure',
            userId: user.id,
            metadata: { reason: 'inactive', status: user.status },
          });
          return null;
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          await logAudit({
            action: 'auth.login.failure',
            userId: user.id,
            metadata: { reason: 'bad_password' },
          });
          return null;
        }

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
          timezone: user.timezone,
        };
      },
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
