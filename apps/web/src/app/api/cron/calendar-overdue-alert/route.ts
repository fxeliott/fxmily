import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { runCalendarOverdueAlert } from '@/lib/calendar/overdue';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — §26 calendar overdue ADMIN nudge (Session 5, DoD#4).
 *
 * Read-only safety-net for the manual calendar batch. The batch is triggered by
 * hand (ban-risk human-in-the-loop §5.4) ; this cron makes that design RELIABLE
 * by nudging the admin when members have a filled questionnaire but no generated
 * calendar past the grace window — so nothing slips silently. It never drives
 * Claude, never touches the ban-risk path : it only counts rows and emails the
 * operator. See {@link runCalendarOverdueAlert}.
 *
 * Wiring expected in production : Hetzner crontab daily 11:00 UTC (13:00 Paris) →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmilyapp.com/api/cron/calendar-overdue-alert
 *
 * Auth/rate-limit/dev-window : carbon-copy of `purge-access-requests`.
 *   - SHA-256 + `timingSafeEqual` (CWE-208 length-leak defense)
 *   - Token bucket (5 burst, 1/min, LRU 1024) BEFORE secret check
 *   - 503 if `CRON_SECRET` missing, 401 on bad secret, 405 on GET, 429 on rate
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
  if (!provided || !verifyCronSecret(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?at=ISO dev override (double-gated against accidental prod activation,
  // strict T-required to avoid ambiguous date-only inputs). Mirror purge-deleted.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam && /[Tt ]/.test(atParam)) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await runCalendarOverdueAlert(now ? { now } : {});
    return NextResponse.json({
      ok: true,
      weekStart: result.weekStart,
      overdueCount: result.overdueCount,
      questionnaireCount: result.questionnaireCount,
      emailOutcome: result.emailOutcome,
    });
  } catch (err) {
    reportError('cron.calendar-overdue-alert', err, {
      route: '/api/cron/calendar-overdue-alert',
    });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
