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

function requireEl(container: HTMLElement, selector: string): HTMLElement {
  const el = container.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return el;
}

/** Drive the good decode path so `natural` is set and the pan can actually move.
 *  800×600 cover-fit at zoom 1 → displayed height == viewport, so the VERTICAL
 *  pan is clamped to 0 (ArrowUp/Down hit an edge) while horizontal pan is free. */
function decoded() {
  const s = setup();
  Object.defineProperty(s.img, 'naturalWidth', { value: 800, configurable: true });
  Object.defineProperty(s.img, 'naturalHeight', { value: 600, configurable: true });
  fireEvent.load(s.img);
  return s;
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

describe('AvatarCropEditor — screen-reader pan feedback', () => {
  it('exposes the viewport as a labelled roledescription widget with arrow shortcuts', () => {
    const { container } = setup();
    const group = requireEl(container, '[role="group"]');
    expect(group.getAttribute('aria-roledescription')).toBe('zone de cadrage');
    expect(group.getAttribute('aria-keyshortcuts')).toBe('ArrowUp ArrowDown ArrowLeft ArrowRight');
  });

  it('has a polite live region, empty until the first nudge', () => {
    const { container } = setup();
    const live = requireEl(container, '[aria-live="polite"]');
    expect(live.textContent).toBe('');
  });

  it('announces the nudge direction when the frame actually moves', () => {
    const { container } = decoded();
    const group = requireEl(container, '[role="group"]');
    const live = requireEl(container, '[aria-live="polite"]');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(live.textContent).toBe('Vers la gauche');
  });

  it('announces "Bord atteint" when the frame is against a clamp edge', () => {
    const { container } = decoded();
    const group = requireEl(container, '[role="group"]');
    const live = requireEl(container, '[aria-live="polite"]');
    // Vertical pan is clamped to 0 for a 800×600 cover-fit at zoom 1 → ArrowUp
    // cannot move the frame, so the live region reports the clamp edge.
    fireEvent.keyDown(group, { key: 'ArrowUp' });
    expect(live.textContent).toBe('Bord atteint');
  });
});
