import 'server-only';

import { env } from '@/lib/env';

import { LocalStorageAdapter } from './local';
import { R2StorageAdapter } from './r2';
import type { StorageAdapter } from './types';

/**
 * Storage adapter selection (J2).
 *
 * The selection is deterministic and synchronous — same process, same adapter
 * for the lifetime of the runtime. We pick R2 if and only if all four R2 env
 * vars are set; otherwise we fall back to the local-filesystem adapter.
 *
 * Note: at J2 the R2 implementation is a stub that throws on every call.
 * Until Eliot provisions the keys, the selection will always resolve to
 * local. This is intentional — see `lib/storage/r2.ts` for the migration
 * checklist.
 */

let cached: StorageAdapter | null = null;

function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  );
}

export function selectStorage(): StorageAdapter {
  if (cached) return cached;
  cached = isR2Configured() ? new R2StorageAdapter() : new LocalStorageAdapter();
  return cached;
}

export type { StorageAdapter, ScreenshotKind, UploadInput } from './types';
export { ALLOWED_IMAGE_MIME_TYPES, MAX_SCREENSHOT_BYTES, StorageError } from './types';
export { generateTradeKey, parseTradeKey, sniffImageMime } from './keys';
export { keyBelongsTo, openLocalReadStream } from './local';
