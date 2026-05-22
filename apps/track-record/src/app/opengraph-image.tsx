import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Fxmily · Track record public';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Dynamic OG image — generated at edge runtime via @vercel/og.
 * Theme: noir profond + bleu lumineux + glow signature.
 * Used by social shares (Twitter / Facebook / LinkedIn / Discord).
 */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(70% 50% at 25% 35%, rgba(0,133,255,0.30) 0%, transparent 60%), radial-gradient(60% 50% at 85% 65%, rgba(0,133,255,0.20) 0%, transparent 60%), #0b0e14',
        padding: 72,
        color: '#ededf3',
        fontFamily: 'system-ui',
      }}
    >
      {/* Eyebrow */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 18,
          color: '#60a5fa',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 500,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: '#0085ff',
            boxShadow: '0 0 24px rgba(0,133,255,0.7)',
          }}
        />
        Track record · fxmily
      </div>

      {/* Headline */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          color: '#ededf3',
          marginBottom: 36,
        }}
      >
        <span>Les résultats,</span>
        <span
          style={{
            backgroundImage: 'linear-gradient(90deg, #60a5fa 0%, #0085ff 100%)',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          en clair.
        </span>
      </div>

      {/* Sub-headline */}
      <div
        style={{
          fontSize: 26,
          color: '#c9ced8',
          lineHeight: 1.45,
          maxWidth: 880,
          marginBottom: 'auto',
        }}
      >
        Trades partagés en live · pertes incluses · résultats en %.
      </div>

      {/* Footer pill row */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          marginTop: 56,
          fontSize: 18,
        }}
      >
        {['Trades partagés en live', 'Pertes incluses', 'Performance en %'].map((label) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 999,
              background: '#152207',
              border: '1px solid #20360c',
              color: '#3eae20',
              fontWeight: 500,
            }}
          >
            <div style={{ display: 'flex' }}>✓</div>
            {label}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
