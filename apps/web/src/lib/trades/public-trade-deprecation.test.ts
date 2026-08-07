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
 * Record public a quitté ce dépôt pour `fxeliott/trackrecord-fxmily`. Faits
 * vérifiés le 2026-08-07 :
 *
 *   1. La vitrine publique lit une base **Neon** distincte, pas celle de
 *      Fxmily — `trackrecord-fxmily/scripts/sync-trades.ts` importe
 *      `@neondatabase/serverless` et se connecte à `…neon.tech`. Supprimer ces
 *      tables ici ne casserait donc pas le site.
 *   2. Le code applicatif (`src/**`) ne touche **jamais** ces tables.
 *
 * **La suppression n'a pourtant PAS été faite, et c'est délibéré.** Un `DROP
 * TABLE` part automatiquement en production au déploiement suivant
 * (`prisma migrate deploy`), il est irréversible, et le nombre de lignes
 * réellement présentes en base de production n'a pas pu être mesuré depuis
 * cette session. Détruire des données qu'on n'a pas regardées n'est pas une
 * décision, c'est un pari. La recette de suppression reste écrite dans
 * `schema.prisma` et dans `docs/runbook-hetzner-deploy.md` §21.
 *
 * ## ⚠️ Une affirmation de ce fichier était FAUSSE, et elle est retirée
 *
 * Le premier jet écrivait que `scripts/import-fxmily-trades.ts` était
 * « structurellement inopérant, son fichier d'entrée vivait dans
 * `apps/track-record/` », disparu du monorepo. C'est faux : le script lit
 * `process.env.FXMILY_TRADES_JSON` avec un chemin local par défaut
 * (`import-fxmily-trades.ts:119`). Il est **exécutable aujourd'hui**, et il
 * fait `db.publicTrade.deleteMany({})` puis `createMany` (`:202`, `:206`).
 *
 * Une revue en contexte frais l'a trouvé — et a trouvé du même coup que le
 * balayage ne pouvait pas le voir : il était scopé à `src/`, alors que le seul
 * endroit du dépôt qui écrit encore ces tables est `scripts/`. La garde
 * regardait précisément là où il n'y avait rien.
 *
 * Le balayage couvre donc maintenant `src/` **et** `scripts/`, et détecte
 * aussi le SQL brut (`public_trades`), qu'aucune expression Prisma n'attrape.
 * Les deux seuls fichiers autorisés sont nommés un par un ci-dessous, avec
 * leur raison — une exception anonyme est une porte, une exception nommée est
 * une dette qu'on peut solder.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const SCHEMA = join(WEB, 'prisma/schema.prisma');
const SWEPT_ROOTS = ['src', 'scripts'];

/** Accès applicatif aux tables dépréciées, sous ses deux formes Prisma. */
const APPLICATION_ACCESS = /\b(?:db|prisma|tx)\.publicTrade(?:Partial)?\b/;

/**
 * Accès par SQL brut, qu'aucune expression sur le client Prisma n'attrape.
 *
 * Le nom de table doit être précédé d'un mot-clé SQL. Sans cette exigence, la
 * garde se fait berner par les commentaires qui DÉCRIVENT la dépréciation —
 * `auth/audit.ts:606` en contient un, et il a fait rougir le premier jet.
 * C'est le piège déjà consigné au J8 : une garde de proximité bernée par sa
 * propre documentation.
 *
 * Contrepartie assumée : un commentaire qui écrirait littéralement
 * « FROM public_trades » déclencherait encore. C'est le bon sens de l'erreur —
 * mieux vaut une exception à nommer qu'un accès manqué.
 */
const RAW_SQL_ACCESS = /\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+"?public_trade(?:s|_partials)\b/i;

