import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * Apple Touch Icon 180×180. Embarque le vrai logo Fxmily "FK" via
 * lecture build-time du JPG public + base64 (le fichier vit dans
 * `public/logo-fxmily.jpg`). `mix-blend-mode: lighten` élimine le bg
 * pur-noir du JPG sur le fond foncé `#07090f` du PNG généré.
 *
 * `output: 'export'` exécute cette fonction au build (Node fs dispo),
 * émet le PNG dans `out/apple-icon/<hash>.png` qui est servi statiquement
 * par Cloudflare Pages.
 */
export default async function AppleIcon() {
  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-fxmily.png'));
  const logoData = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(70% 70% at 50% 30%, rgba(0,133,255,0.40) 0%, transparent 60%), #07090f',
        padding: 20,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og uses img */}
      <img
        src={logoData}
        alt=""
        width={140}
        height={120}
        style={{
          objectFit: 'contain',
          filter: 'drop-shadow(0 0 24px rgba(0,133,255,0.55))',
        }}
      />
    </div>,
    size,
  );
}
