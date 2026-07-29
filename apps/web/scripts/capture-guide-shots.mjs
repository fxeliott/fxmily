#!/usr/bin/env node
/**
 * Régénère les vignettes du guide (J8 scope 2).
 *
 *   pnpm --filter @fxmily/web guide:shots
 *
 * Prérequis : Postgres local en marche (`docker compose -f docker-compose.dev.yml
 * up -d` à la racine) et les navigateurs Playwright installés.
 *
 * Ce lanceur existe pour une raison bête mais réelle : `VAR=1 cmd` n'est pas
 * portable — sur Windows, pnpm passe les scripts à cmd.exe, qui ne comprend pas
 * la syntaxe POSIX. Plutôt que d'ajouter `cross-env` au projet pour une ligne,
 * on pose la variable côté Node et on délègue. Zéro dépendance nouvelle.
 */
import { spawn } from 'node:child_process';

const child = spawn(
  'pnpm',
  [
    'exec',
    'playwright',
    'test',
    'guide-surfaces-walk',
    '--project=chromium',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CAPTURE_GUIDE_SHOTS: '1' },
  },
);

child.on('exit', (code) => process.exit(code ?? 1));
