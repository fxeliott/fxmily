import 'server-only';

import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';

/**
 * J10 correctif n°6 — réservation d'envoi « une fois par membre et par
 * période », écrite AVANT l'envoi.
 *
 * ## Le défaut fermé
 *
 * `dispatchMonthlyDebriefToMember` envoyait dans l'ordre push → email →
 * marquage de la ligne (`MonthlyDebrief.sentToMemberAt`). Un échec du marquage
 * — une panne de base dans l'intervalle étroit après le retour de Resend —
 * laissait la colonne à `null`, et la relance suivante du batch renvoyait un
 * DEUXIÈME email au membre. Le code documentait ce résidu comme accepté.
 *
 * ## Pourquoi une réservation plutôt qu'un « marquer d'abord »
 *
 * Marquer avant d'envoyer échange un doublon rare contre une non-délivrance
 * silencieuse — pire pour une notification, et le code sortant le refusait
 * explicitement, avec raison. Une réservation tient les deux bouts :
 *
 *   - elle est écrite AVANT l'envoi, donc un second passage la heurte et
 *     s'arrête (contrainte unique `(userId, type, period)`) ;
 *   - elle est LIBÉRÉE si l'envoi échoue vraiment, donc la relance suivante
 *     réessaie au lieu d'abandonner le membre en silence.
 *
 * ## Ce qui reste possible, et pourquoi c'est acceptable
 *
 * Un processus tué APRÈS que Resend a accepté le message mais AVANT
 * `markDispatchDelivered` laisse une réservation non confirmée. Passé
 * `DISPATCH_CLAIM_STALE_AFTER_MS`, elle est reprenable — et ce cas précis peut
 * produire un doublon. C'est le résidu irréductible d'un envoi externe qu'on ne
 * peut pas inscrire dans la même transaction que la base. Il est désormais
 * borné à « le processus meurt pendant la fenêtre d'envoi », là où il couvrait
 * auparavant n'importe quel incident de base.
 *
 * L'alternative — ne jamais reprendre une réservation — remplacerait ce
 * doublon rare par une notification définitivement perdue. Entre les deux, on
 * garde celle qui informe le membre.
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

interface ClaimInput {
  userId: string;
  /** Type de notification, p. ex. `monthly_debrief_ready`. */
  type: string;
  /** Période couverte, `YYYY-MM-DD` (1er du mois, lundi ISO…). */
  period: string;
  now?: Date;
}

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
export async function claimEmailDispatch({
  userId,
  type,
  period,
  now = new Date(),
}: ClaimInput): Promise<DispatchClaimResult> {
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
export async function markDispatchDelivered(
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
export async function releaseEmailDispatch(claimId: string): Promise<void> {
  try {
    await db.emailDispatchClaim.deleteMany({
      where: { id: claimId, deliveredAt: null },
    });
  } catch {
    /* le bail rattrape — voir le JSDoc */
  }
}
