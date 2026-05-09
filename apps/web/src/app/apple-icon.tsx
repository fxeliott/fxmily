import { ImageResponse } from 'next/og';

/**
 * J10 Phase K — Apple Touch Icon (J9 reclassed polish promoted to J10).
 *
 * Next.js 16 `app/apple-icon.tsx` convention : the file is treated as a
 * route that responds with the rendered `ImageResponse` at
 * `/apple-icon` and Next emits a `<link rel="apple-touch-icon">` in the
 * head automatically. Spec : 180×180 PNG, square, opaque background.
 *
 * Why generate dynamically rather than ship a static PNG :
 *  - no ImageMagick / sharp / Photoshop dependency in the dev toolchain
 *  - icon stays in lockstep with the DS v2 deep-space + lime accent
 *    palette (single source of truth in `globals.css`)
 *  - rebuilding the colour scheme one day does not require editing 4 PNGs
 *
 * The render uses pure CSS so the bundle stays minimal.
 */

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // DS v2 — `--bg` deep-space (`#07090f`) → opaque per Apple HIG.
        background: '#07090f',
        // Subtle lime corner accent for brand recognition without
        // dominating the home screen tile.
        backgroundImage:
          'radial-gradient(circle at 100% 100%, rgba(163,230,53,0.18) 0%, transparent 55%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#a3e635',
        fontWeight: 700,
        fontSize: 96,
        letterSpacing: '-0.04em',
      }}
    >
      f
    </div>,
    { ...size },
  );
}
