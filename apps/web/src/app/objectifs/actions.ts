'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { MicroObjectiveNotFoundError, closeMicroObjective } from '@/lib/coaching/micro-objective';
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

  // The loop is surfaced on BOTH the hub (compact) and /objectifs (full) → both
  // must re-render so the closed objective leaves the "open" slot immediately.
  revalidatePath('/objectifs');
  revalidatePath('/dashboard');
  return { ok: true };
}
