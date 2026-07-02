import { NextResponse } from 'next/server';

import { requireSeancesAdminToken } from '@/lib/auth/admin-token';
import { reportError } from '@/lib/observability';
import { loadSeancePipelineEnvelope } from '@/lib/seances/pipeline-service';

/**
 * Réunion hub (séances) J4 — local content pipeline PULL endpoint.
 *
 * Pattern carbone `app/api/admin/verification-batch/pull/route.ts`.
 *
 * Returns the declared go/no-go sessions in the rolling admin window with their
 * current pipeline sync state (checkpoints, needsReview, syncedAt) — PII-free
 * (0 FK to User). The local orchestrator applies the go/no-go to its own state,
 * skips what is already synced (idempotence), and re-arms anything flagged for
 * regeneration. Mirror of the standalone `admin-sync.getState().gonogo`, over
 * Postgres instead of the Cloudflare KV.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const guard = requireSeancesAdminToken(req);
  if (guard) return guard;

  try {
    const envelope = await loadSeancePipelineEnvelope();
    return NextResponse.json(envelope, { status: 200 });
  } catch (err) {
    reportError('seance.batch.pull', err instanceof Error ? err : new Error('seance_pull_unknown'));
    return NextResponse.json({ error: 'pull_failed' }, { status: 500 });
  }
}

/** GET → 405. Only POST allowed (mirror of the other batch pull routes). */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
