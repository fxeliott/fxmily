import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@/generated/prisma/client';

/**
 * J10 correctif n°6 — le CŒUR de la réservation d'envoi, sans la barrière RSC.
 *
 * ## Pourquoi ce module existe séparément de `dispatch-claim.ts`
 *
 * Le premier jet mettait toute la logique dans `dispatch-claim.ts`, qui est
 * `server-only`. Le banc runtime (`scripts/verify-dispatch-idempotency.ts`) ne
 * peut pas charger cette barrière, alors il **recopiait la requête SQL à la
 * main**, avec sa propre constante de bail et un commentaire « réplique
 * EXACTE ». Une revue en contexte frais l'a démasqué : ce banc prouvait la
 * sémantique `ON CONFLICT … WHERE` de Postgres, pas le code qui part en
 * production. Changer le bail dans le vrai module ne le faisait pas broncher.
 *
 * C'est la règle de banc que ce dépôt a déjà payée trois fois : **ce que le
 * banc découpe est testé ; ce qu'il refrappe autour ne l'est pas.** Le remède
 * est structurel — le client Prisma devient un paramètre, la barrière
 * `server-only` reste dans le module appelant, et il n'existe plus qu'une
 * seule écriture de la requête, exercée à la fois par les tests unitaires et
 * par le banc contre un vrai Postgres.
 *
 * Le type est importé en `import type` : effacé à la compilation, donc `tsx`
 * n'a aucun alias `@/` à résoudre au moment de lancer le banc.
 */

/**
 * Au-delà de ce délai, une réservation non confirmée est considérée abandonnée
 * (processus tué) et peut être reprise.
 *
 * 30 minutes : un envoi Resend se compte en secondes, donc toute réservation
 * qui traîne une demi-heure est un incident, pas un envoi lent. Assez large
 * pour ne jamais doubler un envoi en cours, assez court pour qu'un membre ne
 * rate pas sa notification à cause d'un redémarrage.
 */
export const DISPATCH_CLAIM_STALE_AFTER_MS = 30 * 60 * 1000;

export type DispatchClaimResult =
  | { ok: true; claimId: string }
  | { ok: false; reason: 'already_delivered' | 'in_flight' };

export interface DispatchClaimInput {
  userId: string;
  /** Type de notification, p. ex. `monthly_debrief_ready`. */
  type: string;
  /** Période couverte, `YYYY-MM-DD` (1er du mois, lundi ISO…). */
  period: string;
  now?: Date;
}

/**
 * Surface Prisma réellement utilisée. Un `Pick` plutôt que le client entier :
 * le banc peut passer sa propre instance, et la signature dit exactement ce
 * que ce module touche en base.
 */
export type DispatchClaimDb = Pick<PrismaClient, '$queryRaw' | 'emailDispatchClaim'>;

/**
 * Réserve l'envoi (userId × type × période), ou refuse.
 *
 * L'insertion et la reprise d'un bail expiré tiennent dans UN seul aller-retour
 * SQL : il n'y a pas de fenêtre « lire puis écrire » où deux exécutions
 * concurrentes du batch pourraient réserver toutes les deux.
 *
 * - `RETURNING` non vide → la réservation est à nous, l'envoi peut partir.
 * - `RETURNING` vide → soit l'envoi est déjà confirmé (`delivered_at` non nul),
 *   soit une réservation fraîche est en vol. Dans les deux cas : ne pas envoyer.
 */
export async function claimEmailDispatchOn(
  db: DispatchClaimDb,
  { userId, type, period, now = new Date() }: DispatchClaimInput,
): Promise<DispatchClaimResult> {
  const staleBefore = new Date(now.getTime() - DISPATCH_CLAIM_STALE_AFTER_MS);
  // L'identifiant est produit côté Node : un `INSERT` brut ne déclenche pas le
  // `@default(cuid())` du schéma, qui est appliqué par le client Prisma.
  const freshId = randomUUID();

  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO email_dispatch_claims (id, user_id, type, period, claimed_at, created_at)
    VALUES (${freshId}, ${userId}, ${type}, ${period}, ${now}, ${now})
    ON CONFLICT (user_id, type, period) DO UPDATE
      SET claimed_at = ${now}
      WHERE email_dispatch_claims.delivered_at IS NULL
        AND email_dispatch_claims.claimed_at < ${staleBefore}
    RETURNING id
  `;

  const first = rows[0];
  if (first !== undefined) return { ok: true, claimId: first.id };

  // Distinguer les deux refus : « déjà envoyé » est l'état nominal en régime
  // permanent, « en vol » signale deux exécutions concurrentes du batch — une
  // information d'exploitation, pas un incident.
  const existing = await db.emailDispatchClaim.findUnique({
    where: { userId_type_period: { userId, type, period } },
    select: { deliveredAt: true },
  });

  return {
    ok: false,
    reason: existing?.deliveredAt != null ? 'already_delivered' : 'in_flight',
  };
}

/** Confirme l'envoi : la réservation devient définitive, plus rien ne la reprend. */
export async function markDispatchDeliveredOn(
  db: DispatchClaimDb,
  claimId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.emailDispatchClaim.update({
    where: { id: claimId },
    data: { deliveredAt: now },
  });
}

/**
 * Libère la réservation après un envoi qui a échoué, pour que la prochaine
 * exécution réessaie immédiatement au lieu d'attendre l'expiration du bail.
 *
 * Best-effort : si cette suppression échoue, le bail prend le relais — le
 * membre reçoit sa notification avec au pire une demi-heure de retard, jamais
 * jamais.
 */
export async function releaseEmailDispatchOn(db: DispatchClaimDb, claimId: string): Promise<void> {
  try {
    await db.emailDispatchClaim.deleteMany({
      where: { id: claimId, deliveredAt: null },
    });
  } catch {
    /* le bail rattrape — voir le JSDoc */
  }
}
