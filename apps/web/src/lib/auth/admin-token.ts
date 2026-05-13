import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { adminBatchLimiter, callerIdTrusted } from '@/lib/rate-limit/token-bucket';

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
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
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
 * pre-auth would let any unauthenticated caller drain Eliot's bucket and
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
