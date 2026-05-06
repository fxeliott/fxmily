import { NextResponse, type NextRequest } from 'next/server';

import { runCheckinReminderScan } from '@/lib/checkin/reminders';
import { env } from '@/lib/env';

/**
 * Cron endpoint — scan check-in reminder windows (J5).
 *
 * Wiring expected in production:
 *   `*\/15 7-22 * * *` on Hetzner →
 *     curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *          https://app.fxmily.com/api/cron/checkin-reminders
 *
 * Why every 15 min: the morning window is 90 min (07:30–09:00) and the
 * evening window is 90 min as well; a 15-min cadence guarantees each member
 * gets exactly one reminder per slot per day (idempotency on the queue side
 * deduplicates). The actual web-push dispatch lives in J9.
 *
 * Auth: header `X-Cron-Secret` must match `env.CRON_SECRET`. If `CRON_SECRET`
 * is not set, the endpoint returns 503 — refuses to run unauthenticated, even
 * in dev. To run a local test, set `CRON_SECRET=…` in the worktree `.env`.
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

  const provided = req.headers.get('x-cron-secret');
  if (!provided || provided !== env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Optional ?at=ISO query param to back-test a specific instant. Ignored
  // outside development to keep prod deterministic.
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (env.NODE_ENV !== 'production' && atParam) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    const result = await runCheckinReminderScan(now);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron.checkin-reminders] scan failed', err);
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // Block accidental GET hits with curl — the endpoint is POST-only on purpose
  // (cron jobs use POST so there's no risk of the URL leaking via referer).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
