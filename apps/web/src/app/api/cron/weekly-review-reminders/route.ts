import { NextResponse, type NextRequest } from 'next/server';

import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';
import { runWeeklyReviewReminderScan } from '@/lib/weekly-review/reminders';

/**
 * Cron endpoint — nudge active members who haven't written their weekly review
 * (REFLECT V1.8, J2 notification).
 *
 * Wiring expected in production:
 *   `0 9 * * 0` on Hetzner (Sunday 09:00 Paris) →
 *     curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *          https://app.fxmilyapp.com/api/cron/weekly-review-reminders
 *
 * Why Sunday morning: the weekly review is a Sunday recap ritual — a single
 * gentle reminder at the start of the day catches members who haven't logged
 * yet. `enqueueWeeklyReviewReminderNotification` owns the "max 1/week" dedup, so
 * a benign re-run never double-nudges. The actual web-push dispatch lives in J9.
 *
 * Auth: header `X-Cron-Secret` must match `env.CRON_SECRET`. If `CRON_SECRET`
 * is not set, the endpoint returns 503 — refuses to run unauthenticated, even
 * in dev. To run a local test, set `CRON_SECRET=…` in the worktree `.env`.
 * The comparison is **constant-time** (CWE-208 mitigation): both sides are
 * SHA-256 hashed first to guarantee equal byte length, then `timingSafeEqual`
 * walks every byte. Without this, a network-level adversary could byte-by-byte
 * reconstruct CRON_SECRET via timing differences.
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

  // Per-IP token bucket (5 burst, 1/min refill). Even with the secret
  // being constant-time compared, an unbounded request rate from a single
  // source is a DoS vector and an oracle for brute-forcing — audit J5
  // Security HIGH H2.
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

  // Optional ?at=ISO query param to back-test a specific instant. Gated on
  // BOTH NODE_ENV !== production AND AUTH_URL not being HTTPS prod-style —
  // belt + braces against a misconfigured systemd service that drops
  // NODE_ENV (Zod default falls back to 'development' otherwise).
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam && /[Tt ]/.test(atParam)) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await runWeeklyReviewReminderScan(now);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Don't leak the error stack — keep the message plain so logs stay tidy
    // and Sentry (J10) doesn't accidentally surface DB internals.
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    reportError('cron.weekly-review-reminders', err, {
      route: '/api/cron/weekly-review-reminders',
      code,
    });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // Block accidental GET hits with curl — the endpoint is POST-only on purpose
  // (cron jobs use POST so there's no risk of the URL leaking via referer).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
