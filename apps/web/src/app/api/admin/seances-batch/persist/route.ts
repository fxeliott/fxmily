import { NextResponse } from 'next/server';

import { requireSeancesAdminToken } from '@/lib/auth/admin-token';
import { reportError, reportWarning } from '@/lib/observability';
import { persistSeancePipelineResults } from '@/lib/seances/pipeline-service';
import { seancePipelinePersistSchema } from '@/lib/schemas/seance-pipeline';

/**
 * Réunion hub (séances) J4 — local content pipeline PERSIST endpoint.
 *
 * EXACT carbon of `app/api/admin/verification-batch/persist/route.ts` (4
 * fail-fast layers: token → body size cap → JSON parse → Zod strict), then
 * `persistSeancePipelineResults` runs the internal gates (declared → done →
 * Règle n°1 re-validation → idempotent snapshot write, admin fields untouched).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 8 MiB cap — a held-session snapshot is text-only JSON (≤2 sessions/run, each
 *  ≈6 multi-paragraph readings + 6 messages + a summary) and stays well under
 *  1 MiB; the cap is pure defence against a runaway body. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  const guard = requireSeancesAdminToken(req);
  if (guard) return guard;

  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          error: 'payload_too_large',
          message: `Body declares ${declared} bytes, max ${MAX_BODY_BYTES}.`,
        },
        { status: 413 },
      );
    }
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch (err) {
    reportWarning('seance.batch.persist', 'body_read_failed', {
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return NextResponse.json(
      { error: 'body_read_failed', message: 'Could not read request body.' },
      { status: 400 },
    );
  }

  const actualBytes = Buffer.byteLength(bodyText, 'utf8');
  if (actualBytes > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        error: 'payload_too_large',
        message: `Body is ${actualBytes} bytes, max ${MAX_BODY_BYTES}.`,
      },
      { status: 413 },
    );
  }

  if (bodyText.length === 0) {
    return NextResponse.json(
      { error: 'empty_body', message: 'Request body is empty.' },
      { status: 400 },
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch (err) {
    reportWarning('seance.batch.persist', 'invalid_json', {
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = seancePipelinePersistSchema.safeParse(bodyJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join('.').slice(0, 100),
      code: issue.code,
      message: issue.message.slice(0, 100),
    }));
    return NextResponse.json(
      { error: 'validation_failed', issuesCount: parsed.error.issues.length, issues },
      { status: 400 },
    );
  }

  try {
    const result = await persistSeancePipelineResults(parsed.data);
    return NextResponse.json(
      { ok: true, ...result, total: parsed.data.sessions.length },
      { status: 200 },
    );
  } catch (err) {
    reportError(
      'seance.batch.persist',
      err instanceof Error ? err : new Error('seance_persist_unknown'),
    );
    return NextResponse.json({ error: 'batch_persist_failed' }, { status: 500 });
  }
}

/** GET → 405. Only POST allowed. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
