/**
 * J10 — outil d'hygiène des données. Deux commandes, un seul principe : on
 * compte avant de corriger, et on ne corrige que ce qui est démontrablement
 * faux.
 *
 *   count            Lecture seule. Compte ce que ce jalon a besoin de savoir :
 *                    les trades dont la sortie est postérieure à leur propre
 *                    enregistrement (correctif n°2), et les lignes des tables
 *                    dépréciées `public_trades` (correctif n°5).
 *
 *   fix-exited-at    Corrige les trades du premier compte. ESSAI À BLANC par
 *                    défaut ; il faut `--apply` pour écrire quoi que ce soit.
 *
 * Usage, depuis la racine du dépôt :
 *   DATABASE_URL=… pnpm --filter @fxmily/web exec tsx scripts/data-hygiene.ts count
 *   DATABASE_URL=… pnpm --filter @fxmily/web exec tsx scripts/data-hygiene.ts fix-exited-at
 *   DATABASE_URL=… pnpm --filter @fxmily/web exec tsx scripts/data-hygiene.ts fix-exited-at --apply
 *
 * ## Ce qui est considéré comme faux, et pourquoi
 *
 * `exitedAt > closedAt` : la sortie DÉCLARÉE est postérieure à l'instant où le
 * membre a ENREGISTRÉ la clôture. C'est impossible dans le monde réel — on ne
 * peut pas enregistrer une sortie avant qu'elle ait eu lieu. C'est la trace
 * exacte du défaut corrigé par ce jalon : le formulaire pré-remplissait
 * `max(maintenant, entrée + 1 h)`, donc tout trade clôturé moins d'une heure
 * après son ouverture repartait avec une sortie dans le futur si le membre ne
 * corrigeait pas la valeur.
 *
 * ## Ce que la correction fait, et ce qu'elle ne peut pas faire
 *
 * La vraie heure de sortie est INCONNUE — elle n'a jamais été saisie. La
 * meilleure borne dont on dispose est `closedAt` : l'instant où le membre était
 * devant son écran en train de clôturer. On ramène donc `exitedAt` à `closedAt`.
 * Ce n'est pas la vérité, c'est la valeur la plus proche qu'on puisse justifier,
 * et elle a le mérite de rendre la durée du trade non négative.
 *
 * `realizedR`, `outcome` et tout le reste sont laissés INTACTS : ils ne
 * dépendent pas de l'heure de sortie.
 *
 * Instancie son propre `PrismaClient` : `@/lib/db` est `server-only` et tsx ne
 * peut pas charger cette barrière RSC (pattern des autres scripts du dépôt).
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const command = process.argv[2];
const apply = process.argv.includes('--apply');

if (command !== 'count' && command !== 'fix-exited-at') {
  console.error('Usage: data-hygiene.ts <count|fix-exited-at> [--apply]');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL === undefined || DATABASE_URL === '') {
  console.error('FAIL: DATABASE_URL manquant.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

/** Trades dont la sortie déclarée est postérieure à leur enregistrement. */
async function countFutureExits(): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM trades
    WHERE closed_at IS NOT NULL
      AND exited_at IS NOT NULL
      AND exited_at > closed_at
  `;
  return Number(rows[0]?.n ?? 0);
}

/** Répartition de l'écart, pour savoir à quoi on a affaire avant de corriger. */
async function describeFutureExits(): Promise<void> {
  const rows = await db.$queryRaw<{ bucket: string; n: bigint; max_minutes: number | null }[]>`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (exited_at - closed_at)) <= 300   THEN 'a. <= 5 min'
        WHEN EXTRACT(EPOCH FROM (exited_at - closed_at)) <= 3600  THEN 'b. 5 min - 1 h'
        WHEN EXTRACT(EPOCH FROM (exited_at - closed_at)) <= 86400 THEN 'c. 1 h - 24 h'
        ELSE 'd. > 24 h'
      END AS bucket,
      COUNT(*)::bigint AS n,
      MAX(EXTRACT(EPOCH FROM (exited_at - closed_at)) / 60)::float AS max_minutes
    FROM trades
    WHERE closed_at IS NOT NULL AND exited_at IS NOT NULL AND exited_at > closed_at
    GROUP BY 1
    ORDER BY 1
  `;
  if (rows.length === 0) {
    console.log('  (aucun écart)');
    return;
  }
  for (const r of rows) {
    const worst = r.max_minutes === null ? 'n/a' : `${Math.round(r.max_minutes)} min`;
    console.log(`  ${r.bucket} : ${Number(r.n)} trade(s), écart max ${worst}`);
  }
}

/** Lignes restantes dans les tables du Track Record déprécié (correctif n°5). */
async function countDeprecatedPublicTrades(): Promise<{ trades: number; partials: number }> {
  const t = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM public_trades`;
  const p = await db.$queryRaw<
    { n: bigint }[]
  >`SELECT COUNT(*)::bigint AS n FROM public_trade_partials`;
  return { trades: Number(t[0]?.n ?? 0), partials: Number(p[0]?.n ?? 0) };
}

try {
  if (command === 'count') {
    console.log('=== J10 — état des données (LECTURE SEULE) ===\n');

    const future = await countFutureExits();
    console.log(`[correctif 2] trades dont la sortie est postérieure à leur clôture : ${future}`);
    await describeFutureExits();

    const pub = await countDeprecatedPublicTrades();
    console.log(
      `\n[correctif 5] tables dépréciées : public_trades = ${pub.trades} ligne(s), ` +
        `public_trade_partials = ${pub.partials} ligne(s)`,
    );
    console.log(
      pub.trades === 0 && pub.partials === 0
        ? '  -> vides : une suppression ne détruirait aucune donnée.'
        : '  -> NON vides : ne rien supprimer sans avoir décidé du sort de ces lignes.',
    );
  }

  if (command === 'fix-exited-at') {
    const before = await countFutureExits();
    console.log(`AVANT : ${before} trade(s) avec une sortie postérieure à la clôture`);
    await describeFutureExits();

    if (!apply) {
      console.log(
        `\nESSAI À BLANC — rien n'a été écrit. ${before} ligne(s) seraient corrigées ` +
          `(exited_at ramené à closed_at). Relance avec --apply pour appliquer.`,
      );
    } else {
      const updated = await db.$executeRaw`
        UPDATE trades
        SET exited_at = closed_at
        WHERE closed_at IS NOT NULL
          AND exited_at IS NOT NULL
          AND exited_at > closed_at
      `;
      const after = await countFutureExits();
      console.log(`\nAPPLIQUÉ : ${updated} ligne(s) mises à jour`);
      console.log(`APRÈS  : ${after} trade(s) restants (attendu : 0)`);
      if (after !== 0) {
        console.error('FAIL: des écarts subsistent après correction.');
        process.exit(1);
      }
    }
  }
} finally {
  await db.$disconnect();
}
