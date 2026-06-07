import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — RGPD purge of self-service access requests (V2.5, SPEC §16).
 *
 * `AccessRequest` rows store a NON-member's name + email (PII without account
 * consent). This cron keeps the table from accumulating dormant PII by deleting:
 *
 *   - every `rejected` row (terminal, no reason to keep a refused prospect's PII);
 *   - every `pending` row older than 30 days (abandoned / never reviewed);
 *   - every `approved` row older than 30 days (the invitation has been minted +
 *     emailed; the request's PII is no longer needed — the User row, if the
 *     prospect onboards, carries its own consent + lifecycle).
 *
 * Wiring expected in production : Hetzner crontab weekly Sunday 04:00 UTC →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmilyapp.com/api/cron/purge-access-requests
 *
 * Auth/rate-limit/dev-window : carbon-copy of `purge-deleted`.
 *   - SHA-256 + `timingSafeEqual` (CWE-208 length-leak defense)
 *   - Token bucket (5 burst, 1/min, LRU 1024) BEFORE secret check
 *   - 503 if `CRON_SECRET` missing, 401 on bad secret, 405 on GET, 429 on rate
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resolved rows older than this (in days) are purged. Pending rows too. */
const PURGE_AFTER_DAYS = 30;

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
    const refNow = now ?? new Date();
    const threshold = new Date(refNow.getTime() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    // Delete: any rejected row, OR a pending/approved row older than the
    // threshold. Single `deleteMany` — the AccessRequest model has no
    // cascade children, so there's nothing else to clean up.
    const result = await db.accessRequest.deleteMany({
      where: {
        OR: [
          { status: 'rejected' },
          { status: 'pending', createdAt: { lt: threshold } },
          { status: 'approved', createdAt: { lt: threshold } },
        ],
      },
    });

    await logAudit({
      action: 'cron.purge_access_requests.scan',
      metadata: {
        purged: result.count,
        thresholdDays: PURGE_AFTER_DAYS,
        threshold: threshold.toISOString(),
        ranAt: refNow.toISOString(),
      },
    });

    return NextResponse.json({ ok: true, purged: result.count });
  } catch (err) {
    reportError('cron.purge-access-requests', err, {
      route: '/api/cron/purge-access-requests',
    });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
