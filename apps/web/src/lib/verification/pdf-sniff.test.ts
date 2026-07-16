import { describe, expect, it } from 'vitest';

import { isPdfBytes } from './pdf-sniff';

/**
 * J4.6 — unit tests for the pure `%PDF` sniff powering the client-side « on
 * dirait un PDF » guard in `<ProofUploader>`.
 */
describe('isPdfBytes', () => {
  it('returns true for a "%PDF" header (with trailing bytes)', () => {
    expect(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
  });

  it('returns true for an exactly-4-byte "%PDF" buffer', () => {
    expect(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(true);
  });

  it('returns false for a JPEG magic header (FF D8 FF E0)', () => {
    expect(isPdfBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });

  it('returns false for a PNG magic header (89 50 4E 47)', () => {
    expect(isPdfBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it('returns false for a buffer shorter than 4 bytes', () => {
    expect(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
  });

  it('returns false for an empty buffer', () => {
    expect(isPdfBytes(new Uint8Array([]))).toBe(false);
  });

  it('returns false when only the first 3 bytes match "%PD" but the 4th differs', () => {
    expect(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x00]))).toBe(false);
  });
});
