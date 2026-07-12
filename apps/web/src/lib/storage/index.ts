import 'server-only';

import { env } from '@/lib/env';

import { DualWriteStorageAdapter } from './dual';
import { LocalStorageAdapter } from './local';
import type { StorageAdapter } from './types';

/**
 * Storage adapter selection (J2, revised J1 offsite — ADR-006).
 *
 * The selection is deterministic and synchronous — same process, same adapter
 * for the lifetime of the runtime. When all four R2 env vars are set we pick
 * the DUAL-WRITE adapter (local disk primary + R2 offsite mirror); otherwise
 * we fall back to the local-filesystem adapter, byte-identical to pre-R2
 * behaviour. Pure R2 (`R2StorageAdapter`) is deliberately never selected:
 * the local volume stays the hot path, R2 exists for redundancy.
 */

let cached: StorageAdapter | null = null;

/**
 * True iff the four R2 credentials/bucket vars are all present. Exported for
 * the GET route handlers (R2 read-fallback gate). MUST stay in lockstep with
 * `isR2MirrorConfigured()` in `lib/system/health.ts`, which duplicates the
 * check on `process.env` because health.ts avoids importing storage modules.
 */
export function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  );
}

function isR2PartiallyConfigured(): boolean {
  const some = Boolean(
    env.R2_ACCOUNT_ID || env.R2_ACCESS_KEY_ID || env.R2_SECRET_ACCESS_KEY || env.R2_BUCKET,
  );
  return some && !isR2Configured();
}

export function selectStorage(): StorageAdapter {
  if (cached) return cached;
  if (isR2PartiallyConfigured()) {
    // Loud signal at boot — easier to spot than a runtime 500 on first upload.
    console.warn(
      '[storage] R2_* env vars are partially set; falling back to local FS. ' +
        'Either provide all four (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) ' +
        'or none.',
    );
  }
  cached = isR2Configured() ? new DualWriteStorageAdapter() : new LocalStorageAdapter();
  return cached;
}

export type {
  StorageAdapter,
  ScreenshotKind,
  TrainingUploadKind,
  AvatarUploadKind,
  UploadInput,
  UploadKind,
} from './types';
export {
  ALLOWED_IMAGE_MIME_TYPES,
  ALL_UPLOAD_KINDS,
  MAX_SCREENSHOT_BYTES,
  MAX_AVATAR_BYTES,
  StorageError,
  isAnnotationUploadKind,
  isTradeUploadKind,
  isTrainingUploadKind,
  isAvatarUploadKind,
} from './types';
export type {
  ParsedStorageKey,
  ParsedTradeKey,
  ParsedAnnotationKey,
  ParsedTrainingKey,
  ParsedTrainingAnnotationKey,
  ParsedAvatarKey,
} from './keys';
export {
  ANNOTATION_KEY_PATTERN,
  TRAINING_KEY_PATTERN,
  TRAINING_ANNOTATION_KEY_PATTERN,
  AVATAR_KEY_PATTERN,
  generateAnnotationKey,
  generateAvatarKey,
  generateKeyForUpload,
  generateTradeKey,
  generateTrainingKey,
  generateTrainingAnnotationKey,
  parseAnnotationKey,
  parseAvatarKey,
  parseStorageKey,
  parseTradeKey,
  parseTrainingKey,
  parseTrainingAnnotationKey,
  sniffImageMime,
} from './keys';
export {
  avatarKeyBelongsTo,
  keyBelongsTo,
  openLocalReadStream,
  trainingKeyBelongsTo,
} from './local';
export { DualWriteStorageAdapter } from './dual';
export {
  R2StorageAdapter,
  deleteObjectFromR2,
  openR2ReadStream,
  putObjectToR2,
  resetR2ClientForTests,
} from './r2';
