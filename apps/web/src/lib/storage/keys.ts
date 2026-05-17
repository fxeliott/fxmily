import { nanoid } from 'nanoid';

import { ALLOWED_IMAGE_MIME_TYPES, type AllowedImageMime, StorageError } from './types';

/**
 * Storage-key helpers (J2 + J4).
 *
 * Two key shapes share the same alphabet/length budget:
 *
 *   trades/{userId}/{nanoid32}.{jpg|png|webp}            ← J2 trade screenshots
 *   annotations/{tradeId}/{nanoid32}.{jpg|png|webp}      ← J4 admin annotations
 *
 * Where:
 *   - `userId` and `tradeId` are CUIDs (lowercase alnum, 25 chars). We allow
 *     8–40 to absorb future id generators (e.g. uuid v7 hex = 32) and shorter
 *     test fixtures. ReDoS-safe — every class has bounded length and bounded
 *     character set.
 *   - `nanoid32` is a fresh server-side identifier. Never derived from the
 *     user's filename.
 *   - The extension matches the validated MIME — we never trust the original
 *     filename's extension.
 */

const KEY_REGEX_TRADE = /^trades\/([a-z0-9]{8,40})\/([a-zA-Z0-9_-]{12,40})\.(jpg|png|webp)$/;
const KEY_REGEX_ANNOTATION =
  /^annotations\/([a-z0-9]{8,40})\/([a-zA-Z0-9_-]{12,40})\.(jpg|png|webp)$/;
// J-T2 — Mode Entraînement backtest screenshot. Capturing variant of the
// J-T1 `TRAINING_KEY_PATTERN`; the userId segment is the uploading member.
const KEY_REGEX_TRAINING = /^training\/([a-z0-9]{8,40})\/([a-zA-Z0-9_-]{12,40})\.(jpg|png|webp)$/;

/**
 * Single-source-of-truth pattern for annotation keys, exported for the Zod
 * schema in `lib/schemas/annotation.ts`. The capturing groups in
 * `KEY_REGEX_ANNOTATION` are kept private (used by `parseAnnotationKey`);
 * this anchored variant is the right shape for `z.string().regex()`.
 */
export const ANNOTATION_KEY_PATTERN =
  /^annotations\/[a-z0-9]{8,40}\/[a-zA-Z0-9_-]{12,40}\.(jpg|png|webp)$/;

/**
 * Single-source-of-truth patterns for V1.2 Mode-Entraînement keys (SPEC §21),
 * exported for the Zod schemas in `lib/schemas/training-trade.ts` +
 * `lib/schemas/training-annotation.ts`. Mirror of `ANNOTATION_KEY_PATTERN`
 * with `training` / `training_annotations` prefixes.
 *
 * J-T1 (data layer) only needs the validation pattern. The key generators,
 * parsers and the `parseStorageKey` discriminant for these prefixes land in
 * J-T2 (when the `/api/uploads` route + the `/training/new` wizard consume
 * them) — adding them now would be dead code with no caller.
 */
export const TRAINING_KEY_PATTERN =
  /^training\/[a-z0-9]{8,40}\/[a-zA-Z0-9_-]{12,40}\.(jpg|png|webp)$/;

export const TRAINING_ANNOTATION_KEY_PATTERN =
  /^training_annotations\/[a-z0-9]{8,40}\/[a-zA-Z0-9_-]{12,40}\.(jpg|png|webp)$/;

const MIME_TO_EXT: Record<AllowedImageMime, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const CUID_REGEX = /^[a-z0-9]{8,40}$/;

