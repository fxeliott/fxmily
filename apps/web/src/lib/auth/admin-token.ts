import 'server-only';

import { NextResponse } from 'next/server';

import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import {
  adminBatchLimiter,
  calendarBatchLimiter,
  callerIdTrusted,
  monthlyBatchLimiter,
  seancesBatchLimiter,
  verificationBatchLimiter,
} from '@/lib/rate-limit/token-bucket';

/**
 * V1.7.2 — `X-Admin-Token` header verification for the admin batch routes.
 *
 * Mirrors the inline `verifyCronSecret(provided, expected)` pattern duplicated
 * across all 9 cron routes (`/api/cron/*`). Promoted here as a helper because
 * V1.7.2 introduces a new auth surface (`/api/admin/weekly-batch/*`) and we
 * want unit-test coverage of the constant-time path. Existing cron routes are
 * intentionally left untouched (anti-accumulation — refactor is out of scope
 * for V1.7.2 jalon ; would require touching 9 files for no functional change).
 *
 * Constant-time comparison via SHA-256-then-`timingSafeEqual`. Sidesteps the
 * length-leak pitfall flagged by Cloudflare's `timingSafeEqual` guide
 * (CWE-208 timing attacks). Hashing both sides to the same fixed-size buffer
 * means `Buffer.compare` walks the same number of bytes regardless of input
 * length.
 */
export function verifyAdminToken(provided: string, expected: string): boolean {
  return constantTimeEqual(provided, expected);
}

/**
 * Per-request guard for the `/api/admin/weekly-batch/*` routes.
 *
 * Returns a `NextResponse` to short-circuit the route handler when the
 * request is unauthorized / rate-limited / token not configured. Returns
 * `null` when the request is allowed to proceed.
 *
 * Order of checks (V1.7.2 audit fix — DIFFERENT from cron pattern intentionally) :
 *   1. **503** if `ADMIN_BATCH_TOKEN` is not configured (refuse-by-default)
 *   2. **401** if header missing or doesn't constant-time match
 *      → consume the rate-limit bucket on FAILURE (throttle scanners)
 *   3. **429** if the per-IP bucket is exhausted on a 401 path
 *   4. **null** (passthrough) if the token is valid — bucket NOT consumed
 *
 * Why this differs from the cron pattern : the cron routes consume the
 * bucket pre-auth because their threat model is a fixed Hetzner caller IP
 * (no public exposure of the bucket key). For admin batch, the bucket is
 * keyed by the *trusted* caller IP from `x-forwarded-for`'s LAST entry
 * (Caddy-injected), but it is exposed to the public internet. Consuming
 * pre-auth would let any unauthenticated caller drain Eliott's bucket and
 * lock him out of the Sunday batch (audit R2 V1.7.2 finding HIGH).
 *
 * Token check is itself constant-time (SHA-256 + timingSafeEqual) so brute
 * force is computationally infeasible; the rate-limit on the 401 path is
 * defense-in-depth against floods, not the primary gate.
 *
 * The 503 is intentionally a different status than 401 so monitoring can
 * distinguish "deploy missing env" (alert on-call) from "attacker probing"
 * (drop in the noise).
 */
