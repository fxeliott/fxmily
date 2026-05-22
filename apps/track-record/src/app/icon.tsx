import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0b0e14 0%, #14171d 100%)',
        color: '#0085ff',
        fontSize: 22,
        fontWeight: 700,
        fontFamily: 'system-ui',
        letterSpacing: '-0.04em',
      }}
    >
      FX
    </div>,
    size,
  );
}
