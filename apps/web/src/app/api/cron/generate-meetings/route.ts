import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { localDateOf } from '@/lib/checkin/timezone';
import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { MEETING_TIMEZONE } from '@/lib/meeting/occurrence';
import { generateMeetingsForWindow } from '@/lib/meeting/service';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — materialise the rolling window of Fxmily meeting slots
 * (V1.7 §30 J-M3, SPEC §30.4).
 *
 * Wiring expected in production:
 *   `0 6 * * 1-5` on Hetzner (weekdays) →
 *     curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *          https://app.fxmilyapp.com/api/cron/generate-meetings
 *
 * Why 06:00 UTC weekdays: a generous lead before the day's 12h Paris slot
 * (10:00/11:00 UTC depending on DST) so the row exists when the member opens
 * `/reunions`, and a free off-hours slot that does not overlap the
 * dispatch-douglas 06:00 job's neighbours. The window is a rolling
 * `[today, today + N]` (N = 7 calendar days) so a missed run self-heals on the
 * next: the generation is idempotent on `@@unique(date, slot)`.
 *
 * Auth, rate-limit, debug-window logic: identical to the J6 cron at
 * `/api/cron/recompute-scores` (SPEC §J5 audit Security HIGH H2 + CWE-208).
 *   - 503 when CRON_SECRET is not configured (refuse-by-default).
 *   - Per-IP token bucket (5 burst, 1/min refill) → 429 + Retry-After.
 *   - SHA-256 hashing on both sides + `timingSafeEqual` (length-safe).
 *   - 401 on missing/wrong secret.
 *   - GET → 405.
 *   - Optional `?at=ISO` dev override (double-gated: NODE_ENV+AUTH_URL).
 *
 * Idempotency: `generateMeetingsForWindow` uses `createMany({ skipDuplicates:
 * true })` on `(date, slot)`, so a second run within the same window inserts 0
 * duplicates (SPEC §30.7 — re-run = 0 doublon).
 */

// Reads env + DB → must run on Node.js, never Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rolling generation horizon (calendar days, `today` inclusive). 7 days keeps a
 * full week of slots materialised ahead even if a weekday run is missed — the
 * pure occurrence generator skips weekends, so this is "next 7 days of
 * calendar", not "7 meeting days".
 */
const GENERATION_WINDOW_DAYS = 7;

/**
 * Constant-time secret comparison via SHA-256-then-timingSafeEqual.
 * Sidesteps the length-leak pitfall flagged by Cloudflare in their
 * `timingSafeEqual` guide (CWE-208).
 */
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

  // Per-IP token bucket — DoS + brute-force oracle protection.
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

  // Optional ?at=ISO dev override (back-test the cron against a fixed
  // instant). Double-gated against accidental prod activation.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now = new Date();
  if (!isProdRuntime && atParam) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }

  try {
    // `fromLocalDate` = today (Europe/Paris civil day). The occurrence builder
    // derives `scheduledAt` (DST-aware) then `date` from it (invariant §30.7).
    const fromLocalDate = localDateOf(now, MEETING_TIMEZONE);
    const result = await generateMeetingsForWindow(fromLocalDate, GENERATION_WINDOW_DAYS);
    const ranAt = now.toISOString();
    // 1 audit row per scan (heartbeat) — counts only, no PII, no member id.
    await logAudit({
      action: 'meeting.generated',
      metadata: {
        generated: result.generated,
        skipped: result.skipped,
        ranAt,
      },
    });
    return NextResponse.json({ ok: true, ...result, ranAt });
  } catch (err) {
    reportError('cron.generate-meetings', err, { route: '/api/cron/generate-meetings' });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: cron jobs use POST so the URL never leaks via referer.
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
