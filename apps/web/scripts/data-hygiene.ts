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
 * `exitedAt > closedAt + tolérance` : la sortie DÉCLARÉE est postérieure à
 * l'instant où le membre a ENREGISTRÉ la clôture, au-delà de ce qu'une horloge
 * mal réglée explique. C'est impossible dans le monde réel — on ne peut pas
 * enregistrer une sortie avant qu'elle ait eu lieu. C'est la trace exacte du
 * défaut corrigé par ce jalon : le formulaire pré-remplissait
 * `max(maintenant, entrée + 1 h)`, donc tout trade clôturé moins d'une heure
 * après son ouverture repartait avec une sortie dans le futur si le membre ne
 * corrigeait pas la valeur.
 *
 * ⚠️ La tolérance n'est PAS un détail, et elle n'est pas redéclarée ici : elle
 * vient de `lib/schemas/clock-skew`, la même que celle qui autorise la saisie.
 * Sans elle, ce script traiterait comme aberrante toute clôture normale faite
 * depuis un appareil en avance de quelques minutes — il « corrigerait » des
 * lignes saines, ce qui est exactement ce qu'un outil d'hygiène ne doit jamais
 * faire. Un seuil plus large que la saisie serait tout aussi faux dans l'autre
 * sens : il laisserait passer des aberrations réelles.
 *
 * ## Ce que la correction fait, et ce qu'elle ne peut pas faire
 *
 * La vraie heure de sortie est INCONNUE — elle n'a jamais été saisie. On ramène
 * donc `exitedAt` à **`GREATEST(closedAt, enteredAt)`** : l'instant où le membre
 * était devant son écran en train de clôturer, sans jamais descendre sous
 * l'entrée. Ce n'est pas la vérité, c'est la valeur la plus proche qu'on puisse
 * justifier, et elle garantit une durée de trade **non négative**.
 *
 * ⚠️ Le `GREATEST` n'est PAS une précaution théorique — sans lui, ce script
 * fabriquait la corruption qu'il prétend réparer, et précisément sur la
 * population qu'il vise EN PREMIER. Deux revues indépendantes l'ont trouvé.
 * Le scénario, avec l'ancienne tolérance d'une heure côté entrée :
 *
 *   entrée déclarée   = maintenant + 45 min   (le schéma l'acceptait)
 *   clôture immédiate → closed_at = maintenant, exited_at pré-rempli à
 *                       max(maintenant, entrée + 1 h) = maintenant + 1 h 45
 *
 * La ligne est bien aberrante. Mais `SET exited_at = closed_at` l'aurait
 * ramenée à `maintenant`, soit **45 minutes AVANT son entrée** — une durée de
 * trade négative, c'est-à-dire une corruption qu'aucun chemin d'écriture de
 * l'app ne peut produire, introduite par l'outil censé nettoyer. Le critère de
 * détection utilise la même borne, pour que le compte final puisse retomber
 * à zéro au lieu de boucler sur les lignes que l'outil vient de « réparer ».
 *
 * `realizedR`, `outcome` et tout le reste sont laissés INTACTS : ils ne
 * dépendent pas de l'heure de sortie.
 *
 * Instancie son propre `PrismaClient` : `@/lib/db` est `server-only` et tsx ne
 * peut pas charger cette barrière RSC (pattern des autres scripts du dépôt).
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { CLOCK_SKEW_TOLERANCE_MS } from '../src/lib/schemas/clock-skew';

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

/** Même tolérance que la saisie — voir l'en-tête. Exprimée en secondes pour SQL. */
const SKEW_SECONDS = CLOCK_SKEW_TOLERANCE_MS / 1000;

/** Trades dont la sortie déclarée est postérieure à leur enregistrement. */
async function countFutureExits(): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM trades
    WHERE closed_at IS NOT NULL
      AND exited_at IS NOT NULL
      AND exited_at > GREATEST(closed_at, entered_at) + make_interval(secs => ${SKEW_SECONDS})
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Répartition de l'écart, pour savoir à quoi on a affaire avant de corriger.
 *
 * L'écart mesuré ici est CELUI DU CRITÈRE — `exited_at - GREATEST(closed_at,
 * entered_at)` — et pas `exited_at - closed_at`. Les deux avaient divergé : le
 * `WHERE` sélectionnait sur l'un pendant que les tranches affichaient l'autre,
 * si bien que « écart max 105 min » annonçait un écart que la correction
 * n'allait pas refermer (elle en refermait 60). Un même nombre ne peut pas
 * avoir deux définitions dans une seule sortie.
 */
async function describeFutureExits(): Promise<void> {
  const rows = await db.$queryRaw<{ bucket: string; n: bigint; max_minutes: number | null }[]>`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (exited_at - GREATEST(closed_at, entered_at))) <= 300   THEN 'a. <= 5 min'
        WHEN EXTRACT(EPOCH FROM (exited_at - GREATEST(closed_at, entered_at))) <= 3600  THEN 'b. 5 min - 1 h'
        WHEN EXTRACT(EPOCH FROM (exited_at - GREATEST(closed_at, entered_at))) <= 86400 THEN 'c. 1 h - 24 h'
        ELSE 'd. > 24 h'
      END AS bucket,
      COUNT(*)::bigint AS n,
      MAX(EXTRACT(EPOCH FROM (exited_at - GREATEST(closed_at, entered_at))) / 60)::float AS max_minutes
    FROM trades
    WHERE closed_at IS NOT NULL AND exited_at IS NOT NULL
      AND exited_at > GREATEST(closed_at, entered_at) + make_interval(secs => ${SKEW_SECONDS})
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

