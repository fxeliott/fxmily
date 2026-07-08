import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { logAudit, resolveUploadAuditAction } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { uploadLimiter } from '@/lib/rate-limit/token-bucket';
import { selectStorage } from '@/lib/storage';
import { isProofUploadKind, type UploadKind } from '@/lib/storage/types';
import { isHeic, normalizeProofImage, sniffProofInputFormat } from '@/lib/uploads/normalize-image';
import { PROOF_ACCOUNT_TYPES, type ProofAccountType } from '@/lib/schemas/verification';

/**
 * POST /api/uploads
 *
 * Tour 13 — the ONLY accepted upload is `mt5-proof`. The verification screen
 * policy is « les images ne servent QU'À la vérification » : every other kind
 * (trade-entry/exit, training-entry, annotation-image, training-annotation-image)
 * is CLOSED and answers 410 with an FR message steering the member to a
 * TradingView link. The read side (`/api/uploads/[...key]`) still serves the
 * legacy trade/annotation/training files already on disk — closing the write
 * boundary here does not orphan what already exists.
 *
 * Request body: `multipart/form-data` with fields:
 *   - `file`        (File, required) — image bytes, ≤ 20 MiB raw input.
 *   - `kind`        (string, required) — must be `mt5-proof`.
 *   - `accountId`   (string, optional) — one of the member's broker accounts.
 *   - `accountType` (string, optional) — declared type (prop_firm | personal).
 *
 * Response (201): `{ key, readUrl, proofId }`.
 *
 * Validation pipeline for `mt5-proof` (defense layered):
 *   1. Auth + status active.
 *   2. Per-member rate-limit BEFORE buffering the body.
 *   3. multipart parsed via `req.formData()`.
 *   4. `kind` allowlist — only `mt5-proof` survives.
 *   5. Optional account link resolution (ownership enforced — BOLA).
 *   6. File presence + 20 MiB raw cap.
 *   7. Magic-byte sniff (JPEG/PNG/WebP/GIF/AVIF) + dedicated HEIC rejection.
 *   8. Normalisation to a canonical EXIF-oriented JPEG (`normalizeProofImage`).
 *   9. SHA-256 dedup computed on the NORMALISED bytes (see note below).
 *  10. Storage adapter `put()` with `image/jpeg` — the stored extension is .jpg.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Raw input cap for a proof upload: 20 MiB. A modern phone HEIC/large PNG can
 * exceed the 8 MiB storage cap (`MAX_SCREENSHOT_BYTES`) before normalisation;
 * we accept up to 20 MiB in, and `normalizeProofImage` re-encodes to a JPEG
 * that lands comfortably below the storage cap. Rejecting only past 20 MiB
 * keeps a legitimate high-DPI capture from being bounced for size.
 */
