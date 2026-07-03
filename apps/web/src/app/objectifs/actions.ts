'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import {
  MicroObjectiveNotFoundError,
  buildMicroObjectiveCloseEcho,
  closeMicroObjective,
  getMemberCoachingRegister,
  type MicroObjectiveCloseEcho,
} from '@/lib/coaching/micro-objective';
import { closeMicroObjectiveSchema, type MicroObjectiveOutcomeInput } from '@/lib/schemas/coaching';

/**
 * S5 §32-E3 — Server Action for the `/objectifs` (+ dashboard) coaching surface:
 * the member closes their open mental micro-objective loop ("l'as-tu tenu ?").
 *
 * Pattern carbone `verification/actions.ts#deleteProofAction` :
 *   - re-call `auth()` + `status === 'active'` (defence in depth on top of proxy);
 *   - re-validate the positional args with the strict Zod schema;
 *   - BOLA ownership is enforced one layer down (`closeMicroObjective`): an absent
 *     row and another member's row collapse to the SAME `not_found` (anti-enum);
 *   - PII-free audit (opaque id + closed enum only — never member free text; the
 *     copy is engine-curated anyway, §33 audit invariant).
 */

export interface CloseMicroObjectiveActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'not_found' | 'unknown';
  /**
   * Tour 11 (FINDING 1) — l'écho de fermeture, nommé Mark Douglas : une copie FR
   * FIXE personnalisée par le `register` de coaching du membre, jouée en
   * `role="status"` à la place de l'ancien silence. Présent seulement sur succès.
   */
  echo?: MicroObjectiveCloseEcho;
}

export async function closeMicroObjectiveAction(
  microObjectiveId: string,
  outcome: MicroObjectiveOutcomeInput,
  _prev: CloseMicroObjectiveActionState | null,
): Promise<CloseMicroObjectiveActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const parsed = closeMicroObjectiveSchema.safeParse({ microObjectiveId, outcome });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    await closeMicroObjective(session.user.id, parsed.data.microObjectiveId, parsed.data.outcome);
  } catch (err) {
    if (err instanceof MicroObjectiveNotFoundError) {
      return { ok: false, error: 'not_found' };
    }
    console.error('[objectives.closeMicroObjective] failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'objectives.micro.closed',
    userId: session.user.id,
    metadata: { microObjectiveId: parsed.data.microObjectiveId, outcome: parsed.data.outcome },
  });

  // Tour 11 (FINDING 1) — build the Mark Douglas close echo, personalised by the
  // member's coaching register (FIREWALL §21.5 : only `coachingTone` is read, never
  // `weakSignals` nor raw AI blobs). Best-effort: a profile-read hiccup must not
  // fail the (already committed) close — we fall back to the neutral 'pedagogique'
  // register (buildMicroObjectiveCloseEcho coerces null → 'pedagogique').
  let echo: MicroObjectiveCloseEcho;
  try {
    const register = await getMemberCoachingRegister(session.user.id);
    echo = buildMicroObjectiveCloseEcho(parsed.data.outcome, register);
  } catch (err) {
    console.error('[objectives.closeMicroObjective] register load failed', err);
    echo = buildMicroObjectiveCloseEcho(parsed.data.outcome, null);
  }

  // The loop is surfaced on BOTH the hub (compact) and /objectifs (full) → both
  // must re-render so the closed objective leaves the "open" slot immediately.
  revalidatePath('/objectifs');
  revalidatePath('/dashboard');
  // Tour 10 — the pinned pill lives in the ROOT layout (every page): closing the
  // loop must clear it everywhere, not only on the two pages above.
  revalidatePath('/', 'layout');
  return { ok: true, echo };
}
