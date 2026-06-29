import { NextResponse } from 'next/server';

import { requireVerificationAdminToken } from '@/lib/auth/admin-token';
import {
  persistVisionResults,
  type VerificationBatchPersistRequest,
  type VerificationBatchResultEntry,
} from '@/lib/verification/batch';
import { reportError, reportWarning } from '@/lib/observability';
import { verificationBatchPersistRequestSchema } from '@/lib/schemas/verification';

/**
 * S3 §33.4 — Verification vision batch PERSIST endpoint.
 *
 * EXACT carbon of `app/api/admin/onboarding-batch/persist/route.ts`
 * (4 fail-fast layers: token → body size cap → JSON parse → Zod strict),
 * then `persistVisionResults` runs the internal gates (active user → proof
 * ownership → idempotency → Zod re-parse → crisis → AMF → model pin →
 * account resolve + positions insert).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 16 MiB cap — mirror onboarding (vision results are text-only JSON; a
 *  25-proof run with 300 positions each stays well under 4 MiB). */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  const guard = requireVerificationAdminToken(req);
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
    reportWarning('verification.batch.persist', 'body_read_failed', {
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
    reportWarning('verification.batch.persist', 'invalid_json', {
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return NextResponse.json(
      {
        error: 'invalid_json',
      },
      { status: 400 },
    );
  }

  const parsed = verificationBatchPersistRequestSchema.safeParse(bodyJson);
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

  const request: VerificationBatchPersistRequest = {
    results: parsed.data.results as readonly VerificationBatchResultEntry[],
  };

  try {
    const result = await persistVisionResults(request);
    return NextResponse.json(
      { ok: true, ...result, total: parsed.data.results.length },
      { status: 200 },
    );
  } catch (err) {
    reportError(
      'verification.batch.persist',
      err instanceof Error ? err : new Error('verification_persist_unknown'),
    );
    return NextResponse.json(
      {
        error: 'batch_persist_failed',
      },
      { status: 500 },
    );
  }
}

/** GET → 405. Only POST allowed. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