const MAX_PROOF_INPUT_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  // Session 3 hardening — per-member rate-limit BEFORE buffering the (up to
  // 20 MiB) multipart body, so a throttled caller never costs memory/disk.
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

  const kindRaw = formData.get('kind');
  // Tour 13 — screen policy: only the MT5 proof kind is open. Everything else
  // is intentionally closed (410 Gone), not merely rejected (400), so the
  // client learns the capability is retired, with an actionable FR message.
  if (typeof kindRaw !== 'string' || !isProofUploadKind(kindRaw as UploadKind)) {
    return NextResponse.json(
      {
        error: 'uploads_closed',
        message:
          'Les captures sont réservées à la vérification. Pour partager un trade, utilise un lien TradingView.',
      },
      { status: 410 },
    );
  }
  const kind: UploadKind = kindRaw as UploadKind;

  // Member-owned, exactly like a trade screenshot. Optional `accountId`
  // attaches the proof to one of the member's broker accounts (ownership
  // enforced — BOLA); optional `accountType` records the declared type.
  const pathOwner = userId;
  let proofAccountId: string | null = null;
  let proofAccountType: ProofAccountType | null = null;

  const accountIdRaw = formData.get('accountId');
  if (typeof accountIdRaw === 'string' && accountIdRaw.length > 0) {
    if (!/^[a-z0-9]{8,40}$/.test(accountIdRaw)) {
      return NextResponse.json({ error: 'invalid_account_id' }, { status: 400 });
    }
    const account = await db.brokerAccount.findUnique({
      where: { id: accountIdRaw },
      select: { memberId: true },
    });
    // Absent + not-owner collapse into one error (no existence oracle).
    if (!account || account.memberId !== userId) {
      return NextResponse.json({ error: 'invalid_account_id' }, { status: 400 });
    }
    proofAccountId = accountIdRaw;
  }
  const accountTypeRaw = formData.get('accountType');
  if (typeof accountTypeRaw === 'string' && accountTypeRaw.length > 0) {
    if (!(PROOF_ACCOUNT_TYPES as readonly string[]).includes(accountTypeRaw)) {
      return NextResponse.json({ error: 'invalid_account_type' }, { status: 400 });
    }
    proofAccountType = accountTypeRaw as ProofAccountType;
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }
  if (file.size > MAX_PROOF_INPUT_BYTES) {
    return NextResponse.json({ error: 'too_large', limit: MAX_PROOF_INPUT_BYTES }, { status: 413 });
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());

  // HEIC/HEIF is caught FIRST with a dedicated, actionable message: sharp's
  // prebuilt libvips cannot decode the patented HEVC payload, so without this
  // the member would get a generic "storage_failed" with no way to self-serve.
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

  // Accept only the formats we can decode. The label is coarse (the canonical
  // output is always JPEG) — used for the accept decision + the audit trail.
  const inputFormat = sniffProofInputFormat(rawBytes);
  if (inputFormat === null) {
    return NextResponse.json(
      {
        error: 'invalid_bytes',
        message:
          'Le fichier ne ressemble pas à une image lisible. Utilise une capture JPG, PNG, WebP, GIF ou AVIF.',
      },
      { status: 415 },
    );
  }

  // Normalise to a canonical EXIF-oriented, down-scaled JPEG BEFORE storage +
  // hashing. Everything downstream (dedup hash, stored file, vision read) sees
  // the SAME normalised bytes.
  const normalized = await normalizeProofImage(rawBytes);
  if (!normalized.ok) {
    if (normalized.reason === 'heic_unsupported') {
      // Defense in depth: a HEIC that slipped past the magic-byte check.
      return NextResponse.json(
        {
          error: 'heic_unsupported',
          message:
            'Format HEIC non pris en charge. Sur iPhone : Réglages > Appareil photo > Formats > Le plus compatible, ou exporte en JPEG.',
        },
        { status: 415 },
      );
    }
    return NextResponse.json(
      {
        error: 'invalid_bytes',
        message: 'Cette image est illisible. Reprends la capture puis renvoie-la.',
      },
      { status: 415 },
    );
  }
  const bytes = new Uint8Array(normalized.buffer);

  // S3 — anti-double-upload: the SHA-256 is computed on the NORMALISED bytes
  // (the canonical JPEG we actually store), NOT the raw upload. Two captures of
  // the same screen that differ only by EXIF/metadata or by a re-save collapse
  // to the SAME hash once normalised, so the `@@unique([memberId, fileHash])`
  // dedup catches them. Checked BEFORE storing so a duplicate never costs disk;
  // re-checked via P2002 after the create (race-safe).
  const proofFileHash = createHash('sha256').update(bytes).digest('hex');
  const existing = await db.mt5AccountProof.findUnique({
    where: { memberId_fileHash: { memberId: userId, fileHash: proofFileHash } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: 'duplicate_proof', proofId: existing.id }, { status: 409 });
  }

  const storage = selectStorage();
  let key: string;
  let readUrl: string;
  try {
    const result = await storage.put({
      kind,
      pathOwner,
      // The normalised output is always JPEG → the stored extension is .jpg.
      contentType: normalized.mime,
      bytes,
      originalFilename: file.name,
    });
    key = result.key;
    readUrl = result.readUrl;
  } catch (err) {
    console.error('[uploads] storage.put failed', err);
    // `stage` + `code` are safe observability fields (no message/PII, no server
    // paths) so a storage failure can be told apart from a DB failure without
    // server logs. The richer diagnostic (syscall/path/root/uid) that once
    // lived here was a TEMP root-causing aid — it leaked server topology to
    // any authenticated member and must NOT come back in the response body;
    // the console.error above already carries the full error server-side.
    const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : null;
    return NextResponse.json({ error: 'storage_failed', stage: 'put', code }, { status: 500 });
  }

  // S3 — create the proof row in the same request (server-derived hash).
  let proofId: string | null = null;
  try {
    const proof = await db.mt5AccountProof.create({
      data: {
        memberId: userId,
        brokerAccountId: proofAccountId,
        fileKey: key,
        fileHash: proofFileHash,
        accountType: proofAccountType,
      },
      select: { id: true },
    });
    proofId = proof.id;
  } catch (err) {
    // Best-effort cleanup of the just-stored file — the row is the source of
    // truth, an orphaned file is swept by the janitor path later.
    await storage.delete(key).catch(() => undefined);
    const isUniqueViolation =
      typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
    if (isUniqueViolation) {
      return NextResponse.json({ error: 'duplicate_proof' }, { status: 409 });
    }
    console.error('[uploads] proof row create failed', err);
    const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : null;
    return NextResponse.json({ error: 'storage_failed', stage: 'persist', code }, { status: 500 });
  }

  await logAudit({
    action: resolveUploadAuditAction(kind),
    userId,
    metadata: {
      kind,
      key,
      // The audit records the DETECTED input format (for observability of what
      // members shoot with) alongside the canonical stored MIME.
      inputFormat,
      mime: normalized.mime,
      size: bytes.length,
      adapter: storage.id,
      // S3 PII-free: opaque ids only — never the account label/broker name.
      proofId,
      accountId: proofAccountId,
    },
  });

  return NextResponse.json({ key, readUrl, proofId }, { status: 201 });
}
