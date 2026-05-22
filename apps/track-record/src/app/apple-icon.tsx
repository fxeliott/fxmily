import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(70% 70% at 50% 30%, rgba(0,133,255,0.35) 0%, transparent 60%), #07090f',
        color: '#ffffff',
        fontSize: 96,
        fontWeight: 700,
        fontFamily: 'system-ui',
        letterSpacing: '-0.04em',
        textShadow: '0 0 32px rgba(0,133,255,0.45)',
      }}
    >
      FX
    </div>,
    size,
  );
}
