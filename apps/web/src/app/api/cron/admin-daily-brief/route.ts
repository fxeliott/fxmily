import { NextResponse, type NextRequest } from 'next/server';

import { runAdminDailyBrief } from '@/lib/admin/daily-brief';
import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — Tour 15 daily ADMIN brief (« point du matin »).
 *
 * Composes a count-only, PII-free brief of where the coach should look today
 * (triage queue counts, new behavioral signals since yesterday, members drifting
 * away — all REUSED from already-stored signals) and emails it to the operator.
 * It never drives Claude and never mutates member data: pure read + one heartbeat
 * audit row. See {@link runAdminDailyBrief}.
 *
 * Wiring expected in production : Hetzner crontab daily 05:00 UTC (07:00 Paris) →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmilyapp.com/api/cron/admin-daily-brief
 *
 * Auth/rate-limit/dev-window : carbon-copy of `weekly-report-overdue-alert`.
 *   - SHA-256 + `timingSafeEqual` (CWE-208 length-leak defense)
 *   - Token bucket (5 burst, 1/min, LRU 1024) BEFORE secret check
 *   - 503 if `CRON_SECRET` missing, 401 on bad secret, 405 on GET, 429 on rate
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'cron_disabled', detail: 'CRON_SECRET not configured.' },
      { status: 503 },
    );
  }

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

  // ?at=ISO dev override (double-gated against accidental prod activation,
  // strict T-required to avoid ambiguous date-only inputs). Mirror the other
  // cron routes so a local run can compose the brief for a fixed instant.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam && /[Tt ]/.test(atParam)) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await runAdminDailyBrief(now ? { now } : {});
    return NextResponse.json({
      ok: true,
      triageTotal: result.triage.total,
      newSignalMembers: result.newSignalMembers,
      disengagedMembers: result.disengagedMembers,
      emailOutcome: result.emailOutcome,
    });
  } catch (err) {
    reportError('cron.admin-daily-brief', err, { route: '/api/cron/admin-daily-brief' });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'brief_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
