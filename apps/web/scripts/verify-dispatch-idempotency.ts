/**
 * J10 correctif n°6 — preuve d'exécution de l'idempotence des envois, contre un
 * VRAI Postgres.
 *
 * Le banc unitaire (`src/lib/email/dispatch-claim.test.ts`) vérifie le
 * mécanisme avec un client Prisma simulé. Il ne peut PAS prouver ce qui compte
 * vraiment ici : que la contrainte unique tient sous concurrence réelle. Un
 * test qui simule la base modéliserait l'hypothèse qu'il est censé vérifier.
 *
 * Ce script exerce donc les situations qui décident du sort d'un membre :
 *
 *   1. Deux réservations lancées EN MÊME TEMPS   -> une seule gagne.
 *   2. Un envoi confirmé, puis une relance        -> refus « déjà envoyé ».
 *   3. Un envoi échoué (réservation libérée)      -> la relance repasse.
 *   4. Une réservation abandonnée (bail expiré)   -> reprenable, mais pas avant.
 *
 * Usage (base LOCALE uniquement), depuis la racine du dépôt :
 *   DATABASE_URL=postgresql://…@localhost:5432/… \
 *     pnpm --filter @fxmily/web exec tsx scripts/verify-dispatch-idempotency.ts
 *
 * Le script REFUSE de tourner ailleurs que sur localhost : il écrit et
 * supprime des lignes, ce qui n'a rien à faire sur une base de production.
 *
 * ## Il exerce le VRAI code, il ne le recopie pas
 *
 * Le premier jet refrappait la requête SQL et redéclarait la durée du bail,
 * avec un commentaire « réplique EXACTE ». Une revue en contexte frais a
 * montré ce que cela valait : le banc prouvait la sémantique
 * `ON CONFLICT … WHERE` de Postgres, pas le code qui part en production —
 * modifier le bail dans le vrai module ne le faisait pas broncher.
 *
 * Il importe donc `lib/email/dispatch-claim-core`, où vit l'unique écriture de
 * la requête, et lui passe son propre client. `@/lib/db` reste hors d'atteinte
 * (barrière `server-only`) ; c'est justement pour ça que le cœur prend le
 * client en paramètre.
 */

import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';

import {
  DISPATCH_CLAIM_STALE_AFTER_MS,
  claimEmailDispatchOn,
  markDispatchDeliveredOn,
  releaseEmailDispatchOn,
} from '../src/lib/email/dispatch-claim-core';
import { PrismaClient } from '../src/generated/prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL === undefined || DATABASE_URL === '') {
  console.error('FAIL: DATABASE_URL manquant.');
  process.exit(1);
}
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL)) {
  console.error('FAIL: ce banc écrit en base — refusé hors localhost.');
  process.exit(1);
}

/** La MÊME constante que la production — plus de doublon à maintenir. */
const STALE_MS = DISPATCH_CLAIM_STALE_AFTER_MS;
const TYPE = 'monthly_debrief_ready';
const PERIOD = '2026-08-01';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

/** Appelle le code de production, sur cette base-ci. */
async function claim(userId: string, now: Date = new Date()): Promise<string | null> {
  const result = await claimEmailDispatchOn(db, { userId, type: TYPE, period: PERIOD, now });
  return result.ok ? result.claimId : null;
}

let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label} (attendu=${String(expected)}, obtenu=${String(actual)})`,
  );
}

const userId = `j10-idem-${randomUUID()}`;

try {
  await db.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      firstName: 'Banc',
      lastName: 'J10',
      role: 'member',
      status: 'active',
    },
  });

  // --- 1. Concurrence : deux réservations simultanées, une seule gagne.
  const [a, b] = await Promise.all([claim(userId), claim(userId)]);
  check('1. deux reservations concurrentes -> un seul gagnant', [a, b].filter(Boolean).length, 1);

  const winner = a ?? b;
  if (winner === null)
    throw new Error('aucune réservation accordée : le banc ne peut rien prouver');

  // --- 2. Envoi confirmé -> toute relance est refusée, même après le bail.
  // La confirmation passe par le code de production, pas par un `update` à la
  // main : c'est `markDispatchDeliveredOn` qui doit rendre la ligne définitive.
  await markDispatchDeliveredOn(db, winner);
  check('2. apres confirmation, une relance immediate est refusee', await claim(userId), null);
  check(
    '2b. apres confirmation, une relance TRES tardive reste refusee',
    await claim(userId, new Date(Date.now() + STALE_MS * 4)),
    null,
  );

  // --- 2c. Une réservation CONFIRMÉE ne se libère pas : `releaseEmailDispatch`
  // ne doit jamais effacer un envoi déjà parti (sinon le membre serait
  // re-notifié à la prochaine passe).
  await releaseEmailDispatchOn(db, winner);
  check(
    '2c. la liberation ne touche pas un envoi confirme',
    await db.emailDispatchClaim.count({ where: { userId, deliveredAt: { not: null } } }),
    1,
  );

  // --- 3. Envoi échoué : la réservation est libérée, la relance repasse.
  // Remise en scène (pas le comportement testé) : on repart d'une base propre.
  await db.emailDispatchClaim.deleteMany({ where: { userId } });
  const toRelease = await claim(userId);
  if (toRelease === null) throw new Error('réservation initiale refusée : le banc est faussé');
  await releaseEmailDispatchOn(db, toRelease);
  const afterRelease = await claim(userId);
  check('3. apres liberation, la relance obtient la reservation', afterRelease !== null, true);
  if (afterRelease === null) throw new Error('libération non reprise : la suite serait fausse');

  // --- 4. Réservation abandonnée : reprenable une fois le bail expiré…
  // On décale l'HORLOGE passée au code plutôt que de trafiquer la ligne : la
  // reprise doit venir de la requête elle-même, pas d'une mise en scène.
  check(
    '4. une reservation abandonnee est reprise apres le bail',
    (await claim(userId, new Date(Date.now() + STALE_MS + 60_000))) !== null,
    true,
  );

  // --- 4b. …mais PAS avant : une réservation fraîche n'est jamais doublée.
  check('4b. une reservation fraiche n est jamais doublee', await claim(userId), null);

  check(
    'invariant : une seule ligne pour (membre, type, periode)',
    await db.emailDispatchClaim.count({ where: { userId } }),
    1,
  );
} finally {
  await db.emailDispatchClaim.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
}

console.log(
  failures === 0 ? `\nRESULT: ${checks}/${checks} pass` : `\nRESULT: ${failures}/${checks} FAIL`,
);
process.exit(failures === 0 ? 0 : 1);
