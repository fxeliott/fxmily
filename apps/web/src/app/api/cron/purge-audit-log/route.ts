import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { purgeStaleAuditLog } from '@/lib/audit/cleanup';
import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerId, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — purge stale audit_log rows past 90 days
 * (J10 V2-roadmap reclassed item — `auditLog` retention).
 *
 * Why this exists : `audit_logs` is the most write-heavy table in V1.
 * Without retention, we land ~15k rows/day at 1000 members and saturate
 * write IOPS on the Hetzner CX22 (4 GB / SSD) within months. 90 days
 * keeps RGPD §16 ops post-mortem flexibility while bounding the working
 * set so the (action, created_at desc) index never exceeds RAM.
 *
 * Wiring expected : Hetzner crontab daily 04:00 UTC.
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmily.com/api/cron/purge-audit-log
 *
 * Auth/rate-limit/dev-window : carbon-copy of the J5/J6/J7/J8/J9/J10 crons.
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
    const result = await purgeStaleAuditLog(now ? { now } : {});
    // Audit row written AFTER deleteMany — by construction it survives the
    // current run (createdAt > thresholdDate). The next-day cron will see
    // it and not consider it for purge until the next 90-day cycle.
    await logAudit({
      action: 'cron.purge_audit_log.scan',
      metadata: {
        scanned: result.scanned,
        purgedCount: result.purged,
        errors: result.errors,
        thresholdDate: result.thresholdDate,
        ranAt: result.ranAt,
      },
    });
    return NextResponse.json({
      ok: true,
      purged: result.purged,
      scannedAt: result.ranAt,
      scanned: result.scanned,
      errors: result.errors,
      thresholdDate: result.thresholdDate,
    });
  } catch (err) {
    reportError('cron.purge-audit-log', err, {
      route: '/api/cron/purge-audit-log',
    });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
