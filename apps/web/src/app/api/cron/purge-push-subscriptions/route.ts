import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { purgeStalePushSubscriptions } from '@/lib/push/cleanup';
import { callerId, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — purge stale Web Push subscriptions (J10, RGPD §16,
 * J9 reclassed close-out item).
 *
 * Wiring expected : Hetzner crontab weekly Sunday 05:00 UTC.
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmilyapp.com/api/cron/purge-push-subscriptions
 *
 * Why weekly (not daily) : cohort shrink rate at 30 → 1000 members is
 * measured in handfuls of subscriptions per week; daily would amortise
 * over noise-free runs and crowd the audit trail.
 *
 * Auth/rate-limit/dev-window : carbon-copy of the J5/J6/J7/J8/J9 crons.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyCronSecret(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam && /[Tt ]/.test(atParam)) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await purgeStalePushSubscriptions(now ? { now } : {});
    await logAudit({
      action: 'cron.purge_push_subscriptions.scan',
      metadata: {
        scanned: result.scanned,
        deleted: result.deleted,
        errors: result.errors,
        staleThreshold: result.staleThreshold,
        ranAt: result.ranAt,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError('cron.purge-push-subscriptions', err, {
      route: '/api/cron/purge-push-subscriptions',
    });
    // J10 Phase J — flush Sentry queue before exit (perf-profiler T3.6).
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
