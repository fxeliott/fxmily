import { Readable } from 'node:stream';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { reportError } from '@/lib/observability';
import { openLocalReadStream } from '@/lib/storage/local';
import { isR2Configured, openR2ReadStream, StorageError, parseStorageKey } from '@/lib/storage';

/**
 * GET /api/uploads/[...key]
 *
 * Serve a stored asset (J2 trade screenshots, J4 annotation media). Streaming
 * endpoint backed by the local disk (PRIMARY store); when the file is missing
 * locally and R2 is configured, falls back to the offsite mirror (J1, ADR-006).
 *
 * Auth gates:
 *   1. Authenticated session, status='active'.
 *   2. Per-prefix ownership check:
 *      - `trades/{userId}/...` — userId must match the session, OR the
 *        requester is admin (admins read members' screenshots to annotate).
 *      - `annotations/{tradeId}/...` — the trade row must belong to the
 *        session user, OR the requester is admin.
 *
 * Caching:
 *   - `Cache-Control: private, max-age=86400, immutable` — the nanoid keys
 *     are content-addressable; we keep the cache scoped to the user via
 *     `private` to avoid leaks behind shared proxies.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXT_MIME: Record<'jpg' | 'png' | 'webp', string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

interface RouteContext {
  params: Promise<{ key: string[] }>;
}

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (session.user.status !== 'active') {
    return new Response('Unauthorized', { status: 401 });
  }

  const { key: segments } = await params;
  const key = segments.join('/');

  let parsed;
  try {
    parsed = parseStorageKey(key);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const isAdmin = session.user.role === 'admin';

  // Per-prefix ownership check.
  if (parsed.kind === 'trade') {
    if (!isAdmin && parsed.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }
  } else if (parsed.kind === 'training') {
    // Mode Entraînement (SPEC §21) — `training/{userId}/...`, member-owned
    // exactly like a trade screenshot. Admin may also read (J-T3 needs it
    // to annotate a member's backtest). STATISTICAL ISOLATION: this branch
    // only touches the training key's own userId — no real-edge lookup.
    if (!isAdmin && parsed.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }
  } else if (parsed.kind === 'proof') {
    // S3 — `proofs/{userId}/...`, member-owned exactly like a trade
    // screenshot. Admin may also read (the verification tab confronts the
    // declared journal with the proof image).
    if (!isAdmin && parsed.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }
  } else if (parsed.kind === 'training_annotation') {
    // J-T3 admin correction media — `training_annotations/{trainingTradeId}/`.
    // Mirror of the J4 annotation branch but through `TrainingTrade` (NEVER
    // `Trade` — statistical isolation §21.5). Admin always allowed; the
    // member allowed iff they own the parent backtest. Absent + not-owner
    // collapse to a single Forbidden (no existence oracle), same as J4.
    const trainingTrade = await db.trainingTrade.findUnique({
      where: { id: parsed.trainingTradeId },
      select: { userId: true },
    });
    if (!trainingTrade || (!isAdmin && trainingTrade.userId !== session.user.id)) {
      return new Response('Forbidden', { status: 403 });
    }
  } else if (parsed.kind === 'avatar') {
    // Leaderboard/profile — `avatars/{userId}/...`. DELIBERATELY cross-member:
    // any authenticated ACTIVE member (already gated above) may read ANY
    // member's avatar so the leaderboard can render every face. A profile photo
    // is not private data — the active session IS the gate, there is no
    // per-owner check. No trade lookup, no P&L, firewall-neutral.
  } else {
    // annotation key — lookup the parent trade owner. We collapse the
    // "trade absent" and "trade present but not owner" branches into a
    // single Forbidden so a member can't oracle whether a given tradeId
    // exists by probing /api/uploads/annotations/<id>/<random>.jpg.
    const trade = await db.trade.findUnique({
      where: { id: parsed.tradeId },
      select: { userId: true },
    });
    if (!trade || (!isAdmin && trade.userId !== session.user.id)) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  try {
    const { stream, size, ext } = await openLocalReadStream(key);
    // Convert node Readable → web ReadableStream so Next.js can fetch-stream it.
    // Node 22 ships `Readable.toWeb()`; the cast bypasses a Web/Node type
    // overlap inconsistency without affecting the runtime contract.
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    return imageResponse(webStream, ext, size);
  } catch (err) {
    if (err instanceof StorageError) {
      if (err.code === 'invalid_key') return new Response('Bad request', { status: 400 });
      if (err.code === 'not_found') {
        // J1 (ADR-006) — the local volume is the PRIMARY store; when the file
        // is missing locally (volume lost, host migration) and the R2 mirror
        // is configured, serve the offsite copy before giving up.
        if (isR2Configured()) return serveFromR2(key);
        return new Response('Not found', { status: 404 });
      }
    }
    reportError('uploads.get', err);
    return new Response('Internal error', { status: 500 });
  }
}

function imageResponse(
  body: ReadableStream,
  ext: keyof typeof EXT_MIME,
  size: number | null,
): Response {
  const headers: Record<string, string> = {
    'Content-Type': EXT_MIME[ext],
    'Cache-Control': 'private, max-age=86400, immutable',
    'Content-Security-Policy': "default-src 'none'", // sandbox image bytes
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
      return new Response('Not found', { status: 404 });
    }
    // A failing R2 fallback means the file is gone from BOTH stores or the
    // mirror transport is broken — page-worthy, not a console-only event.
    reportError('uploads.get.r2_fallback', err);
    return new Response('Internal error', { status: 500 });
  }
}
