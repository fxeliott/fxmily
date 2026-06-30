import 'server-only';

import type { JWT } from 'next-auth/jwt';

import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';
import type { UserRole, UserStatus } from '@/generated/prisma/client';

/**
 * J4 (security T2-1) — JWT session revocation.
 *
 * With a stateless JWT strategy (SPEC §7.1 deviation, documented in
 * apps/web/CLAUDE.md), a token issued at login carries `role`/`status`
 * claims that are frozen for the whole 30-day `maxAge`. A user who is
 * suspended, hard-deleted, or whose password is reset keeps a VALID JWT
 * until natural expiry — the edge `authorized()` gate only ever reads the
 * stale claim. This module closes that window: a per-user `tokenVersion`
 * counter is re-read from the DB on every Node-side `auth()` call and any
 * token minted before the counter was bumped is torn down.
 *
 * The logic is split into a pure decision function (`applyRevocationCheck`,
 * unit-testable in isolation) and a thin DB orchestrator
 * (`refreshAndCheckToken`), mirroring how `authorizeCredentials` was
 * extracted from the NextAuth config at V1.12 P4 (security-auditor I1).
 */

/**
 * The slice of the DB user row the revocation check needs. Re-fetched on
 * every Node-side `auth()` call via `refreshAndCheckToken`.
 */
export interface RevocationUserSnapshot {
  tokenVersion: number;
  status: UserStatus;
  role: UserRole;
  // F2 — re-read so a self-service timezone change (`/account/timezone`)
  // reaches the live session within one request, without a re-login and
  // without reopening a client-controlled `session.update()` path.
  timezone: string;
}

/**
 * Pure decision function (no I/O). Returns the token to keep the session
 * alive, or `null` to tear it down — Auth.js v5 destroys the session when the
 * `jwt` callback returns `null` (the session is only rebuilt and re-cookied
 * inside `if (token !== null)`, packages/core/src/lib/actions/session.ts).
 *
 * Revocation triggers:
 *  - `dbUser === null` → the user row is gone (hard-purged) → revoke.
 *  - `dbUser.tokenVersion !== token.tokenVersion` → an explicit revocation
 *    bump happened → invalidate every JWT issued before the bump.
 *
 * Otherwise the token survives, but `status` + `role` + `timezone` are
 * refreshed from the DB so a status flip that does NOT bump `tokenVersion`
 * (e.g. a future admin suspend) still reaches the `authorized()` gate within
 * one request — defense in depth — and a member's self-service timezone change
 * (F2) propagates to `session.user.timezone` on the next request.
 *
 * Backward-compat: a JWT minted before this column existed has no
 * `tokenVersion` claim. We coalesce it to 0 (the column default) so existing
 * sessions are NOT mass-invalidated on deploy; revocation still fires the
 * moment any user's counter goes 0 → 1.
 */
export function applyRevocationCheck(
  token: JWT,
  dbUser: RevocationUserSnapshot | null,
): JWT | null {
  if (!dbUser) return null;

  const claimVersion = token.tokenVersion ?? 0;
  if (dbUser.tokenVersion !== claimVersion) return null;

  return {
    ...token,
    tokenVersion: dbUser.tokenVersion,
    status: dbUser.status,
    role: dbUser.role,
    timezone: dbUser.timezone,
  };
}

/**
 * DB orchestrator for the Node-side `jwt` callback. Re-reads the user's
 * revocation snapshot and delegates the decision to `applyRevocationCheck`.
 *
 * Fail-open: a DB error here means the app is already degraded (every page
 * queries Postgres), so we keep the user logged in and surface the blip to
 * Sentry rather than mass-logging-out the cohort on a transient outage. The
 * 30-day `maxAge` + the edge `authorized()` status gate remain coarse
 * backstops.
 *
 * Scale note (V2, ≫30 members): this runs on every Node `auth()` call. To cap
 * DB load at thousands of members, gate the re-fetch on token age (re-check
 * once per `updateAge` window, or only on sensitive routes). Kept
 * unconditional in V1 for immediate revocation — the security win J4 exists
 * for.
 */
export async function refreshAndCheckToken(token: JWT): Promise<JWT | null> {
  // Fail-CLOSED on a malformed token: with no subject we cannot resolve the
  // user to check the revocation epoch, so the token is untrusted and the
  // session is destroyed. Unreachable on the happy path — sign-in always sets
  // `sub` (auth.config.ts) and is short-circuited before this function in
  // auth.ts — but a future provider (e.g. magic link) that issued a sub-less
  // token must NOT slip past revocation (security-auditor J4 TIER 2).
  if (!token.sub) return null;

  try {
    const dbUser = await db.user.findUnique({
      where: { id: token.sub },
      select: { tokenVersion: true, status: true, role: true, timezone: true },
    });
    return applyRevocationCheck(token, dbUser);
  } catch (err) {
    reportWarning('auth.session-revocation', 'db_refresh_failed_fail_open', {
      errorName: err instanceof Error ? err.name : 'unknown',
    });
    return token;
  }
}
