import { nanoid } from 'nanoid';

import { ALLOWED_IMAGE_MIME_TYPES, type AllowedImageMime, StorageError } from './types';

/**
 * Storage-key helpers (J2).
 *
 * Canonical form:
 *   trades/{userId}/{nanoid32}.{jpg|png|webp}
 *
 * Where:
 *   - `userId` is a CUID (lowercase alnum, 25 chars) — directly mapped to
 *     `User.id`. The user-scoped path provides natural ownership lookup
 *     (route handlers can grep the prefix without parsing the trade record).
 *   - `nanoid32` is a fresh server-side identifier. Never derived from the
 *     user's filename.
 *   - The extension matches the validated MIME — we don't trust the original
 *     filename's extension.
 */

// CUIDs from Prisma are 25 chars; we allow 8–40 to absorb future id generators
// (e.g. uuid v7 hex = 32) and shorter test fixtures. ReDoS-safe — every class
// has both bounded length and bounded character set.
const KEY_REGEX = /^trades\/([a-z0-9]{8,40})\/([a-zA-Z0-9_-]{12,40})\.(jpg|png|webp)$/;

const MIME_TO_EXT: Record<AllowedImageMime, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isAllowedMime(value: string): value is AllowedImageMime {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function extensionForMime(mime: AllowedImageMime): 'jpg' | 'png' | 'webp' {
  return MIME_TO_EXT[mime];
}

export function generateTradeKey(userId: string, mime: AllowedImageMime): string {
  if (!/^[a-z0-9]+$/.test(userId)) {
    // Defensive: CUIDs from Prisma are alnum-only. If we ever change the id
    // generator (uuid?) update this regex AND `KEY_REGEX` together.
    throw new StorageError('userId is not safe for storage key', 'invalid_key');
  }
  const id = nanoid(32);
  return `trades/${userId}/${id}.${MIME_TO_EXT[mime]}`;
}

export interface ParsedKey {
  userId: string;
  filename: string;
  ext: 'jpg' | 'png' | 'webp';
}

export function parseTradeKey(key: string): ParsedKey {
  const match = KEY_REGEX.exec(key);
  if (!match) {
    throw new StorageError(`malformed storage key: ${key.slice(0, 80)}`, 'invalid_key');
  }
  return {
    userId: match[1] as string,
    filename: match[2] as string,
    ext: match[3] as 'jpg' | 'png' | 'webp',
  };
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
