/**
 * Generate PWA icons (Tour 15) — maskable + any, 192 + 512.
 *
 * The manifest needs real raster squares for the Android "Add to Home Screen"
 * install path (maskable adaptive icons) and iOS home screen. Rather than a
 * runtime ImageResponse (cold-start per install, edge tracing risk under
 * `output: standalone`), we rasterise a single SVG source with sharp — already
 * a direct dependency — into static PNGs served from `public/`. Deterministic,
 * cacheable, no font/binary fetch at request time.
 *
 * Maskable safe zone (W3C): the launcher may clip to a circle. The visible
 * "minimum safe area" is the centre 80% diameter. We keep the FX monogram
 * well inside that circle (~52% of the canvas) over a full-bleed deep-space
 * background, so no launcher mask ever cuts the mark.
 *
 * Run: `node scripts/generate-pwa-icons.mjs` (from apps/web). Re-run after a
 * brand/colour change; commit the PNGs.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

// Single source of truth for the mark (kept in sync with brand-mark.tsx).
const FX_VIEWBOX = '118 115 363 295';
const FX_PATH =
  'M 143.142 132.159 C 140.745 133.345, 137.482 136.112, 135.892 138.308 C 133.012 142.284, 133 142.361, 133 157.150 L 133 172 210.939 172 L 288.878 172 298.069 161.750 C 303.124 156.112, 311.752 146.662, 317.242 140.750 L 327.223 130 237.361 130.001 L 147.500 130.002 143.142 132.159 M 402.428 136.741 C 397.036 142.873, 391.400 149.108, 366.488 176.500 C 361.986 181.450, 352.981 191.575, 346.477 199 C 339.973 206.425, 330.536 217, 325.506 222.500 C 297.210 253.440, 278.555 273.728, 261.561 292.042 C 244.343 310.598, 224.114 332.563, 198.514 360.500 C 189.331 370.522, 173.168 388.551, 169.595 392.757 L 167.690 395 196.285 395 L 224.881 395 233.690 384.849 C 238.536 379.265, 246.325 370.595, 251 365.581 C 280.992 333.416, 309.678 302.429, 310.711 301.081 C 311.751 299.723, 315.780 303.383, 339.247 327 C 354.276 342.125, 375.458 363.619, 386.319 374.765 L 406.066 395.030 435.473 394.765 L 464.880 394.500 402.990 332 C 368.950 297.625, 341.077 269.134, 341.050 268.687 C 341.022 268.239, 344.262 264.404, 348.250 260.163 C 363.227 244.236, 396.868 207.341, 400.120 203.276 C 403.302 199.299, 408.393 193.724, 435.526 164.500 C 454.360 144.215, 466 131.275, 466 130.623 C 466 130.280, 453.030 130, 437.178 130 L 408.355 130 402.428 136.741 M 133.032 311.750 C 133.057 376.215, 133.321 393.166, 134.282 391.920 C 134.952 391.051, 138.197 386.776, 141.492 382.420 C 144.788 378.064, 153.670 367.214, 161.230 358.309 L 174.975 342.117 175.237 306.309 L 175.500 270.500 201 270.166 L 226.500 269.832 239 255.880 C 245.875 248.206, 253.905 239.244, 256.845 235.964 L 262.190 230 197.595 230 L 133 230 133.032 311.750';

const BG = '#07090f'; // DS deep-space (--bg family)
const MARK = '#ecedf2'; // --t-1 primary text on dark

/**
 * Build an SVG string for a given canvas size and mark scale (0..1 of canvas).
 * `rounded` adds a rounded-square backplate (the `any` purpose variant looks
 * polished when the launcher does NOT mask it). Maskable stays full-bleed.
 */
function buildSvg({ size, markScale, rounded }) {
  const markW = size * markScale;
  // Preserve the mark aspect ratio (viewBox 363×295).
  const markH = (markW * 295) / 363;
  const x = (size - markW) / 2;
  const y = (size - markH) / 2;
  const radius = rounded ? Math.round(size * 0.22) : 0;
  const glow = Math.round(size * 0.42);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="g" cx="18%" cy="10%" r="75%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.30"/>
      <stop offset="55%" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BG}"/>
  <circle cx="${size * 0.18}" cy="${size * 0.1}" r="${glow}" fill="url(#g)"/>
  <svg x="${x}" y="${y}" width="${markW}" height="${markH}" viewBox="${FX_VIEWBOX}">
    <path fill-rule="evenodd" d="${FX_PATH}" fill="${MARK}"/>
  </svg>
</svg>`;
}

const targets = [
  // Maskable: full-bleed bg, mark kept small enough to survive the 80% circle mask.
  { file: 'icon-maskable-192.png', size: 192, markScale: 0.5, rounded: false },
  { file: 'icon-maskable-512.png', size: 512, markScale: 0.5, rounded: false },
  // Any: rounded-square backplate, mark a touch larger (no mask to worry about).
  { file: 'icon-192.png', size: 192, markScale: 0.62, rounded: true },
  { file: 'icon-512.png', size: 512, markScale: 0.62, rounded: true },
];

for (const t of targets) {
  const svg = buildSvg(t);
  const out = resolve(PUBLIC_DIR, t.file);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
