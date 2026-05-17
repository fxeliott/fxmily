/**
 * Storage abstraction for screenshot uploads (J2, SPEC §7.3 + §6.2).
 *
 * The journal of trading needs to attach screenshots to each trade. SPEC §4
 * targets Cloudflare R2 (free tier 10 GB, no egress fees). At J2 the R2
 * keys aren't yet provisioned, so we ship a local-filesystem adapter and
 * design the interface so the prod swap is a 1-line config change.
 *
 * Design choices:
 *   - **Direct upload through the Next.js server**, not presigned URLs from
 *     the browser. Reasons:
 *       - Server-side validation (auth, mime/magic bytes, size) is mandatory
 *         and presigned URLs make it harder to enforce uniformly.
 *       - V1 scale (~30 members) easily fits within the request lifetime.
 *       - When we DO scale, we add a `getPresignedUrl` method without
 *         breaking the call sites.
 *   - **Storage keys are server-issued** with `nanoid(32)`. Clients never
 *     pick filenames.
 *   - **Reads go through `/api/uploads/[...key]`** which streams local files
 *     in dev; in prod the GET handler will redirect to the R2 CDN.
 */

export type ScreenshotKind = 'trade-entry' | 'trade-exit';

/** Subset of `UploadKind` that lives under the `trades/{userId}/...` prefix. */
export const TRADE_UPLOAD_KINDS = ['trade-entry', 'trade-exit'] as const;

/**
 * J4 — admin annotations attach images (or videos in J4.5) to a trade. They
 * live under `annotations/{tradeId}/...` so ownership checks can read the
 * trade owner via a single Prisma lookup.
 */
export const ANNOTATION_UPLOAD_KINDS = ['annotation-image'] as const;

/**
 * V1.2 Mode Entraînement (SPEC §21) — backtest analysis screenshot. Lives
 * under `training/{userId}/…` (member-owned, exactly like a trade screenshot:
 * the backtest row doesn't exist yet at upload time). STATISTICAL ISOLATION
 * (§21.5): a distinct kind so the audit slug + storage prefix never collide
 * with the real-edge `trade-*` surface.
 */
export const TRAINING_UPLOAD_KINDS = ['training-entry'] as const;
export type TrainingUploadKind = (typeof TRAINING_UPLOAD_KINDS)[number];

export const ALL_UPLOAD_KINDS = [
  ...TRADE_UPLOAD_KINDS,
  ...ANNOTATION_UPLOAD_KINDS,
  ...TRAINING_UPLOAD_KINDS,
] as const;
export type UploadKind = (typeof ALL_UPLOAD_KINDS)[number];

export function isTradeUploadKind(kind: UploadKind): kind is ScreenshotKind {
  return (TRADE_UPLOAD_KINDS as readonly UploadKind[]).includes(kind);
}

export function isAnnotationUploadKind(
  kind: UploadKind,
): kind is (typeof ANNOTATION_UPLOAD_KINDS)[number] {
  return (ANNOTATION_UPLOAD_KINDS as readonly UploadKind[]).includes(kind);
}

export function isTrainingUploadKind(kind: UploadKind): kind is TrainingUploadKind {
  return (TRAINING_UPLOAD_KINDS as readonly UploadKind[]).includes(kind);
}

export interface UploadInput {
  /**
   * Drives both the storage prefix and the audit metadata. Trade kinds live
   * under `trades/{userId}/…`, annotation kinds under `annotations/{tradeId}/…`.
   */
  kind: UploadKind;
  /**
   * Path-owner segment baked into the storage key. For trade kinds this is
   * the authenticated user's id (CUID). For annotation kinds this is the
   * parent trade id (also a CUID).
   *
   * The route handler is responsible for choosing the right value; this type
   * stays generic so the adapter contract doesn't need to know about admins
   * vs members.
   */
  pathOwner: string;
  /** Already-validated MIME type. Must be one of `ALLOWED_IMAGE_MIME_TYPES`. */
  contentType: string;
  /** Buffer holding the file bytes. Already validated for size and magic bytes. */
  bytes: Uint8Array;
  /** Original filename — used for extension only; never persisted. */
  originalFilename?: string | undefined;
}

export interface StorageAdapter {
  /**
   * Persist the file under a fresh server-issued key. Returns the canonical
   * key (`trades/{userId}/{nanoid32}.{ext}`) plus a signed URL the UI can use
   * to render the image right away (read-only, short-lived in prod).
   */
  put(input: UploadInput): Promise<{ key: string; readUrl: string }>;

  /**
   * Build a URL the browser can use to GET the bytes. In dev this is a
   * route-handler URL backed by the FS; in prod it's a CDN redirect. The
   * URL may or may not embed a signature — implementations document.
   */
  getReadUrl(key: string): string;

  /**
   * Best-effort delete. We never block a user-facing flow on a delete error;
   * orphaned files are swept by a janitor cron later (J10).
   */
  delete(key: string): Promise<void>;

  /**
   * Identify the implementation in logs / health checks.
   */
  readonly id: 'local' | 'r2';
}

/** Allowlisted image MIME types accepted at the upload boundary. */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** Hard cap on a single screenshot. 8 MiB covers high-DPI captures comfortably. */
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_mime'
      | 'too_large'
      | 'invalid_bytes'
      | 'invalid_key'
      | 'not_found'
      | 'forbidden'
      | 'internal',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
