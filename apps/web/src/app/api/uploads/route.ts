import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { logAudit, resolveUploadAuditAction } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { selectStorage } from '@/lib/storage';
import { isAllowedMime, sniffImageMime } from '@/lib/storage/keys';
import {
  ALL_UPLOAD_KINDS,
  MAX_SCREENSHOT_BYTES,
  isAnnotationUploadKind,
  isTradeUploadKind,
  isTrainingUploadKind,
  type UploadKind,
} from '@/lib/storage/types';

/**
 * POST /api/uploads
 *
 * Upload an image attached to a trade (J2) or to an admin annotation (J4).
 *
 * Request body: `multipart/form-data` with fields:
 *   - `file`    (File, required) — image bytes (jpg/png/webp), ≤ 8 MiB.
 *   - `kind`    (string, required) — one of `ALL_UPLOAD_KINDS`.
 *   - `tradeId` (string, required when `kind` is annotation-*) — CUID of the
 *     trade the annotation will attach to. Used to scope the storage path
 *     and to enforce admin ownership.
 *
 * Response (201): `{ key: string, readUrl: string }`.
 *
 * Auth gates:
 *   - any authenticated active session for trade-* kinds
 *   - role=admin for annotation-* kinds (defense in depth on top of the
 *     `/admin/*` proxy gate which doesn't cover `/api/uploads`)
 *
 * Validation pipeline (defense layered):
 *   1. Auth + status active.
 *   2. multipart parsed via `req.formData()`.
 *   3. `kind` allowlist check.
 *   4. Per-kind owner check (admin gate + tradeId existence).
 *   5. File presence + size cap.
 *   6. `Content-Type` allowlist (via `isAllowedMime`).
 *   7. Magic-byte sniff against the allowlist — must match the declared MIME.
 *      Defeats `Content-Type` spoof + extension-rename attacks.
 *   8. Storage adapter `put()` — generates the canonical server-side key.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === 'string' && (ALL_UPLOAD_KINDS as readonly string[]).includes(value);
}

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

  const kindRaw = formData.get('kind');
  if (!isUploadKind(kindRaw)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }
  const kind: UploadKind = kindRaw;

  // Resolve the path-owner segment per kind, applying the kind-specific
  // authorisation rule. Failing fast keeps malformed requests from reaching
  // the buffer/sniff pipeline.
  let pathOwner: string;
  if (isTradeUploadKind(kind)) {
    pathOwner = userId;
  } else if (isTrainingUploadKind(kind)) {
    // Mode Entraînement (SPEC §21) — member-owned, exactly like a trade
    // screenshot: the backtest row doesn't exist yet at upload time, so the
    // path-owner is the authenticated member. No admin gate, no DB lookup.
    pathOwner = userId;
  } else if (isAnnotationUploadKind(kind)) {
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const tradeIdRaw = formData.get('tradeId');
    if (typeof tradeIdRaw !== 'string' || !/^[a-z0-9]{8,40}$/.test(tradeIdRaw)) {
      return NextResponse.json({ error: 'invalid_trade_id' }, { status: 400 });
    }
    // Confirm the trade actually exists — we don't want orphan annotation
    // media when the admin typo'd the URL.
    const trade = await db.trade.findUnique({
      where: { id: tradeIdRaw },
      select: { id: true },
    });
    if (!trade) {
      return NextResponse.json({ error: 'trade_not_found' }, { status: 404 });
    }
    pathOwner = tradeIdRaw;
  } else {
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
      kind,
      pathOwner,
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
    // §21.5 isolation: backtest uploads emit their own slug — see
    // `resolveUploadAuditAction` (unit-tested guard).
    action: resolveUploadAuditAction(kind),
    userId,
    metadata: {
      kind,
      key,
      mime: declared,
      size: file.size,
      adapter: storage.id,
      ...(isAnnotationUploadKind(kind) ? { tradeId: pathOwner } : {}),
    },
  });

  return NextResponse.json({ key, readUrl }, { status: 201 });
}
