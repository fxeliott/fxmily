import { ImageResponse } from 'next/og';

import { FX_PATH, FX_VIEWBOX } from '@/components/brand/brand-mark';

/**
 * J10 Phase K — favicon PNG généré (navigateurs préférant le raster au SVG :
 * Edge < 91, vieux Safari, certains Android). Affiche le monogramme « FX »
 * officiel (logo vectorisé, source unique `brand-mark.tsx`) en blanc sur le
 * deep-space — cohérent avec `apple-icon.tsx` et `favicon.svg`.
 *
 * Next.js 16 émet automatiquement `<link rel="icon" type="image/png"
 * sizes="32x32" href="/icon">` quand ce fichier exporte un `ImageResponse`.
 */
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
        borderRadius: 6,
      }}
    >
      <svg width={22} height={18} viewBox={FX_VIEWBOX} xmlns="http://www.w3.org/2000/svg">
        <path fillRule="evenodd" d={FX_PATH} fill="#ffffff" />
      </svg>
    </div>,
    { ...size },
  );
}
