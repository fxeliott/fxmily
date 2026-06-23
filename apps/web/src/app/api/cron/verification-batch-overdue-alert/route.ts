import { NextResponse, type NextRequest } from 'next/server';

import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';
import { runVerificationOverdueAlert } from '@/lib/verification/overdue';

/**
 * Cron endpoint — AUTONOMY-1 MT5 proof vision overdue ADMIN nudge (vérification
 * permanence, 5th twin of the §26 calendar / §25 monthly / S2 onboarding / J8
 * weekly nets).
 *
 * Read-only safety-net for the manual MT5 vision batch. The batch is triggered
 * by hand (ban-risk human-in-the-loop §5.4 — the generation is NEVER cronned,
 * see `lib/verification/batch.ts`) ; this cron makes that design RELIABLE by
 * nudging the admin when uploaded proofs stay `pending` past the grace window —
 * so no member silently waits forever for their account/positions to be
 * extracted. It never drives Claude : it only counts rows and emails the
 * operator. See {@link runVerificationOverdueAlert}.
 *
 * Wiring expected in production : Hetzner crontab daily 11:50 UTC (13:50 Paris) →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmilyapp.com/api/cron/verification-batch-overdue-alert
 *
 * Auth/rate-limit/dev-window : carbon-copy of `monthly-debrief-overdue-alert`.
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
    const result = await runVerificationOverdueAlert(now ? { now } : {});
    return NextResponse.json({
      ok: true,
      overdueCount: result.overdueCount,
      oldestUploadedAt: result.oldestUploadedAt,
      withinGrace: result.withinGrace,
      emailOutcome: result.emailOutcome,
    });
  } catch (err) {
    reportError('cron.verification-batch-overdue-alert', err, {
      route: '/api/cron/verification-batch-overdue-alert',
    });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
