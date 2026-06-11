import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { logAudit, resolveUploadAuditAction } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { uploadLimiter } from '@/lib/rate-limit/token-bucket';
import { selectStorage } from '@/lib/storage';
import { isAllowedMime, sniffImageMime } from '@/lib/storage/keys';
import {
  ALL_UPLOAD_KINDS,
  MAX_SCREENSHOT_BYTES,
  isAnnotationUploadKind,
  isProofUploadKind,
  isTradeUploadKind,
  isTrainingAnnotationUploadKind,
  isTrainingUploadKind,
  type UploadKind,
} from '@/lib/storage/types';
import { PROOF_ACCOUNT_TYPES, type ProofAccountType } from '@/lib/schemas/verification';

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

  // Session 3 hardening — per-member rate-limit BEFORE buffering the (up to
  // 8 MiB) multipart body, so a throttled caller never costs memory/disk.
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
  if (!isUploadKind(kindRaw)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }
  const kind: UploadKind = kindRaw;

  // Resolve the path-owner segment per kind, applying the kind-specific
  // authorisation rule. Failing fast keeps malformed requests from reaching
  // the buffer/sniff pipeline.
  let pathOwner: string;
  // S3 — MT5 proof: the `Mt5AccountProof` row is created in THIS request so
  // the SHA-256 anti-double-upload hash is server-computed from the validated
  // bytes (a client-supplied hash would be forgeable). Optional links parsed
  // here, fail-fast before the buffer pipeline.
  let proofAccountId: string | null = null;
  let proofAccountType: ProofAccountType | null = null;
  if (isTradeUploadKind(kind)) {
    pathOwner = userId;
  } else if (isProofUploadKind(kind)) {
    // Member-owned, exactly like a trade screenshot. Optional `accountId`
    // attaches the proof to one of the member's broker accounts (ownership
    // enforced — BOLA); optional `accountType` records the declared type.
    pathOwner = userId;
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
  } else if (isTrainingUploadKind(kind)) {
    // Mode Entraînement (SPEC §21) — member-owned, exactly like a trade
    // screenshot: the backtest row doesn't exist yet at upload time, so the
    // path-owner is the authenticated member. No admin gate, no DB lookup.
    pathOwner = userId;
  } else if (isTrainingAnnotationUploadKind(kind)) {
    // J-T3 admin correction media — admin-only, parent-owned. Carbon mirror
    // of the annotation branch but through `TrainingTrade` (NEVER `Trade` —
    // statistical isolation §21.5). pathOwner = the parent trainingTradeId.
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const trainingTradeIdRaw = formData.get('trainingTradeId');
    if (typeof trainingTradeIdRaw !== 'string' || !/^[a-z0-9]{8,40}$/.test(trainingTradeIdRaw)) {
      return NextResponse.json({ error: 'invalid_training_trade_id' }, { status: 400 });
    }
    // Confirm the backtest exists — avoid orphan correction media on a typo'd
    // id. Existence-only here; the tighter member-ownership check lives in
    // the Server Action (defense in depth, mirrors the J4 annotation split).
    const trainingTrade = await db.trainingTrade.findUnique({
      where: { id: trainingTradeIdRaw },
      select: { id: true },
    });
    if (!trainingTrade) {
      return NextResponse.json({ error: 'training_trade_not_found' }, { status: 404 });
    }
    pathOwner = trainingTradeIdRaw;
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

  // S3 — anti-double-upload: the SHA-256 of the validated bytes is the
  // per-member dedup key (`@@unique([memberId, fileHash])`). Checked BEFORE
  // storing so a duplicate never costs disk; re-checked via P2002 after the
  // create (two concurrent uploads of the same bytes — race-safe).
  let proofFileHash: string | null = null;
  if (isProofUploadKind(kind)) {
    proofFileHash = createHash('sha256').update(buffer).digest('hex');
    const existing = await db.mt5AccountProof.findUnique({
      where: { memberId_fileHash: { memberId: userId, fileHash: proofFileHash } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: 'duplicate_proof', proofId: existing.id }, { status: 409 });
    }
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

  // S3 — create the proof row in the same request (server-derived hash).
  let proofId: string | null = null;
  if (isProofUploadKind(kind) && proofFileHash !== null) {
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
      // Best-effort cleanup of the just-stored file — the row is the source
      // of truth, an orphaned file is swept by the janitor path later.
      await storage.delete(key).catch(() => undefined);
      const isUniqueViolation =
        typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
      if (isUniqueViolation) {
        return NextResponse.json({ error: 'duplicate_proof' }, { status: 409 });
      }
      console.error('[uploads] proof row create failed', err);
      return NextResponse.json({ error: 'storage_failed' }, { status: 500 });
    }
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
      // §21.5 PII-free: only the parent id, never the member's backtest P&L.
      ...(isTrainingAnnotationUploadKind(kind) ? { trainingTradeId: pathOwner } : {}),
      // S3 PII-free: opaque ids only — never the account label/broker name.
      ...(isProofUploadKind(kind) ? { proofId, accountId: proofAccountId } : {}),
    },
  });

  return NextResponse.json(proofId !== null ? { key, readUrl, proofId } : { key, readUrl }, {
    status: 201,
  });
}
