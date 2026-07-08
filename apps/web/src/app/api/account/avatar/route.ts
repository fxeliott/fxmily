import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { uploadLimiter } from '@/lib/rate-limit/token-bucket';
import { MAX_AVATAR_BYTES, selectStorage } from '@/lib/storage';
import { isHeic, normalizeAvatarImage, sniffProofInputFormat } from '@/lib/uploads/normalize-image';

/**
 * POST /api/account/avatar   — set/replace the member's profile photo.
 * DELETE /api/account/avatar — remove it (back to initials fallback).
 *
 * A member owns exactly ONE avatar (`avatars/{userId}/{nanoid}.webp`), read
 * cross-member by the leaderboard (`/api/uploads/[...key]` gates on active
 * session only). The photo is member-controlled from Settings AND during
 * onboarding. Firewall-neutral — a profile photo carries no trading data.
 *
 * Validation pipeline (POST), layered like `/api/uploads` (mt5-proof):
 *   1. Auth + status active.
 *   2. Per-member rate-limit BEFORE buffering the body.
 *   3. multipart `file` presence + raw size cap (`MAX_AVATAR_BYTES`).
 *   4. Magic-byte sniff (JPEG/PNG/WebP/GIF/AVIF) + dedicated HEIC rejection.
 *   5. Normalise to a canonical square WebP (`normalizeAvatarImage`).
 *   6. Storage `put()` → new key; persist `user.avatarKey`; best-effort delete
 *      of the PREVIOUS file. The DB row is the source of truth.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  // Rate-limit BEFORE buffering the (up to MAX_AVATAR_BYTES) body.
  const decision = uploadLimiter.consume(userId);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      {
        error: 'too_large',
        limit: MAX_AVATAR_BYTES,
        message: 'Photo trop lourde (8 Mo max). Choisis une image plus légère.',
      },
      { status: 413 },
    );
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());

  // HEIC first with an actionable message: the prebuilt libvips can't decode it.
  if (isHeic(rawBytes)) {
    return NextResponse.json(
      {
        error: 'heic_unsupported',
        message:
          'Format HEIC non pris en charge. Sur iPhone : Réglages > Appareil photo > Formats > Le plus compatible, ou exporte en JPEG.',
      },
      { status: 415 },
    );
  }

  const inputFormat = sniffProofInputFormat(rawBytes);
  if (inputFormat === null) {
    return NextResponse.json(
      {
        error: 'invalid_bytes',
        message: "Ce fichier n'est pas une image lisible. Utilise un JPG, PNG, WebP, GIF ou AVIF.",
      },
      { status: 415 },
    );
  }

  const normalized = await normalizeAvatarImage(rawBytes);
  if (!normalized.ok) {
    return NextResponse.json(
      {
        error: normalized.reason === 'heic_unsupported' ? 'heic_unsupported' : 'invalid_bytes',
        message:
          normalized.reason === 'heic_unsupported'
            ? 'Format HEIC non pris en charge. Exporte ta photo en JPEG.'
            : 'Cette image est illisible. Reprends la photo puis renvoie-la.',
      },
      { status: 415 },
    );
  }
  const bytes = new Uint8Array(normalized.buffer);

  // The previous avatar key (if any) — deleted AFTER the new one is persisted.
  const before = await db.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
  const previousKey = before?.avatarKey ?? null;

  const storage = selectStorage();
  let key: string;
  let readUrl: string;
  try {
    const result = await storage.put({
      kind: 'avatar-image',
      pathOwner: userId,
      contentType: normalized.mime,
      bytes,
      originalFilename: file.name,
    });
    key = result.key;
    readUrl = result.readUrl;
  } catch (err) {
    console.error('[account.avatar] storage.put failed', err);
    return NextResponse.json({ error: 'storage_failed' }, { status: 500 });
  }

  try {
    await db.user.update({ where: { id: userId }, data: { avatarKey: key } });
  } catch (err) {
    // Roll back the just-stored file so we never orphan on a failed persist.
    await storage.delete(key).catch(() => undefined);
    console.error('[account.avatar] user.update failed', err);
    return NextResponse.json({ error: 'storage_failed' }, { status: 500 });
  }

  // Best-effort cleanup of the replaced file (never blocks the response).
  if (previousKey && previousKey !== key) {
    await storage.delete(previousKey).catch(() => undefined);
  }

  await logAudit({
    action: 'account.avatar.updated',
    userId,
    metadata: { key, inputFormat, mime: normalized.mime, size: bytes.length, adapter: storage.id },
  });

  return NextResponse.json({ key, readUrl }, { status: 201 });
}

export async function DELETE(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const before = await db.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
  const previousKey = before?.avatarKey ?? null;

  if (!previousKey) {
    // Idempotent — nothing to remove.
    return NextResponse.json({ ok: true, removed: false }, { status: 200 });
  }

  await db.user.update({ where: { id: userId }, data: { avatarKey: null } });
  await selectStorage()
    .delete(previousKey)
    .catch(() => undefined);

  await logAudit({ action: 'account.avatar.removed', userId, metadata: { key: previousKey } });

  return NextResponse.json({ ok: true, removed: true }, { status: 200 });
}
