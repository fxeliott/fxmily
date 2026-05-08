import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { dispatchAllReady } from '@/lib/push/dispatcher';
import { callerId, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — walk the `notification_queue` and dispatch every ready row
 * via Web Push (J9, SPEC §7.9, §16, §18.2).
 *
 * Wiring expected in production : Hetzner crontab "every 2 minutes" →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmily.com/api/cron/dispatch-notifications
 *
 * Why every 2 minutes : balance latency (a member submitting a check-in at
 * 7:31 should get the absent reminder before 7:35) vs cost (push services
 * already buffer; we don't need to hammer them).
 *
 * Auth/rate-limit/dev-window : carbon-copy of the J5/J6/J7/J8 crons.
 *   - SHA-256 + `timingSafeEqual` (CWE-208 length-leak defense)
 *   - Token bucket (5 burst, 1/min, LRU 1024) BEFORE secret check
 *   - 503 if `CRON_SECRET` missing, 401 on bad secret, 405 on GET, 429 on rate
 *
 * Idempotency : `dispatchOne` claims rows atomically (UPDATE WHERE
 * status='pending' AND ...). Two concurrent runs converge on the same set
 * without double-sending.
 *
 * Cost guardrail : zero API cost — Web Push uses the browser-native FCM/APNs
 * relays, no Anthropic SDK call. Mock client is the V1 default until VAPID
 * env vars are set; live client kicks in when ready.
 *
 * Query flags (dev only — gated against prod) :
 *   - `?at=ISO` — back-test against a fixed instant (must include `T`).
 *   - `?maxPerRun=N` — cap how many rows to process this run (default 200).
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

  // ?at=ISO + ?maxPerRun — both gated behind dev runtime.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  const maxParam = url.searchParams.get('maxPerRun');
  let now: Date | undefined;
  let maxPerRun: number | undefined;
  if (!isProdRuntime) {
    if (atParam && /[Tt ]/.test(atParam)) {
      const parsed = new Date(atParam);
      if (!Number.isNaN(parsed.getTime())) now = parsed;
    }
    if (maxParam !== null && /^\d+$/.test(maxParam)) {
      const n = Number(maxParam);
      if (n > 0 && n <= 1000) maxPerRun = n;
    }
  }

  try {
    const result = await dispatchAllReady({
      ...(now !== undefined ? { now } : {}),
      ...(maxPerRun !== undefined ? { maxPerRun } : {}),
    });
    await logAudit({
      action: 'cron.dispatch_notifications.scan',
      metadata: {
        scanned: result.scanned,
        sent: result.sent,
        retried: result.retried,
        failed: result.failed,
        skipped: result.skipped,
        recoveredStuck: result.recoveredStuck,
        ranAt: result.ranAt,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    console.error('[cron.dispatch-notifications] scan failed', { code });
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: cron jobs use POST so the URL never leaks via referer.
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
