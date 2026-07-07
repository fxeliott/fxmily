// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvatarCropEditor } from './avatar-crop-editor';

/**
 * AvatarCropEditor — a file that "loads" but decodes to ZERO intrinsic size
 * (an SVG with no width/height, a corrupt raster) must fire onDecodeError, not
 * silently export a blank avatar.
 *
 * Review finding (low): such an image fires onLoad (NOT onError). Unguarded,
 * baseScale becomes Infinity → NaN crop coords → ctx.drawImage is a spec no-op →
 * a BLANK 512² WebP is exported with a "Photo enregistrée" success. The onLoad
 * dimension guard turns that into an actionable decode error. jsdom never
 * decodes images (naturalWidth defaults to 0), which is exactly the zero-dim
 * case, so we drive the good path by defining nonzero natural dimensions.
 */

afterEach(() => cleanup());

function setup(onDecodeError = vi.fn()) {
  const utils = render(
    <AvatarCropEditor
      previewUrl="blob:test"
      onCancel={() => {}}
      onConfirm={() => {}}
      onDecodeError={onDecodeError}
    />,
  );
  const img = utils.container.querySelector('img');
  if (!img) throw new Error('editor image not rendered');
  return { ...utils, img, onDecodeError };
}

describe('AvatarCropEditor — zero-dimension decode guard', () => {
  it('fires onDecodeError when the image decodes to zero dimensions', () => {
    const { img, onDecodeError } = setup();
    // jsdom does not decode: naturalWidth/Height are 0 — the SVG/broken case.
    fireEvent.load(img);
    expect(onDecodeError).toHaveBeenCalledTimes(1);
  });

  it('accepts a normally decoded image without a false decode error', () => {
    const { img, onDecodeError } = setup();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    fireEvent.load(img);
    expect(onDecodeError).not.toHaveBeenCalled();
  });
});
