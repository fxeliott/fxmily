import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { env } from '@/lib/env';

import { generateKeyForUpload, parseStorageKey } from './keys';
import {
  type AllowedImageMime,
  type StorageAdapter,
  type UploadInput,
  StorageError,
} from './types';

/**
 * Cloudflare R2 storage adapter (J1 — offsite media redundancy, ADR-006).
 *
 * S3-compatible client against the account-scoped R2 endpoint. In production
 * this adapter is NOT selected directly: `selectStorage()` wraps the local
 * adapter + these helpers in `DualWriteStorageAdapter` (`./dual`) so the
 * local volume stays the PRIMARY store and R2 is the offsite MIRROR.
 *
 * Objects are private — R2 has no public ACLs, and the bucket must not be
 * exposed through a public custom domain unless `R2_PUBLIC_URL` is
 * deliberately configured behind an access policy (not used in V1). Reads
 * flow through the auth-gated `/api/uploads/[...key]` route, which falls
 * back to `openR2ReadStream` when the local file is missing.
 */

let client: S3Client | null = null;

/**
 * Transport hardening: a GET-route fallback read must never hang a member
 * request behind a wedged TCP connection, and a mirror write must not stall
 * an upload past what `dual.ts` can absorb. Fail fast, let the SDK retry
 * (default exponential backoff), then surface a StorageError. Exported so
 * tests can pin the values against silent drift.
 */
export const R2_MAX_ATTEMPTS = 3;
export const R2_CONNECTION_TIMEOUT_MS = 5_000;
export const R2_REQUEST_TIMEOUT_MS = 30_000;

function requireR2Env(name: string, value: string | undefined): string {
  if (!value) {
    // selectStorage() only takes the R2 path when all four R2_* vars are set,
    // so this is a defensive belt for direct imports and tests.
    throw new StorageError(`${name} is not configured`, 'internal');
  }
  return value;
}

function getR2Client(): S3Client {
  if (client) return client;
  const accountId = requireR2Env('R2_ACCOUNT_ID', env.R2_ACCOUNT_ID);
  client = new S3Client({
    region: 'auto',
    // R2_ENDPOINT overrides for dev/test (MinIO); prod derives the canonical
    // account-scoped endpoint from R2_ACCOUNT_ID.
    endpoint: env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireR2Env('R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID),
      secretAccessKey: requireR2Env('R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY),
    },
    // Path-style keeps a single code path across R2 and MinIO.
    forcePathStyle: true,
    maxAttempts: R2_MAX_ATTEMPTS,
    // Shorthand requestHandler config (AWS SDK v3.521+) — no NodeHttpHandler
    // import needed, and it survives SDK-internal handler swaps.
    requestHandler: {
      connectionTimeout: R2_CONNECTION_TIMEOUT_MS,
      requestTimeout: R2_REQUEST_TIMEOUT_MS,
    },
  });
  return client;
}

function r2Bucket(): string {
  return requireR2Env('R2_BUCKET', env.R2_BUCKET);
}

/** Test hook — drop the cached client so per-test env mutations take effect. */
export function resetR2ClientForTests(): void {
  client = null;
}

function isNotFoundError(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = err instanceof Error ? err.name : '';
  return name === 'NoSuchKey' || name === 'NotFound';
}

function toInternalError(operation: string, err: unknown): StorageError {
  return new StorageError(
    `r2 ${operation} failed: ${err instanceof Error ? err.message : String(err)}`,
    'internal',
  );
}

/**
 * Low-level PUT used both by `R2StorageAdapter.put` (fresh key) and by the
 * dual-write mirror (SAME key as the local write — the two stores must never
 * diverge on key shapes). Validates the key before sending: a malformed key
 * must never reach the bucket.
 */
export async function putObjectToR2(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  parseStorageKey(key);
  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: r2Bucket(),
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // Content-addressed nanoid keys — cacheable forever, but PRIVATE
        // (bytes only ever transit through the auth-gated route).
        CacheControl: 'private, max-age=31536000, immutable',
      }),
    );
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw toInternalError('put', err);
  }
}

/** Low-level DELETE used by the dual-write mirror. Idempotent (S3 semantics). */
export async function deleteObjectFromR2(key: string): Promise<void> {
  parseStorageKey(key);
  try {
    await getR2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }));
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw toInternalError('delete', err);
  }
}

/**
 * HEAD an R2 object — existence + metadata without transferring the body.
 * Ops primitive for mirror-drift checks and admin tooling: answers "is the
 * offsite copy of this key present, and how big is it" for the cost of a
 * single metadata round-trip. Throws `StorageError('not_found')` on a missing
 * object (S3 HEAD reports 404 as `NotFound`, covered by `isNotFoundError`);
 * `size`/`contentType` are null when R2 omits the header.
 */
export async function headObjectFromR2(
  key: string,
): Promise<{ size: number | null; contentType: string | null }> {
  parseStorageKey(key);
  let response;
  try {
    response = await getR2Client().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }));
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new StorageError('file not found in R2', 'not_found');
    }
    throw toInternalError('head', err);
  }
  return {
    size: typeof response.ContentLength === 'number' ? response.ContentLength : null,
    contentType: typeof response.ContentType === 'string' ? response.ContentType : null,
  };
}

/**
 * Open a web ReadableStream on an R2 object. Used by the GET route handlers
 * as the FALLBACK when the local file is missing (volume lost or pruned).
 * Throws `StorageError('not_found')` on a missing object. `size` is null
 * when R2 omits Content-Length — the route then streams without the header.
 */
export async function openR2ReadStream(
  key: string,
): Promise<{ stream: ReadableStream; size: number | null; ext: 'jpg' | 'png' | 'webp' }> {
  const parsed = parseStorageKey(key);
  let response;
  try {
    response = await getR2Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }));
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new StorageError('file not found in R2', 'not_found');
    }
    throw toInternalError('get', err);
  }
  if (!response.Body) {
    throw new StorageError('r2 object has no body', 'internal');
  }
  return {
    stream: response.Body.transformToWebStream() as unknown as ReadableStream,
    size: typeof response.ContentLength === 'number' ? response.ContentLength : null,
    ext: parsed.ext,
  };
}

export class R2StorageAdapter implements StorageAdapter {
  readonly id = 'r2';

  async put(input: UploadInput): Promise<{ key: string; readUrl: string }> {
    const mime = input.contentType as AllowedImageMime;
    const key = generateKeyForUpload(input.kind, input.pathOwner, mime);
    await putObjectToR2(key, input.bytes, input.contentType);
    return { key, readUrl: this.getReadUrl(key) };
  }

  getReadUrl(key: string): string {
    // Validate before exposing (mirror of the local adapter contract).
    parseStorageKey(key);
    if (env.R2_PUBLIC_URL) {
      // Opt-in escape hatch: custom domain behind an access policy (not V1).
      return `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
    }
    // Default: the auth-gated route, which reads local-first then falls back
    // to R2 — auth + per-prefix ownership stay enforced on every read.
    return `/api/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    await deleteObjectFromR2(key);
  }
}
