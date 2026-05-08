import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerId, cronLimiter } from '@/lib/rate-limit/token-bucket';
import { recomputeAllActiveMembers } from '@/lib/scoring';

/**
 * Cron endpoint — recompute behavioral score snapshots (J6, SPEC §7.11).
 *
 * Wiring expected in production:
 *   `0 2 * * *` on Hetzner →
 *     curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *          https://app.fxmily.com/api/cron/recompute-scores
 *
 * Why 02:00 UTC: deep in the off-hours window for every supported member
 * timezone (V1 Europe/Paris — 03:00 winter / 04:00 summer local). The
 * service computes "yesterday-local" by default so the snapshot is stable
 * (today is partial — see `lib/scoring/service.ts`).
 *
 * Auth, rate-limit, debug-window logic: identical to the J5 cron at
 * `/api/cron/checkin-reminders` (SPEC §J5 audit Security HIGH H2 + CWE-208).
 *   - 503 when CRON_SECRET is not configured (refuse-by-default).
 *   - Per-IP token bucket (5 burst, 1/min refill) → 429 + Retry-After.
 *   - SHA-256 hashing on both sides + `timingSafeEqual` (length-safe).
 *   - 401 on missing/wrong secret.
 *   - GET → 405.
 *   - Optional `?at=ISO` dev override (double-gated: NODE_ENV+AUTH_URL).
 *
 * Idempotency: `recomputeAllActiveMembers` upserts on (userId, date), so a
 * second run within the same local-day overwrites the prior snapshot rather
 * than stacking duplicates.
 */

// Reads env + DB → must run on Node.js, never Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Constant-time secret comparison via SHA-256-then-timingSafeEqual.
 * Sidesteps the length-leak pitfall flagged by Cloudflare in their
 * `timingSafeEqual` guide (CWE-208).
 */
function verifyCronSecret(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'cron_disabled', detail: 'CRON_SECRET not configured.' },
      { status: 503 },
    );
  }

  // Per-IP token bucket — DoS + brute-force oracle protection.
  const id = callerId(req);
  const decision = cronLimiter.consume(id);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }

  const provided = req.headers.get('x-cron-secret');
  if (!provided || !verifyCronSecret(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Optional ?at=ISO dev override (back-test the cron against a fixed
  // instant). Double-gated against accidental prod activation.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await recomputeAllActiveMembers(now);
    // 1 audit row per scan (heartbeat) — counts only, no PII.
    await logAudit({
      action: 'cron.recompute_scores.scan',
      metadata: {
        computed: result.computed,
        skipped: result.skipped,
        errors: result.errors,
        ranAt: result.ranAt,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError('cron.recompute-scores', err, { route: '/api/cron/recompute-scores' });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: cron jobs use POST so the URL never leaks via referer.
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
