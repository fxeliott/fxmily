'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import {
  ensureMicroObjectiveFromSignal,
  mentalAxisFromDimensionId,
} from '@/lib/coaching/micro-objective';

/**
 * Tour 11 (FINDING 3) — Server Action admin : convertir un SIGNAL FAIBLE (onglet
 * profil du membre) en micro-objectif d'engagement. Jusqu'ici les signaux faibles
 * étaient 100 % passifs (le coach lisait, sans levier) ; la seule voie de semis
 * était l'annotation sur un trade précis. Ce fichier DÉDIÉ (jamais un actions.ts
 * partagé) referme ce vide.
 *
 * Pattern carbone `trades/[tradeId]/actions.ts` :
 *   - re-`auth()` en tête + check rôle admin (défense en profondeur au-dessus du proxy) ;
 *   - `ActionState` discriminé pour un feedback optimiste sobre côté UI ;
 *   - un `logAudit` PII-free (id membre + ref opaque + axe dérivé, jamais le texte
 *     du signal), slug `admin.objective.seeded_from_signal` dans `AuditAction`.
 *
 * 🛡️ FIREWALL §21.5 ABSOLU : le TEXTE du signal ne traverse JAMAIS ici. L'appelant
 * (UI) ne passe QUE le `dimensionId` (slug technique opaque du signal) ; le
 * `mentalAxis` est dérivé de ce slug (`mentalAxisFromDimensionId`), jamais du
 * contenu. La copie membre est CURÉE déterministe par axe (dans le seeder). Le
 * `sourceRef` stocké est le `dimensionId` (trace), jamais une FK ni le signal.
 *
 * 🛡️ INVARIANT « ≤1 ouvert » : `ensureMicroObjectiveFromSignal` est idempotent ;
 * si une boucle est déjà ouverte, on renvoie `already_open` (le bouton l'affiche
 * calmement) plutôt qu'un doublon.
 */

export interface SeedObjectiveFromSignalState {
  ok: boolean;
  /** `already_open` : une boucle est déjà ouverte pour ce membre (≤1 invariant). */
  status?: 'created' | 'already_open';
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'unknown';
}

/** `dimensionId` d'un signal faible : slug technique borné (mirror `dimensionIdSchema`). */
const DIMENSION_ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;

/**
 * Sème un micro-objectif pour `memberId` à partir du signal faible identifié par
 * son `dimensionId` (ref opaque). Bound action : l'UI la curry avec `memberId`.
 */
export async function seedObjectiveFromSignalAction(
  memberId: string,
  dimensionId: string,
): Promise<SeedObjectiveFromSignalState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  // Validate the opaque ref shape defensively (never trust the client payload).
  // The dimensionId is a technical slug — the signal's TEXT never reaches here.
  if (typeof dimensionId !== 'string' || !DIMENSION_ID_PATTERN.test(dimensionId)) {
    return { ok: false, error: 'invalid_input' };
  }
  if (typeof memberId !== 'string' || memberId.length === 0) {
    return { ok: false, error: 'invalid_input' };
  }

  // Deterministic axis projection from the slug prefix (never from the signal text).
  const mentalAxis = mentalAxisFromDimensionId(dimensionId);

  let result: Awaited<ReturnType<typeof ensureMicroObjectiveFromSignal>>;
  try {
    result = await ensureMicroObjectiveFromSignal(memberId, mentalAxis, dimensionId);
  } catch (err) {
    console.error('[admin.objective.fromSignal] seed failed', err);
    return { ok: false, error: 'unknown' };
  }

  // PII-free audit trail (firewall §21.5: ids + derived axis only, never the
  // signal text nor a FK), mirroring `admin.annotation.created`.
  await logAudit({
    action: 'admin.objective.seeded_from_signal',
    userId: session.user.id,
    metadata: { memberId, dimensionId, mentalAxis, created: result.created },
  });

  // Refresh the member profile tab so the button reflects the new open loop and
  // the member surfaces so the seeded objective appears at their next visit.
  revalidatePath(`/admin/members/${memberId}`);
  revalidatePath('/objectifs');
  revalidatePath('/dashboard');
  revalidatePath('/', 'layout');

  return { ok: true, status: result.created ? 'created' : 'already_open' };
}
