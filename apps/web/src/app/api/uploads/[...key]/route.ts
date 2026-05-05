import { Readable } from 'node:stream';

import { auth } from '@/auth';
import { keyBelongsTo, openLocalReadStream } from '@/lib/storage/local';
import { selectStorage, StorageError } from '@/lib/storage';

/**
 * GET /api/uploads/[...key]
 *
 * Serve a screenshot (J2). Streaming endpoint backed by the local storage
 * adapter in dev / pre-R2; in prod (when R2 is wired) this same path will
 * 302-redirect to the CDN.
 *
 * Auth gates:
 *   1. Authenticated session.
 *   2. Either:
 *      - the requesting user owns the key (the `userId` segment matches
 *        their session id), OR
 *      - the requesting user has role=admin (admins need to view annotated
 *        trades for any member, SPEC §7.7).
 *
 * Caching:
 *   - `Cache-Control: private, max-age=86400, immutable` because keys are
 *     content-addressable (the nanoid never reuses), but we keep the cache
 *     scoped to the user via `private` to avoid leaks behind shared proxies.
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

  const isAdmin = session.user.role === 'admin';
  if (!isAdmin && !keyBelongsTo(key, session.user.id)) {
    return new Response('Forbidden', { status: 403 });
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
