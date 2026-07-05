/**
 * Tour 14 — client-side pre-compression for MT5-proof uploads.
 *
 * The server already normalises every proof to a canonical JPEG (q85, long side
 * ≤ 2200 px) via `lib/uploads/normalize-image.ts`. This helper does the SAME
 * shrink on the CLIENT, BEFORE the network transfer, but only for genuinely
 * heavy captures: a phone screenshot can weigh several MB, and sending 6 MB over
 * a mobile uplink is the slow part of the flow, not the server re-encode. By
 * downscaling to the same 2200 px ceiling and re-encoding to JPEG q0.85 in the
 * browser, a heavy capture lands as a few hundred KB on the wire — faster upload,
 * identical readability for the vision model (same target as the server).
 *
 * Contract (deliberately conservative — a proof must stay legible):
 *   - only kicks in above `COMPRESS_THRESHOLD_BYTES` (~1.5 MB); small captures
 *     are sent untouched (no quality loss, no CPU for nothing);
 *   - JPEG quality `0.85`, NEVER below (MT5 rows must stay crisp — the server
 *     uses 85 too, so this is lossless-parity, not a downgrade);
 *   - long side capped at `MAX_LONG_SIDE_PX` (2200), mirroring the server;
 *   - ALWAYS falls back to the raw file if anything fails (decode error, no
 *     canvas support, a bigger output, a null blob) — compression is a nice-to-
 *     have, never a gate. The server re-normalises regardless, so a raw send is
 *     always correct.
 *
 * PII note: this reads the image into a canvas in the browser only; nothing is
 * persisted client-side and the bytes never leave the member's device except as
 * the upload they were already making.
 */

/** Only compress captures heavier than this (bytes). ~1.5 MB. */
export const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;

/** Long-side ceiling in px — same as the server `MAX_LONG_SIDE_PX`. */
export const MAX_LONG_SIDE_PX = 2200;

/** JPEG quality for the client re-encode. Parity with the server's 85; the
 *  brief forbids going below 0.8 to keep MT5 text readable. */
export const OUTPUT_JPEG_QUALITY = 0.85;

/**
 * Pure helper: compute the target {width, height} for a downscale that fits
 * inside `MAX_LONG_SIDE_PX` while preserving aspect ratio, and NEVER upscales
 * (a capture already under the ceiling is returned unchanged). Rounded to whole
 * pixels. Exposed for unit tests (the canvas path can't run under jsdom).
 */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxLongSide: number = MAX_LONG_SIDE_PX,
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide || longSide === 0) {
    return { width, height };
  }
  const scale = maxLongSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Pure helper: should we even attempt client compression for this file? Only
 * real images above the size threshold. A GIF is skipped (animation would be
 * flattened to frame 1 client-side too, but the server already handles that and
 * GIF proofs are rare/small — not worth a canvas round-trip here). Exposed for
 * tests.
 */
export function shouldCompressProof(file: { size: number; type: string }): boolean {
  if (file.size <= COMPRESS_THRESHOLD_BYTES) return false;
  return file.type.startsWith('image/') && file.type !== 'image/gif';
}

/**
 * Load a File into an HTMLImageElement via an object URL. Rejects on decode
 * error; the caller turns any rejection into a raw-send fallback.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_decode_failed'));
    };
    img.src = url;
  });
}

/**
 * Compress a proof File client-side if it is worth it, else return the original
 * File unchanged. NEVER throws: any failure resolves to the raw `file` so the
 * upload proceeds (the server re-normalises either way).
 *
 * Returns the (possibly new) File to send. A compressed result is renamed to
 * `<stem>.jpg` with `image/jpeg` type so the POST advertises the real payload;
 * the server sniffs magic bytes regardless, so the name is cosmetic.
 */
export async function compressProofImage(file: File): Promise<File> {
  if (!shouldCompressProof(file)) return file;
  // Guard for SSR / environments without a canvas (defensive — this runs client
  // side, but keeps the helper total and unit-test friendly).
  if (typeof document === 'undefined') return file;

  try {
    const img = await loadImage(file);
    const { width, height } = computeScaledDimensions(img.naturalWidth, img.naturalHeight);
    if (width === 0 || height === 0) return file;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', OUTPUT_JPEG_QUALITY);
    });
    // No blob, or the re-encode ended up LARGER than the original (already
    // well-compressed source) → keep the raw file, no point sending more bytes.
    if (blob === null || blob.size >= file.size) return file;

    const stem = file.name.replace(/\.[^./\\]+$/, '');
    return new File([blob], `${stem || 'capture'}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    // Any decode / canvas / encode failure → raw send. Compression is best-effort.
    return file;
  }
}
