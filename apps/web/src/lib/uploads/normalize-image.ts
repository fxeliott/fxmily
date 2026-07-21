import 'server-only';

import sharp from 'sharp';

import { runWithImageNormalizeLimit } from './image-normalize-concurrency';

/**
 * Tour 13 — image normalisation for MT5-proof uploads (SPEC §33).
 *
 * The verification screen policy is « les images ne servent QU'À la
 * vérification » — proofs ARE retained in the member's verification space
 * (owner + admin gated, see api/uploads/[...key]; the old « jamais
 * conservées » wording was outdated, fixed 2026-07-08). For the vision
 * pipeline to read « tout type de screen » reliably, every accepted input is
 * re-encoded to a single canonical shape BEFORE it touches storage:
 *
 *   - JPEG quality 85 (small enough that even a 20 MiB HEIC-exported PNG lands
 *     well under the 8 MiB `MAX_SCREENSHOT_BYTES` storage cap);
 *   - EXIF orientation baked in via `.rotate()` (a phone screenshot rotated by
 *     the Orientation tag would otherwise reach Claude sideways → mis-read);
 *   - down-scaled so the long side is at most 2200 px (`withoutEnlargement`
 *     never upscales a small capture) — enough detail for an MT5 history row,
 *     cheap for vision;
 *   - metadata stripped (sharp drops EXIF/ICC on re-encode by default) — a
 *     proof screen should carry zero GPS/device PII onto our disk.
 *
 * Accepted INPUT formats (magic-byte sniffed by the caller): JPEG, PNG, WebP,
 * GIF (first frame), AVIF. HEIC/HEIF is detected but REJECTED with a dedicated
 * actionable error — the prebuilt libvips that ships with sharp cannot decode
 * the patented HEVC payload, so a silent sharp throw would surface as a generic
 * "storage_failed" instead of telling the member how to fix it on their phone.
 */

/** JPEG quality for the normalised output. 85 keeps MT5 text crisp for vision
 *  while collapsing a multi-MiB phone capture to a few hundred KiB. */
const OUTPUT_JPEG_QUALITY = 85;

/** Longest-side ceiling in pixels. An MT5 history table stays legible; the
 *  vision model does not benefit from more, and it bounds the re-encode cost. */
const MAX_LONG_SIDE_PX = 2200;

/** Decode ceiling in pixels (security-review hardening). Sharp already refuses
 *  oversized images by default (~268 Mpx), but that guard is implicit and would
 *  vanish silently if someone ever set `limitInputPixels: false`. Pin a visible
 *  bound instead: 40 Mpx covers an 8K capture (~33 Mpx) with headroom, and a
 *  low-byte / huge-dimension pixel flood is rejected AT DECODE, before any
 *  memory is committed to the resize. */
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Discriminated result: either the normalised JPEG bytes, or a typed rejection
 * the route maps to an actionable FR message. We NEVER throw for an expected
 * rejection (HEIC, undecodable bytes) — throwing is reserved for genuinely
 * unexpected failures the route logs as `storage_failed`.
 */
export type NormalizeImageResult =
  | { readonly ok: true; readonly buffer: Buffer; readonly ext: 'jpg'; readonly mime: 'image/jpeg' }
  | { readonly ok: false; readonly reason: 'heic_unsupported' | 'decode_failed' };

/**
 * Magic-byte sniff for HEIC/HEIF. The ISO-BMFF box layout is
 * `[4-byte size][b'ftyp'][major brand][…]`; HEIC/HEIF declare one of the
 * brands `heic`, `heix`, `hevc`, `hevx`, `heim`, `heis`, `heif`, `mif1`,
 * `msf1` at offset 8. We check the `ftyp` box marker at offset 4 then the
 * brand at offset 8 — this is the same discriminator Apple's Photos uses.
 * AVIF also rides ISO-BMFF (`ftyp` + brand `avif`/`avis`), but sharp DECODES
 * avif, so it is intentionally NOT matched here.
 */
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

export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // `ftyp` box marker at offset 4.
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) {
    return false;
  }
  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return HEIF_BRANDS.has(brand);
}

/**
 * Magic-byte sniff for the formats we accept as INPUT to a proof upload. This
 * is DELIBERATELY wider than `lib/storage/keys.ts::sniffImageMime` (which gates
 * the legacy trade/annotation surface to the 3 formats that get stored as-is):
 * a proof is always re-encoded to JPEG by `normalizeProofImage`, so we can take
 * anything sharp can decode. Returns a coarse label used only for the accept
 * decision + the audit trail — the canonical output MIME is always JPEG.
 *
 * Detects (offset 0 unless noted):
 *   - JPEG  `FF D8 FF`
 *   - PNG   `89 50 4E 47 0D 0A 1A 0A`
 *   - GIF   `GIF87a` / `GIF89a`
 *   - WebP  `RIFF????WEBP`
 *   - AVIF  ISO-BMFF `ftyp` (offset 4) + brand `avif`/`avis` (offset 8)
 *
 * HEIC/HEIF is intentionally NOT matched here — it is caught separately by
 * `isHeic` and rejected, because sharp's prebuilt libvips cannot decode it.
 */
