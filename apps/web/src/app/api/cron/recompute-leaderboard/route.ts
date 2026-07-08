import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import { recomputeLeaderboard } from '@/lib/leaderboard';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — recompute the member leaderboard ranking (SPEC §2 posture).
 *
 * Wiring in production (runs 20 min AFTER `recompute-scores` at 02:00 so every
 * member's `BehavioralScore` is already fresh for the night — crontab.fxmily:75):
 *   `20 2 * * *` on Hetzner →
 *     curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *          https://app.fxmilyapp.com/api/cron/recompute-leaderboard
 *
 * The ranking is a pure composite of already-computed ACT surfaces (engagement,
 * discipline, regularity, tracking coverage) — it re-derives no trade/check-in
 * and reads NO P&L (firewall §21.5). Anchored on yesterday-local, matching the
 * behavioral snapshot the earlier cron just wrote.
 *
 * Auth, rate-limit, dev-override logic: identical to `/api/cron/recompute-scores`
 * (SPEC §J5 audit Security HIGH H2 + CWE-208).
 *   - 503 when CRON_SECRET is not configured (refuse-by-default).
 *   - Per-IP token bucket (5 burst, 1/min refill) → 429 + Retry-After.
 *   - constant-time secret compare → 401 on missing/wrong secret.
 *   - GET → 405.
 *   - Optional `?at=ISO` dev override (double-gated: NODE_ENV + AUTH_URL).
 *
 * Idempotency: `recomputeLeaderboard` upserts on (userId, date), so a second run
 * within the same local-day overwrites rather than stacking duplicates.
 */

// Reads env + DB → must run on Node.js, never Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'cron_disabled', detail: 'CRON_SECRET not configured.' },
      { status: 503 },
    );
  }

  // Per-IP token bucket — DoS + brute-force oracle protection.
  const id = callerIdTrusted(req);
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
  if (!provided || !constantTimeEqual(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Optional ?at=ISO dev override (back-test the cron against a fixed instant).
  // Double-gated against accidental prod activation.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam && /[Tt ]/.test(atParam)) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await recomputeLeaderboard(now);
    // 1 audit row per scan (heartbeat) — counts only, no PII.
    await logAudit({
      action: 'cron.recompute_leaderboard.scan',
      metadata: {
        computed: result.computed,
        ranked: result.ranked,
        errors: result.errors,
        ranAt: result.ranAt,
        date: result.date,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError('cron.recompute-leaderboard', err, {
      route: '/api/cron/recompute-leaderboard',
    });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: cron jobs use POST so the URL never leaks via referer.
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
