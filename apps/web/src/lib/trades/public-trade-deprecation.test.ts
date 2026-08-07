import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * J10 correctif n°5 — la dépréciation de `PublicTrade` / `PublicTradePartial`
 * devient exécutoire au lieu d'être un commentaire.
 *
 * ## Ce qui a été mesuré, et ce qui a été décidé
 *
 * Les deux modèles sont marqués `@deprecated` depuis le 2026-05-25 : le Track
 * Record public a quitté ce dépôt pour `fxeliott/trackrecord-fxmily`. Trois
 * faits vérifiés le 2026-08-07 :
 *
 *   1. La vitrine publique lit une base **Neon** distincte, pas celle de
 *      Fxmily — `trackrecord-fxmily/scripts/sync-trades.ts` importe
 *      `@neondatabase/serverless` et se connecte à `…neon.tech`. Supprimer ces
 *      tables ici ne casserait donc pas le site.
 *   2. `apps/track-record/` n'existe plus dans ce monorepo (`apps/` ne contient
 *      que `web`), ce qui rend le script d'import historique structurellement
 *      inopérant : son fichier d'entrée vivait dans cette sub-app disparue.
 *   3. Le code applicatif (`src/**`) ne touche **jamais** ces tables.
 *
 * **La suppression n'a pourtant PAS été faite, et c'est délibéré.** Un `DROP
 * TABLE` part automatiquement en production au déploiement suivant
 * (`prisma migrate deploy`), il est irréversible, et le nombre de lignes
 * réellement présentes en base de production n'a pas pu être mesuré depuis
 * cette session. Détruire des données qu'on n'a pas regardées n'est pas une
 * décision, c'est un pari. La recette de suppression reste écrite dans
 * `schema.prisma` et dans `docs/runbook-hetzner-deploy.md` §21.
 *
 * Ce test est ce qui manquait : il garantit que la dépréciation ne se dégrade
 * pas pendant qu'elle attend sa suppression.
 */

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));

/** Accès applicatif aux tables dépréciées, sous ses deux formes Prisma. */
const APPLICATION_ACCESS = /\b(?:db|prisma|tx)\.publicTrade(?:Partial)?\b/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      walk(full, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('PublicTrade deprecation is enforced, not merely commented', () => {
  const files = walk(SRC).map((f) => f.slice(SRC.length).replaceAll('\\', '/').replace(/^\/+/, ''));

  it('sweeps a real source tree (falsification control)', () => {
    // Un balayage vide passerait le test suivant sans rien prouver.
    expect(files.length).toBeGreaterThan(200);
  });

  it('has zero application read or write on the deprecated tables', () => {
    const offenders = files.filter((f) => {
      if (f.endsWith('public-trade-deprecation.test.ts')) return false;
      return APPLICATION_ACCESS.test(readFileSync(join(SRC, f), 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('keeps the deprecation notice attached to the models in the schema', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    expect(schema).toContain('model PublicTrade {');
    expect(schema).toContain('@deprecated 2026-05-25');
    // La recette de suppression doit rester lisible à côté des modèles : sans
    // elle, la dépréciation devient un vestige que personne n'ose retirer.
    expect(schema).toContain('DROP TABLE public_trade_partials');
  });
});
