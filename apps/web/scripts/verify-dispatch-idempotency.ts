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
 * Instancie son propre `PrismaClient` (pattern des autres scripts du dépôt) :
 * `@/lib/db` est `server-only` et tsx ne peut pas charger cette barrière RSC.
 */

import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';

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

/** Doit rester aligné sur `DISPATCH_CLAIM_STALE_AFTER_MS`. */
const STALE_MS = 30 * 60 * 1000;
const TYPE = 'monthly_debrief_ready';
const PERIOD = '2026-08-01';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

/** Réplique EXACTE de la requête de `lib/email/dispatch-claim.ts`. */
async function claim(userId: string, now: Date = new Date()): Promise<string | null> {
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO email_dispatch_claims (id, user_id, type, period, claimed_at, created_at)
    VALUES (${randomUUID()}, ${userId}, ${TYPE}, ${PERIOD}, ${now}, ${now})
    ON CONFLICT (user_id, type, period) DO UPDATE
      SET claimed_at = ${now}
      WHERE email_dispatch_claims.delivered_at IS NULL
        AND email_dispatch_claims.claimed_at < ${staleBefore}
    RETURNING id
  `;
  return rows[0]?.id ?? null;
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
  await db.emailDispatchClaim.update({ where: { id: winner }, data: { deliveredAt: new Date() } });
  check('2. apres confirmation, une relance immediate est refusee', await claim(userId), null);
  check(
    '2b. apres confirmation, une relance TRES tardive reste refusee',
    await claim(userId, new Date(Date.now() + STALE_MS * 4)),
    null,
  );

  // --- 3. Envoi échoué : la réservation est libérée, la relance repasse.
  await db.emailDispatchClaim.deleteMany({ where: { userId, deliveredAt: { not: null } } });
  const afterRelease = await claim(userId);
  check('3. apres liberation, la relance obtient la reservation', afterRelease !== null, true);
  if (afterRelease === null) throw new Error('libération non reprise : la suite serait fausse');

  // --- 4. Réservation abandonnée : reprenable une fois le bail expiré…
  await db.emailDispatchClaim.update({
    where: { id: afterRelease },
    data: { claimedAt: new Date(Date.now() - STALE_MS - 60_000) },
  });
  check(
    '4. une reservation abandonnee est reprise apres le bail',
    (await claim(userId)) !== null,
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
