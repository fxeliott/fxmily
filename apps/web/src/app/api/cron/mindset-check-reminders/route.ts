import { NextResponse, type NextRequest } from 'next/server';

import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import { runMindsetCheckReminderScan } from '@/lib/mindset/reminders';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — weekly mindset-check reminder (SPEC §27.2/§27.4).
 *
 * Wiring expected in production:
 *   `0 9 * * 1` on Hetzner (Monday 09:00 UTC) →
 *     curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *          https://app.fxmilyapp.com/api/cron/mindset-check-reminders
 *
 * Why weekly Monday: the mindset week opens Monday (`weekStart`); one gentle
 * nudge per week is the anti-FOMO cadence (SPEC §27.2 — non-culpabilisant,
 * no email). Idempotency is application-level in the scan (skip a member who
 * already submitted this week or already has a pending nudge for this week),
 * so a double cron fire is a no-op — no DB dedup index needed.
 *
 * Auth: header `X-Cron-Secret` must match `env.CRON_SECRET`. If `CRON_SECRET`
 * is not set, the endpoint returns 503 — refuses to run unauthenticated, even
 * in dev. The comparison is constant-time (CWE-208): both sides are SHA-256
 * hashed first to guarantee equal byte length, then `timingSafeEqual`.
 *
 * Response: JSON summary of the scan (always small, no PII).
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

  // Per-IP token bucket (5 burst, 1/min refill), consumed BEFORE the verify
  // (anti-oracle + DoS guard — audit J5 Security HIGH H2 canon).
  const id = callerIdTrusted(req);
  const decision = cronLimiter.consume(id);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
        },
      },
    );
  }

  const provided = req.headers.get('x-cron-secret');
  if (!provided || !constantTimeEqual(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Optional ?at=ISO to back-test a specific instant. Gated on BOTH
  // NODE_ENV !== production AND AUTH_URL not being HTTPS prod-style — belt +
  // braces against a misconfigured systemd service that drops NODE_ENV.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await runMindsetCheckReminderScan(now);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    reportError('cron.mindset-check-reminders', err, {
      route: '/api/cron/mindset-check-reminders',
      code,
    });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // Block accidental GET hits — the endpoint is POST-only on purpose (cron
  // jobs use POST so there's no risk of the URL leaking via referer).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