export type ProofInputFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif';

export function sniffProofInputFormat(bytes: Uint8Array): ProofInputFormat | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
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
    return 'png';
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'gif';
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
    return 'webp';
  }
  // AVIF: ISO-BMFF `ftyp` box (offset 4) + brand `avif`/`avis` (offset 8).
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return null;
}

/**
 * Re-encode an already-size-checked input buffer to a canonical, EXIF-oriented,
 * down-scaled JPEG. Returns a typed rejection for HEIC (undecodable by the
 * prebuilt libvips) or unreadable bytes; the storage-facing hash + write are
 * done on the RETURNED bytes, so the on-disk file IS the normalised image.
 */
/** Avatar output edge in pixels. A crisp face at every leaderboard/profile size
 *  (podium 96px → row 40px) while staying a few KiB as WebP. */
const AVATAR_SIZE_PX = 512;

/** WebP quality for avatars. 82 keeps a face clean; WebP beats JPEG on photos. */
const AVATAR_WEBP_QUALITY = 82;

/**
 * Avatar normalisation result — a canonical square WebP, or a typed rejection
 * (mirror of {@link NormalizeImageResult} with a WebP output shape).
 */
export type NormalizeAvatarResult =
  | {
      readonly ok: true;
      readonly buffer: Buffer;
      readonly ext: 'webp';
      readonly mime: 'image/webp';
    }
  | { readonly ok: false; readonly reason: 'heic_unsupported' | 'decode_failed' };

/**
 * Re-encode an already-size-checked input to a canonical square avatar: EXIF
 * baked in, cropped `cover` to {@link AVATAR_SIZE_PX}² with sharp's `attention`
 * strategy (keeps the most salient region — a face — centred), re-encoded to
 * WebP, all metadata stripped (no GPS/device PII persisted). Returns a typed
 * rejection for HEIC / undecodable bytes — never throws for an expected reject.
 */
export async function normalizeAvatarImage(input: Uint8Array): Promise<NormalizeAvatarResult> {
  if (isHeic(input)) {
    return { ok: false, reason: 'heic_unsupported' };
  }
  try {
    // Bound libvips concurrency: a burst of avatar uploads shares the same
    // process-wide memory budget as MT5 proofs (J7 stress-test fix). The
    // re-encode result is identical — only a bounded queue is added in front.
    const buffer = await runWithImageNormalizeLimit(() =>
      sharp(input, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, {
          fit: 'cover',
          position: 'attention',
        })
        .webp({ quality: AVATAR_WEBP_QUALITY })
        .toBuffer(),
    );
    return { ok: true, buffer, ext: 'webp', mime: 'image/webp' };
  } catch {
    return { ok: false, reason: 'decode_failed' };
  }
}

export async function normalizeProofImage(input: Uint8Array): Promise<NormalizeImageResult> {
  // Fail fast on HEIC BEFORE handing the bytes to sharp: the prebuilt binary
  // throws a cryptic "heif: Unsupported codec" that we would otherwise have to
  // string-match. An explicit magic-byte check gives a stable, actionable path.
  if (isHeic(input)) {
    return { ok: false, reason: 'heic_unsupported' };
  }

  try {
    // Bound libvips concurrency (J7 stress-test fix, bottleneck #8): under 50
    // simultaneous MT5 proof uploads, 50 unbounded decode/re-encode pipelines
    // would each hold tens of MiB of pixel buffers at once → OOM. The semaphore
    // queues the excess so at most `MAX_CONCURRENT_IMAGE_NORMALIZE` run
    // together; the normalised output is byte-for-byte identical.
    const buffer = await runWithImageNormalizeLimit(() =>
      sharp(input, {
        // `failOn: 'error'` (not the stricter default 'warning') tolerates the
        // benign warnings real phone captures carry — a truncated ICC profile,
        // an odd chunk — while still aborting on genuinely corrupt pixel data.
        // We only ever read the FIRST frame (no `animated: true`), so an
        // animated GIF/WebP collapses to its opening frame, as intended.
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        // `.rotate()` with no argument bakes in the EXIF Orientation tag (and is
        // applied before the resize, so the ceiling is measured on the UPRIGHT
        // image). Metadata is dropped on re-encode → no GPS/device PII persisted.
        .rotate()
        .resize(MAX_LONG_SIDE_PX, MAX_LONG_SIDE_PX, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: OUTPUT_JPEG_QUALITY })
        .toBuffer(),
    );
    return { ok: true, buffer, ext: 'jpg', mime: 'image/jpeg' };
  } catch {
    // Undecodable / corrupt / unexpected format that slipped past the sniff.
    // Typed rejection, never a thrown error the route would log as a 500.
    return { ok: false, reason: 'decode_failed' };
  }
}
