'use client';

import { useState } from 'react';

/**
 * Tour 13 — read-only display of a LEGACY annotation capture (pre-Tour-13
 * uploaded image). New corrections carry a TradingView link instead, but rows
 * created before the pivot still hold a `mediaKey`; the underlying files WILL be
 * purged in prod, so a broken `<img>` would otherwise show a torn-image glyph.
 *
 * Tiny client island (the annotations sections are Server Components): on the
 * first load error it swaps the image for a discreet "Capture retirée." note so
 * a purged file degrades gracefully instead of rendering broken.
 */
export function LegacyCaptureImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p className="t-cap rounded-card mt-3 border border-dashed border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2 text-[var(--t-4)]">
        Capture retirée.
      </p>
    );
  }

  return (
    <div className="mt-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="rounded-card max-h-96 w-full border border-[var(--b-default)] object-contain shadow-[var(--sh-card)]"
      />
    </div>
  );
}