export function requireAdminToken(req: Request): NextResponse | null {
  if (!env.ADMIN_BATCH_TOKEN) {
    return NextResponse.json(
      { error: 'admin_batch_disabled', detail: 'ADMIN_BATCH_TOKEN not configured.' },
      { status: 503 },
    );
  }

  const provided = req.headers.get('x-admin-token');
  if (!provided || !verifyAdminToken(provided, env.ADMIN_BATCH_TOKEN)) {
    // Failed auth — consume bucket to throttle floods. Use the trusted
    // caller IP (Caddy-injected last segment of XFF, not spoofable).
    const id = callerIdTrusted(req);
    const decision = adminBatchLimiter.consume(id);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * V1.4 §25 — per-request guard for the `/api/admin/monthly-batch/*` routes.
 *
 * EXACT carbon of {@link requireAdminToken} with two deliberate swaps:
 *   - reads `env.MONTHLY_ADMIN_BATCH_TOKEN` (SPEC §25.2 — token separate
 *     from the weekly `ADMIN_BATCH_TOKEN` so the monthly batch rotates
 *     independently ; a leaked weekly token must not unlock the monthly
 *     endpoints and vice-versa)
 *   - consumes the dedicated `monthlyBatchLimiter` on the 401 path (so a
 *     weekly-batch flood can never lock Eliott out of the monthly batch)
 *
 * Same anti-accumulation rationale as `requireAdminToken` : a parametrized
 * single helper would force touching the weekly routes + their tests for
 * zero functional change. `verifyAdminToken` (the pure constant-time
 * compare) IS reused — only the env key + limiter differ. Same check order
 * (503 → 401-consume-bucket → 429 → null) and same status semantics.
 */
export function requireMonthlyAdminToken(req: Request): NextResponse | null {
  if (!env.MONTHLY_ADMIN_BATCH_TOKEN) {
    return NextResponse.json(
      { error: 'monthly_batch_disabled', detail: 'MONTHLY_ADMIN_BATCH_TOKEN not configured.' },
      { status: 503 },
    );
  }

  const provided = req.headers.get('x-admin-token');
  if (!provided || !verifyAdminToken(provided, env.MONTHLY_ADMIN_BATCH_TOKEN)) {
    const id = callerIdTrusted(req);
    const decision = monthlyBatchLimiter.consume(id);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * §26 — per-request guard for the `/api/admin/calendar-batch/*` routes (J-C2).
 *
 * EXACT carbon of {@link requireMonthlyAdminToken} with two deliberate swaps:
 *   - reads `env.CALENDAR_ADMIN_BATCH_TOKEN` (§26 — token separate from the
 *     weekly/monthly tokens so the calendar batch rotates independently ; a
 *     leaked weekly/monthly token must not unlock the calendar endpoints and
 *     vice-versa)
 *   - consumes the dedicated `calendarBatchLimiter` on the 401 path (so a flood
 *     on another batch surface can never lock Eliott out of the calendar batch)
 *
 * Same anti-accumulation rationale: `verifyAdminToken` (the pure constant-time
 * compare) IS reused — only the env key + limiter differ. Same check order
 * (503 → 401-consume-bucket → 429 → null) and same status semantics.
 */
export function requireCalendarAdminToken(req: Request): NextResponse | null {
  if (!env.CALENDAR_ADMIN_BATCH_TOKEN) {
    return NextResponse.json(
      { error: 'calendar_batch_disabled', detail: 'CALENDAR_ADMIN_BATCH_TOKEN not configured.' },
      { status: 503 },
    );
  }

  const provided = req.headers.get('x-admin-token');
  if (!provided || !verifyAdminToken(provided, env.CALENDAR_ADMIN_BATCH_TOKEN)) {
    const id = callerIdTrusted(req);
    const decision = calendarBatchLimiter.consume(id);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * S3 §33.4 — per-request guard for the `/api/admin/verification-batch/*`
 * routes (5th local Claude pipeline, MT5 vision).
 *
 * EXACT carbon of {@link requireCalendarAdminToken} with two deliberate swaps:
 *   - reads `env.VERIFICATION_ADMIN_BATCH_TOKEN` (token separate from the
 *     weekly/monthly/calendar tokens — this surface also serves the proof
 *     IMAGES to the local script, a distinct compromise blast radius, so it
 *     rotates independently)
 *   - consumes the dedicated `verificationBatchLimiter` on the 401 path
 *     (larger burst: the script downloads one image per pending proof)
 *
 * Same anti-accumulation rationale: `verifyAdminToken` (the pure constant-time
 * compare) IS reused — only the env key + limiter differ. Same check order
 * (503 → 401-consume-bucket → 429 → null) and same status semantics.
 */
export function requireVerificationAdminToken(req: Request): NextResponse | null {
  if (!env.VERIFICATION_ADMIN_BATCH_TOKEN) {
    return NextResponse.json(
      {
        error: 'verification_batch_disabled',
        detail: 'VERIFICATION_ADMIN_BATCH_TOKEN not configured.',
      },
      { status: 503 },
    );
  }

  const provided = req.headers.get('x-admin-token');
  if (!provided || !verifyAdminToken(provided, env.VERIFICATION_ADMIN_BATCH_TOKEN)) {
    const id = callerIdTrusted(req);
    const decision = verificationBatchLimiter.consume(id);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * Réunion hub (séances) J4 — per-request guard for the
 * `/api/admin/seances-batch/*` routes (6th local Claude pipeline:
 * Zoom→Vimeo→Fathom→IA bornée, Règle n°1).
 *
 * EXACT carbon of {@link requireVerificationAdminToken} with two deliberate
 * swaps:
 *   - reads `env.SEANCES_ADMIN_BATCH_TOKEN` (token separate from the
 *     weekly/monthly/calendar/verification tokens — the séance content is
 *     produced on Eliott's local pipeline machine, a distinct compromise blast
 *     radius, so it rotates independently)
 *   - consumes the dedicated `seancesBatchLimiter` on the 401 path (so a flood
 *     on another batch surface can never lock Eliott out of the séance batch)
 *
 * Same anti-accumulation rationale: `verifyAdminToken` (the pure constant-time
 * compare) IS reused — only the env key + limiter differ. Same check order
 * (503 → 401-consume-bucket → 429 → null) and same status semantics. 0 PII:
 * séances carry no member identity (platform-wide content, 0 FK to User).
 */
export function requireSeancesAdminToken(req: Request): NextResponse | null {
  if (!env.SEANCES_ADMIN_BATCH_TOKEN) {
    return NextResponse.json(
      { error: 'seances_batch_disabled', detail: 'SEANCES_ADMIN_BATCH_TOKEN not configured.' },
      { status: 503 },
    );
  }

  const provided = req.headers.get('x-admin-token');
  if (!provided || !verifyAdminToken(provided, env.SEANCES_ADMIN_BATCH_TOKEN)) {
    const id = callerIdTrusted(req);
    const decision = seancesBatchLimiter.consume(id);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}
