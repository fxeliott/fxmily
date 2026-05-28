import { NextResponse } from 'next/server';

import { requireAdminToken } from '@/lib/auth/admin-token';
import { loadAllSnapshotsForCompletedInterviews } from '@/lib/onboarding-interview/batch';
import { reportError } from '@/lib/observability';

/**
 * V2.4 Phase A.2 — Onboarding interview batch pull endpoint (Session β,
 * M3 directive 2026-05-28).
 *
 * Pattern carbone V1.7.2 `app/api/admin/weekly-batch/pull/route.ts`.
 *
 * Authentication : `X-Admin-Token` header (SHA-256 + timingSafeEqual via
 * `requireAdminToken`) — same separate token as weekly-batch (rotation
 * indépendante from the cron secret, `ADMIN_BATCH_TOKEN` env var).
 *
 * Rate limit : `adminBatchLimiter` (burst 10, refill 1/5min per IP).
 *
 * Returns : `BatchPullEnvelope` JSON containing the system prompt + JSON
 * schema + entries (pseudonymized snapshots). The local script
 * (`ops/scripts/onboarding-batch-local.sh`, CHECKPOINT 12+) consumes this
 * envelope, loops over entries with `claude --print` (~60-120s jittered),
 * then POSTs results to the `/persist` endpoint.
 *
 * Idempotency : the pull filters out interviews already analyzed
 * (`MemberProfile.interviewId` row exists). So Eliot can run the batch
 * multiple times safely — only un-analyzed completed interviews are picked.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  // Step 1 — Admin token gate (SHA-256 + timingSafeEqual + rate-limit).
  // requireAdminToken returns a NextResponse on failure (503/429/401) ;
  // returns null on success.
  const guard = await requireAdminToken(req);
  if (guard) return guard;

  // Step 2 — Pull snapshots. The function does its own audit logging
  // (`onboarding.batch.pulled` slug). We just convert exceptions to 500.
  try {
    const envelope = await loadAllSnapshotsForCompletedInterviews();
    return NextResponse.json(envelope, { status: 200 });
  } catch (err) {
    reportError(
      'onboarding-interview.batch.pull',
      err instanceof Error ? err : new Error('batch_pull_unknown'),
    );
    return NextResponse.json(
      {
        error: 'batch_pull_failed',
        message: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
      },
      { status: 500 },
    );
  }
}

/** GET → 405. Only POST allowed. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
