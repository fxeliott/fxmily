import { ImageResponse } from 'next/og';

/**
 * J10 Phase K — generated PNG favicon for browsers that prefer raster
 * over the SVG (Edge < 91, older Safari, some Android variants). Same
 * "f" mark as `apple-icon.tsx` to keep the brand consistent across
 * surfaces.
 *
 * Next.js 16 emits a `<link rel="icon" type="image/png" sizes="32x32"
 * href="/icon">` automatically when this file exports a default
 * `ImageResponse`.
 */

// J10 Phase L review H8 : `nodejs` runtime aligns with `apple-icon.tsx`
// for self-hosted Next 16 standalone tracing.
export const runtime = 'nodejs';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#07090f',
        color: '#a3e635',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: '-0.04em',
        borderRadius: 6,
      }}
    >
      f
    </div>,
    { ...size },
  );
}