/**
 * Trades dont l'ENTRÉE déclarée est postérieure à l'enregistrement — la
 * sous-population que cette commande ne répare PAS, et qu'il serait malhonnête
 * de laisser croire propre.
 *
 * Pourquoi elle existe : jusqu'au durcissement J10, l'ouverture tolérait une
 * heure d'avance sur `enteredAt`. Une ligne saisie ainsi puis clôturée avant
 * cette date porte `entered_at > closed_at`.
 *
 * Pourquoi la commande ne la touche pas : ramener `exited_at` à `closed_at`
 * fabriquerait une durée négative — c'est précisément le défaut que la borne
 * `GREATEST` ferme. Mais `GREATEST` a un effet de bord qu'il faut dire tout
 * haut : ces lignes sortent du compte « sortie postérieure à la clôture » et
 * le total affiche zéro alors que leur `entered_at` reste faux. Réparer cela
 * demande de décider quoi faire de `entered_at` lui-même — ce qu'aucun script
 * ne devrait trancher seul, faute de savoir ce que le membre a vraiment vécu.
 *
 * Donc : compté, affiché, jamais absorbé en silence.
 */
async function countFutureEntries(): Promise<{ n: number; worstMinutes: number | null }> {
  const rows = await db.$queryRaw<{ n: bigint; worst: number | null }[]>`
    SELECT
      COUNT(*)::bigint AS n,
      MAX(EXTRACT(EPOCH FROM (entered_at - closed_at)) / 60)::float AS worst
    FROM trades
    WHERE closed_at IS NOT NULL
      AND entered_at > closed_at + make_interval(secs => ${SKEW_SECONDS})
  `;
  return { n: Number(rows[0]?.n ?? 0), worstMinutes: rows[0]?.worst ?? null };
}

