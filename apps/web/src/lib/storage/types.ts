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

export interface UploadInput {
  /** Authenticated user — used to scope the storage key. */
  userId: string;
  /** What this screenshot represents. Trade entry vs exit. */
  kind: ScreenshotKind;
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
