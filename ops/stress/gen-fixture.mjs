// Génère un fixture JPEG ~5 Mo pour S2 (uploads).
//
// Le fixture imite une capture MT5 réaliste (grande image, bruitée pour
// résister à la compression JPEG et atteindre ~5 Mo). Sortie gitignorée.
//
//   node ops/stress/gen-fixture.mjs                # -> fixtures/proof-5mb.jpg (~5 Mo)
//   node ops/stress/gen-fixture.mjs 8              # -> ~8 Mo
//
// Requiert `sharp` (déjà une dépendance de @fxmily/web). On résout sharp depuis
// le workspace web pour ne pas dépendre d'une install racine.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetMb = Number(process.argv[2] || 5);
const outDir = resolve(__dirname, 'fixtures');
const outPath = resolve(outDir, 'proof-5mb.jpg');

// Résout sharp depuis apps/web (où il est installé), sinon depuis la racine.
const webRequire = createRequire(resolve(__dirname, '../../apps/web/package.json'));
let sharp;
try {
  sharp = webRequire('sharp');
} catch {
  sharp = createRequire(import.meta.url)('sharp');
}

mkdirSync(outDir, { recursive: true });

// Bruit RGB plein cadre : un JPEG de bruit se compresse mal → gros fichier.
// 2600x2600x3 ~= 20 Mo raw ; en JPEG q90 on tombe autour de 4-6 Mo.
const side = 2600;
const raw = Buffer.allocUnsafe(side * side * 3);
for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;

const info = await sharp(raw, { raw: { width: side, height: side, channels: 3 } })
  .jpeg({ quality: 92 })
  .toFile(outPath);

const mb = (info.size / (1024 * 1024)).toFixed(2);
console.log(`fixture écrit: ${outPath} (${mb} Mo, cible ~${targetMb} Mo)`);
if (info.size < 3 * 1024 * 1024) {
  console.warn('⚠ fixture < 3 Mo — augmente `side` ou la quality pour un test réaliste.');
}
