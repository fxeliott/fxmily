import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  isHeic,
  normalizeProofImage,
  sniffProofInputFormat,
  type ProofInputFormat,
} from './normalize-image';

/**
 * Build a real image buffer of the given format via sharp, so the sniff + the
 * normaliser are exercised against genuine encoders (not hand-rolled headers).
 */
async function makeImage(
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif',
  width = 8,
  height = 8,
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 60, b: 30 } },
  });
  switch (format) {
    case 'jpeg':
      return base.jpeg().toBuffer();
    case 'png':
      return base.png().toBuffer();
    case 'webp':
      return base.webp().toBuffer();
    case 'gif':
      return base.gif().toBuffer();
    case 'avif':
      return base.avif().toBuffer();
  }
}

/** Fabricate an ISO-BMFF header with `ftyp` at offset 4 and the given brand. */
function ftypHeader(brand: string): Uint8Array {
  const bytes = new Uint8Array(16);
  // size (4 bytes) — irrelevant to the sniff, set to 16.
  bytes[3] = 16;
  bytes[4] = 0x66; // f
  bytes[5] = 0x74; // t
  bytes[6] = 0x79; // y
  bytes[7] = 0x70; // p
  for (let i = 0; i < 4; i += 1) bytes[8 + i] = brand.charCodeAt(i);
  return bytes;
}

describe('isHeic', () => {
  it.each(['heic', 'heix', 'hevc', 'mif1', 'msf1'])('detects HEIC/HEIF brand %s', (brand) => {
    expect(isHeic(ftypHeader(brand))).toBe(true);
  });

  it('does not flag AVIF (ftyp + avif brand) as HEIC', () => {
    expect(isHeic(ftypHeader('avif'))).toBe(false);
  });

  it('returns false for a non-ISO-BMFF buffer (JPEG magic)', () => {
    const jpegish = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isHeic(jpegish)).toBe(false);
  });

  it('returns false for a too-short buffer', () => {
    expect(isHeic(new Uint8Array([0x66, 0x74, 0x79, 0x70]))).toBe(false);
  });
});

describe('sniffProofInputFormat', () => {
  it.each<ProofInputFormat>(['jpeg', 'png', 'webp', 'gif', 'avif'])(
    'recognises a real %s buffer',
    async (format) => {
      const buf = await makeImage(format);
      expect(sniffProofInputFormat(new Uint8Array(buf))).toBe(format);
    },
  );

  it('returns null for random bytes', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sniffProofInputFormat(junk)).toBeNull();
  });

  it('returns null for a HEIC header (rejected → not an accepted input)', () => {
    expect(sniffProofInputFormat(ftypHeader('heic'))).toBeNull();
  });
});

describe('normalizeProofImage', () => {
  it('re-encodes a PNG to a JPEG (magic bytes FF D8 FF)', async () => {
    const png = await makeImage('png');
    const result = await normalizeProofImage(new Uint8Array(png));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ext).toBe('jpg');
    expect(result.mime).toBe('image/jpeg');
    // JPEG SOI marker.
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);
    expect(result.buffer[2]).toBe(0xff);
    // The output is a decodable JPEG of the expected format.
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('downscales the long side to at most 2200 px (withoutEnlargement)', async () => {
    // 4000×1000 → long side 4000 must clamp to 2200 (aspect preserved → 550 tall).
    const wide = await makeImage('png', 4000, 1000);
    const result = await normalizeProofImage(new Uint8Array(wide));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(2200);
    expect(meta.height).toBe(550);
  });

  it('never upscales a small capture', async () => {
    const small = await makeImage('png', 40, 30);
    const result = await normalizeProofImage(new Uint8Array(small));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(30);
  });

  it('collapses an animated GIF to its first frame (single-frame JPEG)', async () => {
    const gif = await makeImage('gif', 16, 16);
    const result = await normalizeProofImage(new Uint8Array(gif));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    // A JPEG has no page count → one frame only.
    expect(meta.pages ?? 1).toBe(1);
  });

  it('rejects HEIC with a typed reason (never throws)', async () => {
    const result = await normalizeProofImage(ftypHeader('heic'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('heic_unsupported');
  });

  it('rejects undecodable bytes with decode_failed (never throws)', async () => {
    const junk = new Uint8Array(64).fill(0x7f);
    const result = await normalizeProofImage(junk);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('decode_failed');
  });

  it('rejects a pixel flood above the 40 Mpx decode ceiling (decode_failed)', async () => {
    // 7000×6000 = 42 Mpx > MAX_INPUT_PIXELS (40 Mpx). A uniform PNG is tiny
    // on disk yet huge decoded — exactly the flood shape the explicit
    // `limitInputPixels` bound must reject at decode time, before resize.
    // (20 s timeout: generating the 42 Mpx fixture rasterises ~126 MB, which
    // can be slow on loaded CI shards.)
    const flood = await sharp({
      create: { width: 7000, height: 6000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const result = await normalizeProofImage(new Uint8Array(flood));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('decode_failed');
  }, 20_000);
});
