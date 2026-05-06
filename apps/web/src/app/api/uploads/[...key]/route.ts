import { Readable } from 'node:stream';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { openLocalReadStream } from '@/lib/storage/local';
import { selectStorage, StorageError, parseStorageKey } from '@/lib/storage';

/**
 * GET /api/uploads/[...key]
 *
 * Serve a stored asset (J2 trade screenshots, J4 annotation media). Streaming
 * endpoint backed by the local storage adapter in dev / pre-R2; in prod
 * (when R2 is wired) this same path will 302-redirect to the CDN.
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
  } else {
    // annotation key — lookup the parent trade owner.
    const trade = await db.trade.findUnique({
      where: { id: parsed.tradeId },
      select: { userId: true },
    });
    if (!trade) {
      return new Response('Not found', { status: 404 });
    }
    if (!isAdmin && trade.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const storage = selectStorage();
  if (storage.id !== 'local') {
    // R2 path: 302-redirect to the CDN (or to a presigned URL). Stub for J2.
    return new Response('R2 read path not wired yet.', { status: 501 });
  }

  try {
    const { stream, size, ext } = await openLocalReadStream(key);
    // Convert node Readable → web ReadableStream so Next.js can fetch-stream it.
    // Node 22 ships `Readable.toWeb()`; the cast bypasses a Web/Node type
    // overlap inconsistency without affecting the runtime contract.
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': EXT_MIME[ext],
        'Content-Length': String(size),
        'Cache-Control': 'private, max-age=86400, immutable',
        'Content-Security-Policy': "default-src 'none'", // sandbox image bytes
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof StorageError) {
      if (err.code === 'invalid_key') return new Response('Bad request', { status: 400 });
      if (err.code === 'not_found') return new Response('Not found', { status: 404 });
    }
    console.error('[uploads.GET] failed', err);
    return new Response('Internal error', { status: 500 });
  }
}
