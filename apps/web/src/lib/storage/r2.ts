import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
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
