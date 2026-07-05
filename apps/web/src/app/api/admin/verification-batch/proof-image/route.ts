import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireVerificationAdminToken } from '@/lib/auth/admin-token';
import { openLocalReadStream } from '@/lib/storage/local';
import { selectStorage, StorageError } from '@/lib/storage';

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
 * Streaming mirror of `app/api/uploads/[...key]/route.ts` (local adapter;
 * 501 if a future remote adapter lands without a read path — same contract).
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

  const storage = selectStorage();
  if (storage.id !== 'local') {
    return NextResponse.json({ error: 'remote_read_not_wired' }, { status: 501 });
  }

  try {
    const { stream, size, ext } = await openLocalReadStream(proof.fileKey);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': EXT_MIME[ext],
        'Content-Length': String(size),
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof StorageError) {
      if (err.code === 'invalid_key')
        return NextResponse.json({ error: 'bad_key' }, { status: 400 });
      if (err.code === 'not_found')
        return NextResponse.json({ error: 'file_missing' }, { status: 404 });
    }
    console.error('[verification.proof-image] failed', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

/** POST → 405. Only GET allowed on the image download. */
export async function POST(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
