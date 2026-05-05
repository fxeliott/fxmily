// lint-staged — exécuté par Husky sur `git commit`.
//
// Stratégie :
// - Prettier : géré au root (binaire dispo via le workspace pnpm root).
// - ESLint : délégué au workspace `apps/web` via `pnpm --filter`, car le
//   binaire ESLint n'est pas dans le root node_modules. On passe les chemins
//   relatifs au workspace pour qu'ESLint résolve sa config locale.
import path from 'node:path';

const WEB_ROOT = path.join(process.cwd(), 'apps', 'web');

const toRelativeWebPath = (absolute) => path.relative(WEB_ROOT, absolute).replaceAll('\\', '/');

const eslintWebFix = (filenames) => {
  const inWeb = filenames.filter((f) => f.replaceAll('\\', '/').includes('/apps/web/'));
  if (inWeb.length === 0) return [];
  const rels = inWeb.map((f) => `"${toRelativeWebPath(f)}"`).join(' ');
  return [`pnpm --filter @fxmily/web exec eslint --fix ${rels}`];
};

const prettierWrite = (filenames) => {
  const quoted = filenames.map((f) => `"${f}"`).join(' ');
  return [`prettier --write ${quoted}`];
};

export default {
  'apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}': (filenames) => [
    ...prettierWrite(filenames),
    ...eslintWebFix(filenames),
  ],
  '**/*.{ts,tsx,js,jsx,mjs,cjs}': prettierWrite,
  '**/*.{json,md,css,yml,yaml}': prettierWrite,
};
