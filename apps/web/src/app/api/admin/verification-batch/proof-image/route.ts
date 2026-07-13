import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { reportError } from '@/lib/observability';
import { requireVerificationAdminToken } from '@/lib/auth/admin-token';
import { openLocalReadStream } from '@/lib/storage/local';
import { isR2Configured, openR2ReadStream, StorageError } from '@/lib/storage';

/**
 * S3 §33.4 — token-gated proof-image download for the local vision script.
 *
 * `GET /api/admin/verification-batch/proof-image?proofId=…`
 *
 * The pull envelope carries proof METADATA only; the orchestrator downloads
 * each image here (one curl per pending proof, sequential) and hands the
 * local file to `claude --print --allowedTools Read`. Token-gated with the
 * same `X-Admin-Token` as pull/persist (the session-cookie route
 * `/api/uploads/[...key]` can't serve a headless curl).
 *
 * Streaming mirror of `app/api/uploads/[...key]/route.ts`: local disk is the
 * PRIMARY store; when the file is missing locally and the R2 mirror is
 * configured, the offsite copy serves the bytes (J1, ADR-006 — same contract).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXT_MIME: Record<'jpg' | 'png' | 'webp', string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(req: Request): Promise<Response> {
  const guard = requireVerificationAdminToken(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const proofId = url.searchParams.get('proofId');
  if (!proofId || !/^[a-z0-9]{8,40}$/.test(proofId)) {
    return NextResponse.json({ error: 'invalid_proof_id' }, { status: 400 });
  }

  // Blast-radius scoping (security audit T2-2): the vision token only ever
  // needs images the PULL can list — proofs of ACTIVE members. A stolen token
  // must not page through soft-deleted members' history.
  const proof = await db.mt5AccountProof.findFirst({
    where: { id: proofId, member: { status: 'active' } },
    select: { fileKey: true, filePurgedAt: true },
  });
  if (!proof) {
    return NextResponse.json({ error: 'proof_not_found' }, { status: 404 });
  }
  // Tour 13 — a proof whose screen was purged after analysis has no bytes to
  // serve. 410 Gone (not 404) tells the caller the image intentionally no
  // longer exists — the verification screen was « traité à la volée, jamais
  // conservé ». A terminal proof is never re-pulled, so this path is only hit
  // by a stale/retried download.
  if (proof.filePurgedAt !== null) {
    return NextResponse.json({ error: 'proof_purged' }, { status: 410 });
  }

  try {
    const { stream, size, ext } = await openLocalReadStream(proof.fileKey);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    return imageResponse(webStream, ext, size);
  } catch (err) {
    if (err instanceof StorageError) {
      if (err.code === 'invalid_key')
        return NextResponse.json({ error: 'bad_key' }, { status: 400 });
      if (err.code === 'not_found') {
        // J1 (ADR-006) — the local volume is the PRIMARY store; when the file
        // is missing locally (volume lost, host migration) and the R2 mirror
        // is configured, serve the offsite copy before giving up.
        if (isR2Configured()) return serveFromR2(proof.fileKey);
        return NextResponse.json({ error: 'file_missing' }, { status: 404 });
      }
    }
    reportError('verification.proof_image', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

function imageResponse(
  body: ReadableStream,
  ext: keyof typeof EXT_MIME,
  size: number | null,
): Response {
  const headers: Record<string, string> = {
    'Content-Type': EXT_MIME[ext],
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  };
  // R2 may omit Content-Length — stream without the header rather than lie.
  if (size !== null) headers['Content-Length'] = String(size);
  return new Response(body, { status: 200, headers });
}

/** R2 fallback read — `openR2ReadStream` already yields a web stream. */
async function serveFromR2(key: string): Promise<Response> {
  try {
    const { stream, size, ext } = await openR2ReadStream(key);
    return imageResponse(stream, ext, size);
  } catch (err) {
    if (err instanceof StorageError && err.code === 'not_found') {
      return NextResponse.json({ error: 'file_missing' }, { status: 404 });
    }
    // A failing R2 fallback means the proof is gone from BOTH stores or the
    // mirror transport is broken — page-worthy, not a console-only event.
    reportError('verification.proof_image.r2_fallback', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

/** POST → 405. Only GET allowed on the image download. */
export async function POST(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
