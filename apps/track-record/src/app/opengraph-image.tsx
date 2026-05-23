import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// T0.5b — généré au build (`output: 'export'`), embarque le vrai logo Fxmily.
// Sortie dans `out/opengraph-image/<hash>.png` pour social shares
// (Twitter / Facebook / LinkedIn / Discord).
export const dynamic = 'force-static';
export const alt = 'Fxmily · Track record public';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-fxmily.png'));
  const logoData = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background:
          'radial-gradient(60% 60% at 18% 35%, rgba(0,133,255,0.32) 0%, transparent 60%), radial-gradient(50% 50% at 85% 70%, rgba(0,133,255,0.20) 0%, transparent 60%), #0b0e14',
        padding: 80,
        color: '#ededf3',
        fontFamily: 'system-ui',
      }}
    >
      {/* Left column — text */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 24,
        }}
      >
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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 88,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            color: '#ededf3',
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
        <div style={{ fontSize: 24, color: '#c9ced8', lineHeight: 1.45, maxWidth: 600 }}>
          Trades partagés en live · pertes incluses · résultats en %.
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 16 }}>
          {['Trades partagés en live', 'Pertes incluses', '% jamais €'].map((label) => (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 999,
                background: '#152207',
                border: '1px solid #20360c',
                color: '#3eae20',
                fontWeight: 500,
                fontSize: 16,
              }}
            >
              <div style={{ display: 'flex' }}>✓</div>
              {label}
            </div>
          ))}
        </div>
      </div>
      {/* Right column — real logo + halo */}
      <div
        style={{
          width: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og uses img */}
        <img
          src={logoData}
          alt=""
          width={300}
          height={260}
          style={{
            objectFit: 'contain',
            filter:
              'drop-shadow(0 0 48px rgba(0,133,255,0.55)) drop-shadow(0 8px 24px rgba(0,0,0,0.4))',
          }}
        />
      </div>
    </div>,
    size,
  );
}
