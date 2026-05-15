import 'server-only';

import { headers } from 'next/headers';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { reportWarning } from '@/lib/observability';
import { callerIdTrusted, loginEmailLimiter, loginIpLimiter } from '@/lib/rate-limit/token-bucket';
import { signInSchema } from '@/lib/schemas/auth';
import type { UserRole, UserStatus } from '@/generated/prisma/client';

/**
 * Shape returned to the Auth.js v5 Credentials provider on successful login.
 * Kept inline (not imported from next-auth) to keep this module's deps lean
 * — Auth.js types are stable on these fields across v5 betas, and this
 * surface matches the JWT/Session callbacks in `auth.config.ts`.
 */
export interface AuthorizeCredentialsResult {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  timezone: string;
}

/**
 * Sentinel input fed to `hashPassword()` to generate the dummy argon2id
 * hash used by the constant-time timing defense (see `getDummyHash()` below).
 *
 * Exported so the unit tests can import the SAME constant and assert that
 * `hashPassword` was invoked with it — single source of truth, no magic
 * string drift between SUT and test fixture (V1.12 P4 I1 audit L1).
 */
export const DUMMY_PASSWORD_SENTINEL = 'dummy-password-for-timing-defense';

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
  dummyHashPromise ??= hashPassword(DUMMY_PASSWORD_SENTINEL);
  return dummyHashPromise;
}

/**
 * @internal
 * @deprecated **TEST-ONLY** — do NOT call from production code paths. This
 * function clears the module-level memoized dummy-hash Promise so the
 * `hashPassword` mock is exercised on each Vitest run. Calling this from
 * a production code path would force a ~150ms argon2 recompute on the
 * next login attempt (timing-defense degraded), and over a sustained
 * burst could surface as an availability issue.
 *
 * The `@deprecated` annotation triggers an IDE strikethrough + warning
 * for any new caller, making accidental production usage visually obvious
 * in code review (V1.12 P4 I1 audit M1 mitigation). The function is kept
 * exported (vs symbol-keyed `__TESTS = {...}`) for ergonomics — Vitest
 * `vi.mock()` interacts with named exports more cleanly.
 */
export function __resetDummyHashCacheForTests(): void {
  dummyHashPromise = null;
}

/**
 * Auth.js v5 Credentials `authorize()` callback — extracted from `auth.ts`
 * inline at V1.12 P4 (2026-05-15) to unblock unit testing via `vi.mock()`
 * (cf. security-auditor V1.12 P3 finding I1 — `authorize()` was structurally
 * untested, only signInAction had `actions.test.ts` coverage of the same
 * rate-limit pattern).
 *
 * Public surface :
 * - Returns `AuthorizeCredentialsResult` on success → Auth.js v5 issues JWT.
 * - Returns `null` on any failure → Auth.js v5 surfaces "Invalid credentials"
 *   to the client without leaking which guard caught it.
 *
 * Security ordering (do NOT reorder without re-running sub-agent
 * security-auditor) :
 * 1. Zod parse credentials (fail-closed on malformed input — no DB / no
 *    rate-limit consume on garbage payload).
 * 2. Extract `ip` once at top via `headers()` + `callerIdTrusted`
 *    (V1.12 P4 L3 — propagated to BOTH audit rows for forensic correlation).
 * 3. Per-email bucket (`loginEmailLimiter`) — short-circuits before DB lookup.
 * 4. Per-IP bucket (`loginIpLimiter`) — V1.12 P3 promotion from Server
 *    Action to authorize() level closes the credential-stuffing direct-
 *    POST bypass.
 * 5. DB user lookup → constant-time path always runs argon2 verify
 *    (against dummy or real hash) to keep timing identical.
 * 6. Status + password validation.
 * 7. `lastSeenAt` bump (best-effort, never blocks login).
 *
 * Audit pattern : `auth.login.rate_limited` rows carry `kind: 'email'|'ip'`
 * + `source: 'authorize'` in metadata (distinguishes from `signInAction`
 * path which omits `source`) + top-level `ipHash` column via `logAudit({ip})`
 * for SHA-256(AUTH_SECRET + ip) forensic pivot.
 */
export async function authorizeCredentials(
  credentials: unknown,
): Promise<AuthorizeCredentialsResult | null> {
  const parsed = signInSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const { email, password } = parsed.data;

  // V1.12 P3 (2026-05-15) — IP gate promoted to authorize() level via
  // `headers()` from `next/headers`. Closes the credential-stuffing
  // direct-POST bypass on /api/auth/callback/credentials.
  //
  // V1.12 P4 (2026-05-15) — L3 enhancement : extract `ip` once at the
  // top and propagate to BOTH audit rows for forensic correlation.
  //
  // Defensive try-catch on `headers()` — fail-open keeps the email
  // bucket as the only gate. The signInAction Server Action path still
  // hard-enforces the IP limit for the legit user flow. Sentry warning
  // surfaces the regression (security-auditor V1.12 P3 L1).
  let ip: string | null = null;
  try {
    const reqHeaders = await headers();
    ip = callerIdTrusted({ headers: reqHeaders });
  } catch (err) {
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
    //
    // V1.12 P4 I1 (2026-05-15) — propagate `ip` to the failure rows too
    // (audit M2). Without it, forensic queries could pivot on `ipHash`
    // for rate-limited attempts but NOT for actual brute-force attempts
    // that stay under the bucket cap — asymmetric forensic blind spot.
    await logAudit({
      action: 'auth.login.failure',
      userId: null,
      ip,
      metadata: { reason: 'unknown_or_no_password' },
    });
    return null;
  }

  if (user.status !== 'active') {
    await logAudit({
      action: 'auth.login.failure',
      userId: user.id,
      ip,
      metadata: { reason: 'inactive', status: user.status },
    });
    return null;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await logAudit({
      action: 'auth.login.failure',
      userId: user.id,
      ip,
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
}
