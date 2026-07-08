import { afterEach, describe, expect, it, vi } from 'vitest';

import { convertHeicToJpeg, isHeicFile } from './heic.client';

/**
 * Client HEIC support. `isHeicFile` is a pure, WASM-free magic-byte gate — the
 * cheap pre-filter that decides whether to lazy-load the 3 MB libheif WASM. We
 * test its detection matrix exhaustively (that's the correctness-critical part).
 * `convertHeicToJpeg` is tested with `heic-to/csp` mocked, so no real WASM runs
 * under the unit suite (the real decode is proven in-browser).
 */

// Mock the heavy WASM module so the unit test never loads libheif. Per-test
// behaviour is overridden via `vi.mocked(heicTo)`.
vi.mock('heic-to/csp', () => ({
  heicTo: vi.fn(),
  isHeic: vi.fn(),
}));

import { heicTo } from 'heic-to/csp';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** A minimal ISO-BMFF `ftyp` box header with the given 4-char major brand. */
function ftypHeader(brand: string): number[] {
  // [box size (4)] [ 'ftyp' (4) ] [ major brand (4) ] [ minor version (4) ]
  return [0x00, 0x00, 0x00, 0x18, ...ascii('ftyp'), ...ascii(brand), 0x00, 0x00, 0x00, 0x00];
}

function fileFromBytes(bytes: number[], name: string, type = ''): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

afterEach(() => vi.clearAllMocks());

describe('isHeicFile — magic-byte detection', () => {
  it('accepts an explicit image/heic MIME type without reading bytes', async () => {
    await expect(isHeicFile(fileFromBytes([0, 0], 'x.bin', 'image/heic'))).resolves.toBe(true);
  });

  it('accepts an explicit image/heif MIME type', async () => {
    await expect(isHeicFile(fileFromBytes([0, 0], 'x.bin', 'image/heif'))).resolves.toBe(true);
  });

  it('detects a real HEIC by its ftyp "heic" major brand (empty MIME)', async () => {
    await expect(isHeicFile(fileFromBytes(ftypHeader('heic'), 'IMG_1234.HEIC'))).resolves.toBe(
      true,
    );
  });

  it('detects the HEIF "mif1" brand iPhones also emit', async () => {
    await expect(isHeicFile(fileFromBytes(ftypHeader('mif1'), 'photo'))).resolves.toBe(true);
  });

  it('does NOT flag an AVIF (ftyp "avif") — browsers render it natively', async () => {
    // The critical false-positive guard: an AVIF is a MIAF/ftyp file too, but its
    // major brand is not in the HEIF set, so it must NOT be sent to the decoder.
    await expect(isHeicFile(fileFromBytes(ftypHeader('avif'), 'shot.avif'))).resolves.toBe(false);
  });

  it('does NOT flag a JPEG (no ftyp box, .jpg name)', async () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 0, 0, 0, 0, 0];
    await expect(isHeicFile(fileFromBytes(jpeg, 'photo.jpg', 'image/jpeg'))).resolves.toBe(false);
  });

  it('does NOT flag a PNG', async () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0];
    await expect(isHeicFile(fileFromBytes(png, 'photo.png', 'image/png'))).resolves.toBe(false);
  });

  it('falls back to the .heic extension when there is no ftyp box and no MIME', async () => {
    await expect(isHeicFile(fileFromBytes([1, 2, 3, 4, 5, 6, 7, 8], 'weird.heic'))).resolves.toBe(
      true,
    );
  });

  it('falls back to the .heif extension (case-insensitive)', async () => {
    await expect(isHeicFile(fileFromBytes([1, 2, 3, 4], 'PHOTO.HEIF'))).resolves.toBe(true);
  });

  it('returns false for a short/garbage file with a non-image extension', async () => {
    await expect(isHeicFile(fileFromBytes([1, 2], 'note.txt'))).resolves.toBe(false);
  });

  it('does not crash and uses the extension when the header is unreadable', async () => {
    // Defensive branch: a File whose bytes cannot be read (I/O error) must not
    // throw out of the picker — it falls back to the filename.
    const broken = {
      name: 'photo.heic',
      type: '',
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('unreadable')) }),
    } as unknown as File;
    await expect(isHeicFile(broken)).resolves.toBe(true);
  });
});

describe('convertHeicToJpeg', () => {
  it('wraps the decoder output in a JPEG File named after the source', async () => {
    vi.mocked(heicTo).mockResolvedValueOnce(
      new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
    );
    const out = await convertHeicToJpeg(fileFromBytes(ftypHeader('heic'), 'IMG_1234.HEIC'));
    expect(out).toBeInstanceOf(File);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG_1234.jpg');
    expect(out.size).toBeGreaterThan(0);
    expect(heicTo).toHaveBeenCalledWith({
      blob: expect.any(File),
      type: 'image/jpeg',
      quality: 0.92,
    });
  });

  it('names the output "photo.jpg" when the source has no extension', async () => {
    vi.mocked(heicTo).mockResolvedValueOnce(
      new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
    );
    const out = await convertHeicToJpeg(fileFromBytes(ftypHeader('heic'), 'photo'));
    expect(out.name).toBe('photo.jpg');
  });

  it('throws when the decoder yields an empty blob (never uploads a blank avatar)', async () => {
    vi.mocked(heicTo).mockResolvedValueOnce(new Blob([], { type: 'image/jpeg' }));
    await expect(convertHeicToJpeg(fileFromBytes(ftypHeader('heic'), 'a.heic'))).rejects.toThrow();
  });

  it('propagates a decoder failure (not-actually-HEIC bytes) to the caller', async () => {
    vi.mocked(heicTo).mockRejectedValueOnce(new Error('not a HEIC'));
    await expect(convertHeicToJpeg(fileFromBytes([0, 1, 2], 'a.heic'))).rejects.toThrow(
      'not a HEIC',
    );
  });
});
