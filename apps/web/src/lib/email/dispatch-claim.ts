import 'server-only';

import { db } from '@/lib/db';

import {
  claimEmailDispatchOn,
  markDispatchDeliveredOn,
  releaseEmailDispatchOn,
  type DispatchClaimInput,
  type DispatchClaimResult,
} from './dispatch-claim-core';

/**
 * J10 correctif n°6 — réservation d'envoi « une fois par membre et par
 * période », écrite AVANT l'envoi.
 *
 * Ce module est la façade `server-only` : il injecte le client Prisma de
 * l'application dans le cœur, qui vit dans `dispatch-claim-core` pour qu'un
 * banc puisse l'exercer contre un vrai Postgres sans le recopier. Toute la
 * logique — requête SQL, bail, distinction des deux refus — est là-bas, en un
 * seul exemplaire.
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
 * ⚠️ Cette seconde moitié ne vaut que parce que l'appelant a été corrigé en
 * même temps : il n'écrit plus `sentToMemberAt` quand l'email n'est pas parti.
 * Libérer la réservation pendant que le marquage ferme la porte d'entrée ne
 * produisait aucune relance — c'est le défaut qu'une revue en contexte frais a
 * trouvé, et que `monthly-debrief/batch-dispatch.test.ts` verrouille désormais.
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

export { DISPATCH_CLAIM_STALE_AFTER_MS } from './dispatch-claim-core';
export type { DispatchClaimResult } from './dispatch-claim-core';

/** Réserve l'envoi (userId × type × période) sur la base de l'application. */
export function claimEmailDispatch(input: DispatchClaimInput): Promise<DispatchClaimResult> {
  return claimEmailDispatchOn(db, input);
}

/** Confirme l'envoi : la réservation devient définitive. */
export function markDispatchDelivered(claimId: string, now: Date = new Date()): Promise<void> {
  return markDispatchDeliveredOn(db, claimId, now);
}

/** Libère la réservation après un envoi qui a réellement échoué. */
export function releaseEmailDispatch(claimId: string): Promise<void> {
  return releaseEmailDispatchOn(db, claimId);
}
