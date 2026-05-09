import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { materialisePendingDeletions, purgeMaterialisedDeletions } from '@/lib/account/deletion';
import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerId, cronLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Cron endpoint — RGPD soft-delete lifecycle (J10, SPEC §15 J10 + §16).
 *
 * Two phases each invocation :
 *
 *   1. **Materialise pending deletions** — every user with `status='active' AND
 *      deletedAt <= now` had their 24h grace expire ; we now flip status to
 *      'deleted' and scrub PII. After this point, login is blocked
 *      (`auth.ts` gates on `status==='active'`). Idempotent : a row that
 *      was already materialised (status='deleted') is skipped via the WHERE.
 *
 *   2. **Hard-purge stale soft-deletes** — every row with `status='deleted'
 *      AND deletedAt < now - 30d` is `prisma.user.delete`'d. The FK cascade
 *      across Trades/Checkins/Scores/etc. removes everything user-scoped
 *      atomically. After this, the audit row remains (`userId=null`) for
 *      sec/ops post-mortem.
 *
 * Wiring expected in production : Hetzner crontab daily 03:00 UTC →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmilyapp.com/api/cron/purge-deleted
 *
 * Auth/rate-limit/dev-window : carbon-copy of the J5/J6/J7/J8/J9 crons.
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

  // ?at=ISO dev override (double-gated against accidental prod activation,
  // strict T-required to avoid ambiguous "?at=2026-05-10" date-only inputs).
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
    // Sequential, not Promise.all (J10 Phase G hardening — code-reviewer B2).
    // The two phases operate on disjoint sets at the WHERE-clause level
    // (`status='active'` vs `status='deleted'`), but parallelising them
    // means the audit row counts can race against an in-flight `update`
    // inside `materialise`. Sequential is observably safer for ops triage
    // and the wall-clock cost (≤ 1s for 30 → 1000 members at batch 200) is
    // well under the cron budget.
    const materialise = await materialisePendingDeletions({ now: refNow });
    const purge = await purgeMaterialisedDeletions({ now: refNow });

    await logAudit({
      action: 'cron.purge_deleted.scan',
      metadata: {
        materialiseScanned: materialise.scanned,
        materialised: materialise.materialised,
        materialiseErrors: materialise.errors,
        materialisedIds: materialise.materialisedIds,
        purgeScanned: purge.scanned,
        purged: purge.purged,
        purgeErrors: purge.errors,
        purgeThreshold: purge.threshold,
        purgedIds: purge.purgedIds,
        ranAt: refNow.toISOString(),
      },
    });

    // Per-user materialised audit trail. The user row still exists at this
    // point (status flipped to 'deleted') so we can carry `userId` directly.
    for (const userId of materialise.materialisedIds) {
      await logAudit({
        action: 'account.deletion.materialised',
        userId,
        metadata: { ranAt: refNow.toISOString() },
      });
    }

    // Per-user purge audit trail. Carrying `userId` in `metadata` (not the
    // FK column) preserves the value beyond the cascade `SetNull` — without
    // it, post-mortem "did user X get purged on day Y ?" is unanswerable.
    for (const userId of purge.purgedIds) {
      await logAudit({
        action: 'account.deletion.purged',
        metadata: { userId, ranAt: refNow.toISOString() },
      });
    }

    return NextResponse.json({
      ok: true,
      materialise,
      purge,
    });
  } catch (err) {
    reportError('cron.purge-deleted', err, { route: '/api/cron/purge-deleted' });
    // J10 Phase J — flush before returning so the captured event isn't
    // lost when the cron worker exits (perf-profiler T3.6).
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
