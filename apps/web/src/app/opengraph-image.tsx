import { ImageResponse } from 'next/og';

import { FX_PATH, FX_VIEWBOX } from '@/components/brand/brand-mark';

/**
 * Tour 15 — OpenGraph / social share card (`app/opengraph-image.tsx`).
 *
 * Next.js 16 serves this at `/opengraph-image` and injects the matching
 * `<meta property="og:image">` + `twitter:image` (1200×630 is the canonical
 * social ratio). One sober, premium frame: deep-space background, a single
 * luminous blue accent glow, the FX monogram, "Fxmily", and a short French
 * tagline (no em/en dash — Eliott preference).
 *
 * Font choice (documented per brief): we render with the system UI font
 * stack, NOT the app's Clash Display display face. Loading a custom OTF/WOFF
 * into `ImageResponse` requires a runtime `fetch`/`readFile` of the font
 * binary, which is fragile under `output: 'standalone'` self-hosting (the same
 * class of edge/node tracing issue `apple-icon.tsx` documents). A tightly
 * tracked, heavy system font reads premium here and never fails the render —
 * the DA "wow" of the display face lives inside the app, the share card only
 * needs to be crisp and on-brand. Matches `icon.tsx` / `apple-icon.tsx`, which
 * also ship pure-CSS ImageResponse with no font dependency.
 *
 * `runtime = 'nodejs'` mirrors the other ImageResponse routes — avoids the
 * Edge worker simulation that can fail to trace `@vercel/og` in standalone.
 */
export const runtime = 'nodejs';
export const alt = 'Fxmily, le suivi comportemental de trading';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '96px',
        // DS deep-space (`--bg`, #07090f family). Opaque per OG requirements.
        background: '#07090f',
        // Luminous blue accent glow, top-left, echoing the app ambient orb.
        backgroundImage:
          'radial-gradient(1000px circle at 12% 8%, rgba(59,130,246,0.28) 0%, transparent 55%), radial-gradient(800px circle at 100% 100%, rgba(96,165,250,0.14) 0%, transparent 60%)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* Brand lockup: FX monogram + wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '92px',
            height: '92px',
            borderRadius: '22px',
            background: 'rgba(59,130,246,0.12)',
            border: '1px solid rgba(96,165,250,0.35)',
          }}
        >
          <svg width={54} height={44} viewBox={FX_VIEWBOX} xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" d={FX_PATH} fill="#ecedf2" />
          </svg>
        </div>
        <span
          style={{
            fontSize: '112px',
            fontWeight: 700,
            letterSpacing: '-0.04em',
            color: '#ecedf2',
          }}
        >
          Fxmily
        </span>
      </div>

      {/* Tagline — French, sober, no dash */}
      <div
        style={{
          marginTop: '40px',
          fontSize: '38px',
          lineHeight: 1.3,
          fontWeight: 500,
          color: '#b8bdc9',
          maxWidth: '820px',
        }}
      >
        Le suivi comportemental qui construit ta discipline de trader, jour après jour.
      </div>

      {/* Thin accent underline for depth */}
      <div
        style={{
          marginTop: '48px',
          width: '160px',
          height: '5px',
          borderRadius: '999px',
          background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
        }}
      />
    </div>,
    { ...size },
  );
}
