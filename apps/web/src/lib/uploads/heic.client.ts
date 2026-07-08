/**
 * Client-only HEIC/HEIF support for the avatar picker.
 *
 * WHY THIS EXISTS (runtime-proven root cause):
 * iPhones shoot photos in HEIC (HEVC-coded). Every browser EXCEPT Safari refuses
 * to decode HEIC in `<img>`, `<canvas>`, or `createImageBitmap` (the HEVC codec
 * is patent-encumbered), and the server's prebuilt `sharp`/libvips can't decode
 * it either. So a member on desktop Chrome/Firefox/Edge who picks an iPhone photo
 * hits the crop editor's `<img onError>` and the upload dies before it ever
 * reaches the network — "pas tout les fichiers sont acceptés".
 *
 * FIX: convert HEIC → JPEG ON THE DEVICE with libheif (WASM) BEFORE the crop
 * editor, so the member can still frame ANY photo. The heavy (~3 MB) `heic-to`
 * WASM chunk is dynamically imported ONLY when a HEIC is actually detected, so
 * the 99 % of uploads that are already JPEG/PNG/WebP pay ZERO extra bytes.
 *
 * This module is browser-only (uses `File`, `Blob`, dynamic `import()`); it is
 * imported by the `'use client'` avatar settings and only ever runs in event
 * handlers, never during SSR.
 */

// ISO-BMFF `ftyp` major brands that mean "HEIF family" (browser-undecodable).
// Mirrors the server's `HEIF_BRANDS` in `normalize-image.ts` so client and
// server agree on what "is HEIC". AVIF's major brand is `avif`/`avis` (NOT in
// this set), so real AVIF — which browsers DO render — is never misflagged.
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'heif',
  'mif1',
  'msf1',
]);

/**
 * True when `file` is an iPhone HEIC/HEIF image the browser cannot display.
 *
 * Cheap and WASM-free: trusts an explicit HEIC MIME type, else reads only the
 * first 16 bytes to inspect the ISO-BMFF `ftyp` box major brand, else falls back
 * to the filename extension (some OS pickers hand HEIC files an empty MIME type
 * and a header we can still read). A false positive is harmless — the conversion
 * step throws on a non-HEIC input and the caller shows an actionable message; a
 * false negative falls to the crop editor's existing `onDecodeError` safety net.
 */
export async function isHeicFile(file: File): Promise<boolean> {
  const type = file.type.toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;

  try {
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const hasFtyp =
      header.length >= 12 &&
      header[4] === 0x66 && // 'f'
      header[5] === 0x74 && // 't'
      header[6] === 0x79 && // 'y'
      header[7] === 0x70; // 'p'
    if (hasFtyp) {
      // A valid ftyp box is authoritative: decide purely by the major brand.
      // This correctly returns FALSE for an AVIF (major brand 'avif'/'avis'),
      // whose bytes we must NOT hand to the HEIC decoder.
      const brand = String.fromCharCode(...header.subarray(8, 12));
      return HEIF_BRANDS.has(brand);
    }
  } catch {
    // Unreadable header (e.g. a zero-byte or truncated file) — fall through to
    // the extension heuristic rather than crash the picker.
  }

  const name = file.name.toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

/**
 * Convert a HEIC/HEIF file to a JPEG `File`, framing-ready for the crop editor.
 *
 * Lazily imports `heic-to/csp` (the CSP-safe build: inlines the libheif WASM as
 * base64 and runs it in a `blob:` worker — no separate `.wasm` asset to serve,
 * no CDN fetch; the app CSP grants `worker-src 'self' blob:` +
 * `'wasm-unsafe-eval'`). Quality 0.92 keeps the intermediate JPEG visually clean;
 * the editor re-encodes it to a small 512² WebP anyway, so this is throwaway.
 *
 * Throws on any failure (not-actually-HEIC bytes, decode error, empty output) so
 * the caller can surface one honest "conversion impossible" message instead of
 * silently uploading a blank avatar.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to/csp');
  const converted = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  if (!(converted instanceof Blob) || converted.size === 0) {
    throw new Error('HEIC conversion produced an empty image');
  }
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([converted], `${base}.jpg`, { type: 'image/jpeg' });
}
