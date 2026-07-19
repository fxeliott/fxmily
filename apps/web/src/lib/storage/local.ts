import 'server-only';

import { promises as fs, createReadStream, type ReadStream } from 'node:fs';
import path from 'node:path';

import {
  generateKeyForUpload,
  parseAvatarKey,
  parseProofKey,
  parseStorageKey,
  parseTradeKey,
  parseTrainingKey,
} from './keys';
import {
  type StorageAdapter,
  type UploadInput,
  StorageError,
  type AllowedImageMime,
} from './types';

/**
 * Local filesystem storage adapter (J2 — dev / pre-R2; J4 — annotation media).
 *
 * Stores files in `<UPLOADS_DIR>` (default `<cwd>/.uploads`). The directory is
 * gitignored. Reads are served by the `/api/uploads/[...key]` route handler;
 * we DO NOT serve from the public/ folder because the route handler enforces
 * auth + ownership before streaming the bytes.
 *
 * Path-traversal hardening (CVE-2025-27210, OWASP):
 *   - Allowlist key regex (`parseStorageKey`) — refuses `..`, `/`, control chars.
 *   - `path.resolve` from the upload root + `startsWith(rootSep)` check.
 *   - Reject Windows device names (CON, AUX, NUL, COM1…, LPT1…).
 */

const WIN_DEVICE_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

function uploadsRoot(): string {
  const fromEnv = process.env.UPLOADS_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  // The `/* turbopackIgnore: true */` directive prevents Next.js's NFT (file
  // tracer) from following `process.cwd()` and dragging the whole repo into
  // the deployed bundle.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), '.uploads');
}

function safePathFor(key: string): string {
  // First validate the key shape (also throws StorageError(invalid_key)).
  // Accepts `trades/...`, `annotations/...` and `training/...` prefixes.
  parseStorageKey(key);

  // Reject device-name segments at any depth.
  for (const segment of key.split('/')) {
    if (WIN_DEVICE_NAMES.test(segment)) {
      throw new StorageError('forbidden segment', 'invalid_key');
    }
  }

  const root = uploadsRoot();
  const resolved = path.resolve(root, key);
  // `+ path.sep` ensures we don't false-allow `<root>-other` edge case.
  if (!resolved.startsWith(root + path.sep)) {
    throw new StorageError('path escapes upload root', 'invalid_key');
  }
  return resolved;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly id = 'local';

  async put(input: UploadInput): Promise<{ key: string; readUrl: string }> {
    const mime = input.contentType as AllowedImageMime;
    // Kind → prefix dispatch lives in `generateKeyForUpload` (shared with the
    // R2 adapter so the two stores can never drift on key shapes — §21.5).
    const key = generateKeyForUpload(input.kind, input.pathOwner, mime);
    const target = safePathFor(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // `wx` → fail if the random key collides with an existing file (cosmic
    // ray-grade unlikely with nanoid32, but cheap to enforce).
    await fs.writeFile(target, input.bytes, { flag: 'wx' });
    return { key, readUrl: this.getReadUrl(key) };
  }

  getReadUrl(key: string): string {
    // Validate before exposing. We don't want a malformed key to bubble up
    // into a route URL that 500s the streamer.
    parseStorageKey(key);
    return `/api/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    const target = safePathFor(key);
    await fs.unlink(target).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return; // already gone, that's fine
      throw new StorageError(`local delete failed: ${err.message}`, 'internal');
    });
  }
}

/**
 * J6 (admin-scale, scope 6) — resolve the on-disk absolute path for a storage
 * key WITHOUT opening it. Used by the async RGPD export archiver, which streams
 * local files into the zip via `archive.file(path)` (lazy, one FD at a time).
 * Reuses the same path-traversal hardening as every read (`safePathFor` →
 * `parseStorageKey` + root-containment), so a malformed key throws rather than
 * escaping the upload root.
 */
export function localUploadPathFor(key: string): string {
  return safePathFor(key);
}

/**
 * Open a read stream on a local key. Used by the GET route handler.
 * Throws `StorageError('not_found')` on missing files. Accepts trade,
 * annotation and training keys — the prefix is validated by `parseStorageKey`.
 */
export async function openLocalReadStream(
  key: string,
): Promise<{ stream: ReadStream; size: number; ext: 'jpg' | 'png' | 'webp' }> {
  const parsed = parseStorageKey(key);
  const target = safePathFor(key);
  const stat = await fs.stat(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      throw new StorageError('file not found', 'not_found');
    }
    throw new StorageError(`stat failed: ${err.message}`, 'internal');
  });
  return {
    stream: createReadStream(target),
    size: stat.size,
    ext: parsed.ext,
  };
}

/**
 * Owner check used by route handlers and Server Actions for **trade** keys
 * only. Returns true iff `key` is shaped `trades/{userId}/...` AND the userId
 * matches. Annotation keys carry a tradeId rather than a userId — the
 * member-side ownership check requires a Prisma lookup and lives in the
 * `/api/uploads/[...key]` route handler.
 */
export function keyBelongsTo(key: string, userId: string): boolean {
  try {
    return parseTradeKey(key).userId === userId;
  } catch {
    return false;
  }
}

/**
 * J-T2 — owner check for **training** keys only (Mode Entraînement, SPEC
 * §21). Carbon mirror of `keyBelongsTo`: returns true iff `key` is shaped
 * `training/{userId}/...` AND the userId matches the session. Every other
 * prefix (including `trades/`) returns false — the backtest screenshot BOLA
 * gate must never cross-accept a real-edge key (statistical isolation
 * §21.5). The Server Action calls this exactly like the journal action calls
 * `keyBelongsTo`.
 */
export function trainingKeyBelongsTo(key: string, userId: string): boolean {
  try {
    return parseTrainingKey(key).userId === userId;
  } catch {
    return false;
  }
}

/**
 * S3 — owner check for **MT5 proof** keys only (SPEC §33). Carbon mirror of
 * `keyBelongsTo`: returns true iff `key` is shaped `proofs/{userId}/...` AND
 * the userId matches the session. Every other prefix returns false — the
 * proof BOLA gate must never cross-accept a journal or training key.
 */
export function proofKeyBelongsTo(key: string, userId: string): boolean {
  try {
    return parseProofKey(key).userId === userId;
  } catch {
    return false;
  }
}

/**
 * Leaderboard/profile — owner check for **avatar** keys only. Carbon mirror of
 * `keyBelongsTo`: returns true iff `key` is shaped `avatars/{userId}/...` AND
 * the userId matches the session. Used by the WRITE/DELETE path (a member may
 * only replace/remove their OWN avatar). The READ path is deliberately
 * cross-member (any authenticated active member sees the leaderboard faces) and
 * is gated in the route, NOT here.
 */
export function avatarKeyBelongsTo(key: string, userId: string): boolean {
  try {
    return parseAvatarKey(key).userId === userId;
  } catch {
    return false;
  }
}
