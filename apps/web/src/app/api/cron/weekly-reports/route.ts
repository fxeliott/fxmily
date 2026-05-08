import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerId, cronLimiter } from '@/lib/rate-limit/token-bucket';
import { generateWeeklyReportsForAllActiveMembers } from '@/lib/weekly-report/service';

/**
 * Cron endpoint — generate the weekly AI report for every active member and
 * email the digest to Eliot (J8, SPEC §7.10).
 *
 * Wiring expected in production : Hetzner crontab "0 21 * * 0" (every Sunday
 * at 21:00 UTC) →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmily.com/api/cron/weekly-reports
 *
 * Why Sunday 21:00 UTC : that's 22:00 Paris winter / 23:00 Paris summer — late
 * enough for the local-week to be effectively over (markets closed), early
 * enough for Eliot to read the digest Sunday evening before Monday open.
 *
 * Auth/rate-limit/dev-window : carbon-copy of the J5/J6/J7 crons. See
 *   - `lib/rate-limit/token-bucket.ts` (5 burst, 1/min refill, LRU-capped)
 *   - SPEC §J5 audit Security HIGH H2 + CWE-208 (length-leak defense)
 *
 * Idempotency : `(userId, weekStart)` is unique on `weekly_reports`, so a
 * second run for the same Sunday upserts. Email dispatch state is reset on
 * upsert so a stale digest doesn't appear "delivered".
 *
 * Cost guardrail : SPEC §16 ~5–10€/mois target. The mock client (default V1
 * path until ANTHROPIC_API_KEY is set) charges 0€ per call — DB still records
 * the *fictitious* cost computed from canonical pricing so the dashboard is
 * meaningful in dev. Real cost only accrues once the live client kicks in.
 *
 * Query flags (dev only — gated against prod) :
 *   - `?at=ISO` — back-test against a fixed instant.
 *   - `?dryRun=true` — generate + persist but skip the email send.
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

  // Optional ?at=ISO + ?dryRun — both gated behind `NODE_ENV !== 'production'`
  // *and* `AUTH_URL` not HTTPS-prod (J5 double-gate carbone).
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  const dryRunParam = url.searchParams.get('dryRun');
  let now: Date | undefined;
  let skipEmail = false;
  if (!isProdRuntime) {
    if (atParam) {
      // J8 audit fix — strict validation. Require a `T` or a space separator
      // so smoke tests can't accidentally pass `?at=2026-05-10` (which JS
      // parses as midnight UTC, leading to confusing "wrong week" reports
      // that aren't a logic bug, just a malformed param). Reject anything
      // that doesn't include a time component.
      if (/[Tt ]/.test(atParam)) {
        const parsed = new Date(atParam);
        if (!Number.isNaN(parsed.getTime())) now = parsed;
      }
    }
    if (dryRunParam === 'true' || dryRunParam === '1') {
      skipEmail = true;
    }
  }

  try {
    const result = await generateWeeklyReportsForAllActiveMembers({
      ...(now !== undefined ? { now } : {}),
      skipEmail,
    });
    await logAudit({
      action: 'cron.weekly_reports.scan',
      metadata: {
        scanned: result.scanned,
        generated: result.generated,
        skipped: result.skipped,
        errors: result.errors,
        emailsDelivered: result.emailsDelivered,
        emailsFailed: result.emailsFailed,
        emailsSkipped: result.emailsSkipped,
        mocked: result.mocked,
        totalCostEur: result.totalCostEur,
        ranAt: result.ranAt,
        skipEmail,
      },
    });
    return NextResponse.json({ ok: true, ...result, skipEmail });
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    reportError('cron.weekly-reports', err, { route: '/api/cron/weekly-reports', code });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: cron jobs use POST so the URL never leaks via referer.
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
