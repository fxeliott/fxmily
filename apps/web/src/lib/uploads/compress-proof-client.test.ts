import { describe, expect, it } from 'vitest';

import {
  COMPRESS_THRESHOLD_BYTES,
  MAX_LONG_SIDE_PX,
  compressProofImage,
  computeScaledDimensions,
  shouldCompressProof,
} from './compress-proof-client';

/**
 * Tour 14 — client proof compression helper. The canvas encode path can't run
 * under jsdom (no real 2D encoder), so we unit-test the PURE decision helpers
 * and the raw-file fallbacks that make the whole thing best-effort.
 */

describe('computeScaledDimensions', () => {
  it('downscales a landscape image so its long side hits the ceiling', () => {
    expect(computeScaledDimensions(4400, 2200)).toEqual({ width: 2200, height: 1100 });
  });

  it('downscales a portrait image on its long (height) side', () => {
    expect(computeScaledDimensions(1650, 3300)).toEqual({ width: 1100, height: 2200 });
  });

  it('never upscales an image already under the ceiling', () => {
    expect(computeScaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('leaves an image exactly at the ceiling untouched', () => {
    expect(computeScaledDimensions(MAX_LONG_SIDE_PX, 1000)).toEqual({
      width: MAX_LONG_SIDE_PX,
      height: 1000,
    });
  });

  it('preserves aspect ratio (rounded) on an odd size', () => {
    const out = computeScaledDimensions(3000, 2000);
    expect(out.width).toBe(2200);
    // 2000 * (2200/3000) = 1466.66… → 1467
    expect(out.height).toBe(1467);
  });

  it('returns zeros unchanged (guards a degenerate 0×0)', () => {
    expect(computeScaledDimensions(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it('honours a custom ceiling', () => {
    expect(computeScaledDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
  });
});

describe('shouldCompressProof', () => {
  it('skips a small capture (below the threshold)', () => {
    expect(shouldCompressProof({ size: 500 * 1024, type: 'image/png' })).toBe(false);
  });

  it('compresses a heavy PNG capture (above the threshold)', () => {
    expect(shouldCompressProof({ size: COMPRESS_THRESHOLD_BYTES + 1, type: 'image/png' })).toBe(
      true,
    );
  });

  it('compresses a heavy JPEG capture', () => {
    expect(shouldCompressProof({ size: 5 * 1024 * 1024, type: 'image/jpeg' })).toBe(true);
  });

  it('skips a GIF even when heavy (animation handled server-side)', () => {
    expect(shouldCompressProof({ size: 5 * 1024 * 1024, type: 'image/gif' })).toBe(false);
  });

  it('skips a non-image blob', () => {
    expect(shouldCompressProof({ size: 5 * 1024 * 1024, type: 'application/pdf' })).toBe(false);
  });

  it('treats a capture exactly at the threshold as small (strict >)', () => {
    expect(shouldCompressProof({ size: COMPRESS_THRESHOLD_BYTES, type: 'image/png' })).toBe(false);
  });
});

describe('compressProofImage — raw-file fallback', () => {
  it('returns the original file unchanged for a small capture (no canvas round-trip)', async () => {
    const small = new File([new Uint8Array(1024)], 'small.png', { type: 'image/png' });
    const out = await compressProofImage(small);
    expect(out).toBe(small);
  });

  it('returns the original file unchanged for a GIF', async () => {
    const gif = new File([new Uint8Array(3 * 1024 * 1024)], 'anim.gif', { type: 'image/gif' });
    const out = await compressProofImage(gif);
    expect(out).toBe(gif);
  });
});
