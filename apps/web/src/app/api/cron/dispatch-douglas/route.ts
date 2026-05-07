import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { callerId, cronLimiter } from '@/lib/rate-limit/token-bucket';
import { dispatchForAllActiveMembers } from '@/lib/triggers/engine';

/**
 * Cron endpoint - temporal Mark Douglas dispatch (J7, SPEC §7.6).
 *
 * Wiring expected in production: every 6 hours on Hetzner via crontab
 * "0 0,6,12,18 * * *" or equivalent ->
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmily.com/api/cron/dispatch-douglas
 *
 * Why every 6h: temporal triggers (no_checkin_streak, weekly drift) do not
 * fire from member actions - a member who hasn't logged in for 7 days has no
 * after() chance to evaluate. The cron walks every active member and runs
 * the full dispatch pipeline. 6h cadence is a fair balance between freshness
 * and DB load.
 *
 * Auth/rate-limit/dev-window: identical to the J6 cron at
 * /api/cron/recompute-scores - see lib/rate-limit/token-bucket.ts and SPEC
 * J5 audit Security HIGH H2 + CWE-208.
 *
 * Idempotency: the engine (userId, cardId, triggeredOn) unique index ensures
 * a member receives at most 1 delivery of a given card per local day, even
 * if the cron runs 4x a day or overlaps with after() Server Action paths.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  try {
    const result = await dispatchForAllActiveMembers();
    await logAudit({
      action: 'cron.dispatch_douglas.scan',
      metadata: {
        scanned: result.scanned,
        delivered: result.delivered,
        matched: result.matched,
        errors: result.errors,
        ranAt: result.ranAt,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    console.error('[cron.dispatch-douglas] scan failed', { code });
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
