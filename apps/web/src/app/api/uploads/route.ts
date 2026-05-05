import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { selectStorage } from '@/lib/storage';
import { isAllowedMime, sniffImageMime } from '@/lib/storage/keys';
import { MAX_SCREENSHOT_BYTES } from '@/lib/storage/types';

/**
 * POST /api/uploads
 *
 * Upload a screenshot for a trade (J2 — SPEC §7.3 "upload obligatoire").
 *
 * Request body: `multipart/form-data` with fields:
 *   - `file` (File, required) — image bytes (jpg/png/webp), ≤ 8 MiB.
 *   - `kind` (string, required) — 'trade-entry' | 'trade-exit'. Used in audit
 *     metadata only; the storage key isn't currently parameterised by kind.
 *
 * Response (200): `{ key: string, readUrl: string }`.
 *
 * Auth: any authenticated session (member or admin). Defense-in-depth: the
 * proxy already gates `/api/*` (except `/api/auth`), but we re-check here.
 *
 * Validation pipeline (defense layered):
 *   1. Auth.
 *   2. multipart parsed via `req.formData()`.
 *   3. `kind` enum check.
 *   4. File presence + size cap.
 *   5. `Content-Type` allowlist (via `isAllowedMime`).
 *   6. Magic-byte sniff against the allowlist — must match the declared MIME.
 *      Defeats `Content-Type` spoof + extension-rename attacks.
 *   7. Storage adapter `put()` — generates the canonical server-side key.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }

  const kind = formData.get('kind');
  if (kind !== 'trade-entry' && kind !== 'trade-exit') {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return NextResponse.json({ error: 'too_large', limit: MAX_SCREENSHOT_BYTES }, { status: 413 });
  }

  const declared = file.type;
  if (!isAllowedMime(declared)) {
    return NextResponse.json({ error: 'invalid_mime' }, { status: 415 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const detected = sniffImageMime(buffer);
  if (detected === null || detected !== declared) {
    return NextResponse.json({ error: 'invalid_bytes' }, { status: 415 });
  }

  const storage = selectStorage();
  let key: string;
  let readUrl: string;
  try {
    const result = await storage.put({
      userId,
      kind,
      contentType: declared,
      bytes: buffer,
      originalFilename: file.name,
    });
    key = result.key;
    readUrl = result.readUrl;
  } catch (err) {
    console.error('[uploads] storage.put failed', err);
    return NextResponse.json({ error: 'storage_failed' }, { status: 500 });
  }

  await logAudit({
    action: 'trade.screenshot.uploaded',
    userId,
    metadata: { kind, key, mime: declared, size: file.size, adapter: storage.id },
  });

  return NextResponse.json({ key, readUrl }, { status: 201 });
}
