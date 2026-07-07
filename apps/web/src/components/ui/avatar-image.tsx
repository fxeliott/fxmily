'use client';

import { useState } from 'react';

export interface AvatarImageProps {
  /** Read URL for the member's photo (already checked non-null by the parent). */
  url: string;
  /** First name, used only for the alt text (accessibility). */
  firstName: string;
  /** Rendered square size in pixels, mirrored from the parent Avatar. */
  size: number;
}

/**
 * AvatarImage — client image layer for {@link Avatar}.
 *
 * Sits on top of the always-rendered initials disc. On a load error (expired
 * object-store URL, deleted file, or a read path that 404s/501s at runtime) it
 * removes itself so the initials show through — keeping the primitive's
 * "never a broken image" promise even when the src fails after render. Kept as
 * a tiny island so the parent {@link Avatar} stays a Server Component.
 */
export function AvatarImage({ url, firstName, size }: AvatarImageProps): React.ReactElement | null {
  const [failed, setFailed] = useState(false);
  // Reset the error latch when a NEW url arrives (the officially-supported
  // "adjust state while rendering on a prop change" pattern, same as
  // avatar-crop-editor.tsx). Without it `failed` is a one-way latch: once an old
  // url 404s and trips `setFailed(true)`, this SAME persistent instance (the
  // parent Avatar renders it with no `key`) would keep hiding the image, so a
  // freshly uploaded valid photo — or a corrected url after router.refresh() —
  // would stay masked behind the initials until a full page reload.
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    setFailed(false);
  }
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage-agnostic src (local API path or absolute object-store URL); photo is already a normalized 512px square WebP.
    <img
      src={url}
      alt={`Photo de ${firstName}`}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
