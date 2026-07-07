// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AvatarImage } from './avatar-image';

/**
 * AvatarImage — the `failed` error latch MUST reset when the `url` prop changes.
 *
 * Review finding (medium): the parent Avatar renders AvatarImage with no `key`,
 * so it is ONE persistent instance across url changes. Before the fix, once an
 * old url 404'd at runtime and tripped `setFailed(true)`, the latch was one-way:
 * a freshly uploaded valid photo (or a corrected url after router.refresh())
 * stayed masked behind the initials until a full page reload. The derived-state
 * reset (setFailed(false) when url changes) fixes it; these tests pin it.
 */

afterEach(() => cleanup());

describe('AvatarImage — error latch resets on url change', () => {
  it('shows a NEW photo after a prior url failed on the same instance', () => {
    const { container, rerender } = render(
      <AvatarImage url="/old.webp" firstName="Alex" size={64} />,
    );
    expect(container.querySelector('img')).not.toBeNull();

    // The old url 404s at runtime → the image removes itself, initials show.
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    // A new valid photo arrives (upload success / router.refresh()) on the SAME
    // instance (no key). Without the reset this would stay null forever.
    rerender(<AvatarImage url="/new.webp" firstName="Alex" size={64} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/new.webp');
  });

  it('keeps hiding when the SAME url stays failed (no spurious reset)', () => {
    const { container, rerender } = render(
      <AvatarImage url="/same.webp" firstName="Alex" size={64} />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    // Re-render with the identical url (e.g. an unrelated parent re-render) must
    // NOT resurrect a known-broken image.
    rerender(<AvatarImage url="/same.webp" firstName="Alex" size={64} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
