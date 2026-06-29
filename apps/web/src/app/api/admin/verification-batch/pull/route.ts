import { NextResponse } from 'next/server';

import { requireVerificationAdminToken } from '@/lib/auth/admin-token';
import { loadPendingProofsEnvelope } from '@/lib/verification/batch';
import { reportError } from '@/lib/observability';

/**
 * S3 §33.4 — Verification vision batch PULL endpoint (5th local pipeline).
 *
 * Pattern carbone `app/api/admin/onboarding-batch/pull/route.ts`.
 *
 * Returns the pending-proofs envelope: metadata + system prompt + output
 * schema + user-prompt template. The proof IMAGES do NOT travel here — the
 * local script downloads each one via the token-gated
 * `GET /api/admin/verification-batch/proof-image?proofId=…` (bounded memory,
 * no multi-MiB base64 blobs in a JSON body).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const guard = requireVerificationAdminToken(req);
  if (guard) return guard;

  try {
    const envelope = await loadPendingProofsEnvelope();
    return NextResponse.json(envelope, { status: 200 });
  } catch (err) {
    reportError(
      'verification.batch.pull',
      err instanceof Error ? err : new Error('verification_pull_unknown'),
    );
    return NextResponse.json(
      {
        error: 'pull_failed',
      },
      { status: 500 },
    );
  }
}

/** GET → 405. Only POST allowed (mirror of the other batch pull routes). */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