export function isAllowedMime(value: string): value is AllowedImageMime {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function extensionForMime(mime: AllowedImageMime): 'jpg' | 'png' | 'webp' {
  return MIME_TO_EXT[mime];
}

export function generateTradeKey(userId: string, mime: AllowedImageMime): string {
  if (!CUID_REGEX.test(userId)) {
    // Defensive: CUIDs from Prisma are alnum-only. If we ever change the id
    // generator (uuid?) update this regex AND `KEY_REGEX_TRADE` together.
    throw new StorageError('userId is not safe for storage key', 'invalid_key');
  }
  const id = nanoid(32);
  return `trades/${userId}/${id}.${MIME_TO_EXT[mime]}`;
}

/**
 * J4 — annotation media key. The path component is the parent trade id rather
 * than the admin id: ownership checks resolve via a single
 * `db.trade.findUnique({ where: { id }, select: { userId } })` lookup, no
 * extra join needed.
 */
export function generateAnnotationKey(tradeId: string, mime: AllowedImageMime): string {
  if (!CUID_REGEX.test(tradeId)) {
    throw new StorageError('tradeId is not safe for storage key', 'invalid_key');
  }
  const id = nanoid(32);
  return `annotations/${tradeId}/${id}.${MIME_TO_EXT[mime]}`;
}

/**
 * J-T2 — Mode Entraînement backtest screenshot key generator. Carbon mirror
 * of `generateTradeKey`: the path component is the uploading member's id
 * (the backtest row doesn't exist yet at upload time). STATISTICAL ISOLATION
 * (SPEC §21.5): the `training/` prefix never overlaps the real-edge
 * `trades/` / `annotations/` surfaces.
 */
export function generateTrainingKey(userId: string, mime: AllowedImageMime): string {
  if (!CUID_REGEX.test(userId)) {
    throw new StorageError('userId is not safe for storage key', 'invalid_key');
  }
  const id = nanoid(32);
  return `training/${userId}/${id}.${MIME_TO_EXT[mime]}`;
}

export interface ParsedTradeKey {
  kind: 'trade';
  userId: string;
  filename: string;
  ext: 'jpg' | 'png' | 'webp';
}

export interface ParsedAnnotationKey {
  kind: 'annotation';
  tradeId: string;
  filename: string;
  ext: 'jpg' | 'png' | 'webp';
}

export interface ParsedTrainingKey {
  kind: 'training';
  userId: string;
  filename: string;
  ext: 'jpg' | 'png' | 'webp';
}

export type ParsedStorageKey = ParsedTradeKey | ParsedAnnotationKey | ParsedTrainingKey;

export function parseTradeKey(key: string): ParsedTradeKey {
  const match = KEY_REGEX_TRADE.exec(key);
  if (!match) {
    throw new StorageError(`malformed storage key: ${key.slice(0, 80)}`, 'invalid_key');
  }
  return {
    kind: 'trade',
    userId: match[1] as string,
    filename: match[2] as string,
    ext: match[3] as 'jpg' | 'png' | 'webp',
  };
}

/**
 * J4 — parse an annotation key. Mirror of `parseTradeKey` for the alternative
 * prefix. Throws `StorageError('invalid_key')` on mismatch.
 */
export function parseAnnotationKey(key: string): ParsedAnnotationKey {
  const match = KEY_REGEX_ANNOTATION.exec(key);
  if (!match) {
    throw new StorageError(`malformed annotation key: ${key.slice(0, 80)}`, 'invalid_key');
  }
  return {
    kind: 'annotation',
    tradeId: match[1] as string,
    filename: match[2] as string,
    ext: match[3] as 'jpg' | 'png' | 'webp',
  };
}

/**
 * J-T2 — parse a Mode-Entraînement backtest key. Mirror of `parseTradeKey`
 * for the `training/` prefix. Throws `StorageError('invalid_key')` on
 * mismatch. The captured `userId` is the path-owner used by the BOLA check.
 */
export function parseTrainingKey(key: string): ParsedTrainingKey {
  const match = KEY_REGEX_TRAINING.exec(key);
  if (!match) {
    throw new StorageError(`malformed training key: ${key.slice(0, 80)}`, 'invalid_key');
  }
  return {
    kind: 'training',
    userId: match[1] as string,
    filename: match[2] as string,
    ext: match[3] as 'jpg' | 'png' | 'webp',
  };
}

/**
 * Unified parser used by route handlers that accept any prefix. Returns a
 * discriminated union so the caller can dispatch on `parsed.kind`.
 */
export function parseStorageKey(key: string): ParsedStorageKey {
  if (key.startsWith('trades/')) return parseTradeKey(key);
  if (key.startsWith('annotations/')) return parseAnnotationKey(key);
  // `training/` is checked AFTER `trades/`/`annotations/`; the prefixes are
  // disjoint so order is for readability only. `training_annotations/`
  // (J-T3) is intentionally NOT dispatched here — no caller exists in J-T2.
  if (key.startsWith('training/')) return parseTrainingKey(key);
  throw new StorageError(`unknown storage key prefix: ${key.slice(0, 80)}`, 'invalid_key');
}

/**
 * Magic-byte sniffing for the three allowed image MIMEs. We don't depend on
 * `file-type` because (a) Doyensec showed it's bypassable on offset-8 magic
 * bytes for some formats and (b) for our 3 simple formats, the inline check
 * is 12 lines and inspectable.
 *
 * Returns the detected MIME or null if no allowlisted format matches.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}