/**
 * Fichiers autorisés à mentionner ces tables, et pourquoi. Toute autre
 * occurrence fait rougir.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    'src/lib/trades/public-trade-deprecation.test.ts',
    'ce fichier : il ne peut pas se dénoncer lui-même.',
  ],
  [
    'scripts/import-fxmily-trades.ts',
    "script d'import historique du Track Record, aujourd'hui hébergé dans un AUTRE dépôt sur une base Neon distincte. Il n'est appelé par rien (ni package.json, ni CI, ni cron) mais il reste EXÉCUTABLE et il commence par un `deleteMany({})`. Il est laissé en place parce que le supprimer sort du périmètre de ce jalon, et signalé ici pour que ce ne soit pas silencieux : c'est le seul écrivain restant.",
  ],
  [
    'scripts/data-hygiene.ts',
    "COMPTE les lignes restantes en SQL brut (lecture seule) — c'est précisément l'outil qui permettra de mesurer la production avant un éventuel DROP. Il n'écrit jamais dans ces tables.",
  ],
]);

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
  const files = SWEPT_ROOTS.flatMap((root) =>
    walk(join(WEB, root)).map((f) => f.slice(WEB.length).replaceAll('\\', '/').replace(/^\/+/, '')),
  );

  it('sweeps a real source tree, including scripts/ (falsification control)', () => {
    // Un balayage vide passerait les tests suivants sans rien prouver.
    expect(files.length).toBeGreaterThan(200);
    // Et il doit VRAIMENT atteindre `scripts/` : c'est l'angle mort qui avait
    // laissé passer le seul écrivain restant.
    expect(files.filter((f) => f.startsWith('scripts/')).length).toBeGreaterThan(0);
    expect(files).toContain('scripts/import-fxmily-trades.ts');
  });

  it('has zero unlisted access to the deprecated tables (Prisma or raw SQL)', () => {
    const offenders = files.filter((f) => {
      if (ALLOWED.has(f)) return false;
      const source = readFileSync(join(WEB, f), 'utf8');
      return APPLICATION_ACCESS.test(source) || RAW_SQL_ACCESS.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('keeps every exception real (a stale allowance is an open door)', () => {
    // Une exception qui ne correspond plus à aucun accès doit être retirée,
    // sans quoi la liste devient un fourre-tout que personne ne relit.
    for (const [path] of ALLOWED) {
      if (path.endsWith('public-trade-deprecation.test.ts')) continue;
      expect(files, `${path} n'existe plus : retirer son exception`).toContain(path);
      const source = readFileSync(join(WEB, path), 'utf8');
      expect(
        APPLICATION_ACCESS.test(source) || RAW_SQL_ACCESS.test(source),
        `${path} ne touche plus ces tables : retirer son exception`,
      ).toBe(true);
    }
  });

  /**
   * La garde du J8 qu'il ne faut pas refaire : une expression de détection
   * qu'aucun test n'exerce finit par ne plus rien détecter. On lui donne donc
   * les deux formes qui comptent, et les deux qui doivent rester muettes.
   */
  it('detects real access and stays quiet on prose (the detector is tested)', () => {
    expect(APPLICATION_ACCESS.test('await db.publicTrade.deleteMany({})')).toBe(true);
    expect(APPLICATION_ACCESS.test('await tx.publicTradePartial.create({})')).toBe(true);
    expect(RAW_SQL_ACCESS.test('SELECT COUNT(*) FROM public_trades')).toBe(true);
    expect(RAW_SQL_ACCESS.test('DELETE FROM public_trade_partials WHERE 1=1')).toBe(true);
    expect(RAW_SQL_ACCESS.test('INSERT INTO "public_trades" (id) VALUES (1)')).toBe(true);

    // Prose : ce sont les mentions qui DOCUMENTENT la dépréciation. Les
    // confondre avec un accès, c'est rendre la garde inutilisable — et donc,
    // à terme, la désarmer.
    expect(RAW_SQL_ACCESS.test('no application code touches `public_trades` anymore')).toBe(false);
    expect(RAW_SQL_ACCESS.test('les slugs `admin.public_trade.*` ont été retirés')).toBe(false);
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