/** Affiche la sous-population non réparée, en disant qu'elle ne l'est pas. */
async function reportFutureEntries(): Promise<void> {
  const { n, worstMinutes } = await countFutureEntries();
  if (n === 0) {
    console.log("[correctif 2 bis] aucune ligne dont l'entrée précède son enregistrement.");
    return;
  }
  const worst = worstMinutes === null ? 'n/a' : `${Math.round(worstMinutes)} min`;
  console.log(
    `[correctif 2 bis] ${n} trade(s) dont l'ENTRÉE est postérieure à l'enregistrement ` +
      `(au pire ${worst} d'avance). Cette commande ne les corrige PAS : ramener leur ` +
      `sortie créerait une durée négative. Elles sortent aussi du compte ci-dessus — ` +
      `un zéro plus haut ne veut donc pas dire « base saine ».`,
  );
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
    await reportFutureEntries();

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
    await reportFutureEntries();

    if (!apply) {
      console.log(
        `\nESSAI À BLANC — rien n'a été écrit. ${before} ligne(s) seraient corrigées ` +
          `(exited_at ramené à GREATEST(closed_at, entered_at), jamais sous l'entrée). ` +
          `Relance avec --apply pour appliquer.`,
      );
    } else {
      // Journal AVANT écriture : l'ancienne valeur n'existe nulle part
      // ailleurs, et un `UPDATE` en masse ne se défait pas. Ces lignes sont la
      // seule façon de revenir en arrière si la décision se révélait mauvaise —
      // elles sont donc imprimées, à conserver avec la sortie de la commande.
      const doomed = await db.$queryRaw<{ id: string; exited_at: Date; target: Date }[]>`
        SELECT id, exited_at, GREATEST(closed_at, entered_at) AS target
        FROM trades
        WHERE closed_at IS NOT NULL
          AND exited_at IS NOT NULL
          AND exited_at > GREATEST(closed_at, entered_at) + make_interval(secs => ${SKEW_SECONDS})
        ORDER BY id
      `;
      console.log('\nLignes modifiées (anciennes valeurs — à conserver pour un retour arrière) :');
      for (const row of doomed) {
        console.log(
          `  ${row.id}  exited_at ${row.exited_at.toISOString()} -> ${row.target.toISOString()}`,
        );
      }
      if (doomed.length === 0) console.log('  (aucune)');

      const updated = await db.$executeRaw`
        UPDATE trades
        SET exited_at = GREATEST(closed_at, entered_at)
        WHERE closed_at IS NOT NULL
          AND exited_at IS NOT NULL
          AND exited_at > GREATEST(closed_at, entered_at) + make_interval(secs => ${SKEW_SECONDS})
      `;
      const after = await countFutureExits();
      console.log(`\nAPPLIQUÉ : ${updated} ligne(s) mises à jour`);
      console.log(`APRÈS  : ${after} trade(s) restants (attendu : 0)`);

      // Le journal et l'écriture sont deux allers-retours distincts : une ligne
      // devenue éligible entre les deux serait écrasée SANS figurer au journal,
      // ce qui viderait de son sens la promesse « voici de quoi revenir en
      // arrière ». Les deux comptes existent déjà — les comparer rend le trou
      // visible au lieu de le laisser muet.
      if (updated !== doomed.length) {
        console.error(
          `FAIL: ${updated} ligne(s) écrites mais ${doomed.length} journalisée(s). ` +
            `Des lignes ont changé pendant l'opération : le journal ci-dessus est INCOMPLET.`,
        );
        process.exit(1);
      }
      if (after !== 0) {
        console.error('FAIL: des écarts subsistent après correction.');
        process.exit(1);
      }

      // Garde de non-corruption, vérifiée SUR LA BASE et pas dans un
      // commentaire : aucune ligne ne doit sortir d'ici avec une sortie
      // antérieure à son entrée. C'est le défaut exact que la version
      // précédente de ce script pouvait créer ; le contrôle reste en place
      // même une fois la cause fermée, parce qu'un outil d'écriture doit
      // prouver son invariant à chaque exécution, pas une fois en revue.
      //
      // Le contrôle porte sur LES LIGNES QUE CE RUN A ÉCRITES, pas sur toute la
      // table. La version globale mélangeait deux choses : « mon écriture a
      // corrompu des données » et « la table contenait déjà une anomalie
      // étrangère ». Elle affichait alors « NE PAS relancer, investiguer »
      // après une réparation parfaitement réussie — un message faux, dans la
      // direction prudente, mais faux quand même. Un opérateur qui reçoit un
      // FAIL doit pouvoir en déduire ce qui s'est passé.
      const doomedIds = doomed.map((r) => r.id);
      const negatives =
        doomedIds.length === 0
          ? []
          : await db.$queryRaw<{ id: string }[]>`
              SELECT id FROM trades
              WHERE id = ANY(${doomedIds})
                AND exited_at IS NOT NULL AND exited_at < entered_at
            `;
      console.log(
        `CONTRÔLE : ${negatives.length} ligne(s) écrite(s) avec une durée négative (attendu : 0)`,
      );
      if (negatives.length !== 0) {
        console.error(
          `FAIL: cette écriture a produit ${negatives.length} durée(s) négative(s) ` +
            `(${negatives.map((r) => r.id).join(', ')}) — NE PAS relancer, investiguer.`,
        );
        process.exit(1);
      }

      // Les anomalies préexistantes sont dites, sans faire échouer le run :
      // elles ne viennent pas d'ici, et les taire reviendrait à laisser croire
      // que la table est saine parce que cette commande s'est bien passée.
      const foreign = await db.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n
        FROM trades
        WHERE exited_at IS NOT NULL AND exited_at < entered_at
          ${doomedIds.length === 0 ? Prisma.empty : Prisma.sql`AND NOT (id = ANY(${doomedIds}))`}
      `;
      const foreignCount = Number(foreign[0]?.n ?? 0);
      if (foreignCount > 0) {
        console.warn(
          `OBSERVATION : ${foreignCount} trade(s) portaient DÉJÀ une durée négative, ` +
            `hors des lignes touchées ici. Non corrigés par cette commande, à investiguer à part.`,
        );
      }
    }
  }
} finally {
  await db.$disconnect();
}
