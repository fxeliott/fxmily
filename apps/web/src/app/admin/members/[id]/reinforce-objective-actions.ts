'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { createAdminNote } from '@/lib/admin/admin-notes-service';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { safeFreeText } from '@/lib/text/safe';

/**
 * Tour 11 (chantier G, FINDING 4) — Server Action : the admin « relance » an
 * open-and-stale (or missed) correction objective by dropping a PRIVATE note
 * pre-filled with a reference to that objective.
 *
 * The « Suivi des corrections » panel was 100% read-only : when a correction was
 * missed or an open loop aged out, the coach had no lever and no trace. This gives
 * them a one-click way to record the intent to follow up, entirely inside the
 * admin-only Notes surface. **No member-facing side effect whatsoever** — an
 * `AdminNote` is never shown to the member (SPEC §7.7).
 *
 * Trust boundary : the note BODY is built SERVER-SIDE from the objective read
 * back from the DB (scoped to `memberId`, BOLA-safe) — the client only supplies
 * ids. `safeFreeText` still hardens the derived title (it originates from a
 * deterministic seed, but the note could one day feed an LLM prompt — canon
 * Fxmily). Pattern carbone `notes/actions.ts` for auth + audit + revalidate.
 */

export interface ReinforceObjectiveActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'not_found' | 'unknown';
}

/** cuid is 25 chars; 64 leaves generous margin (carbone notes/actions MAX_ID_LEN). */
const MAX_ID_LEN = 64;

/** FR label for the mental axis (carbone `member-corrections-followup-panel`). */
const MENTAL_AXIS_LABEL: Record<string, string> = {
  discipline: 'Discipline',
  honesty: 'Honnêteté',
  ego: 'Ego / acceptation',
  consistency: 'Régularité',
};

function mentalAxisLabel(axis: string): string {
  return MENTAL_AXIS_LABEL[axis] ?? axis;
}

/**
 * Build the pre-filled note body. Fixed FR copy, tutoiement, ponctuation simple,
 * aucun tiret cadratin (règle de copie Eliott). Factuel, pas de jugement.
 */
function buildReinforceNote(title: string, axis: string): string {
  return `Relance à prévoir sur l'objectif « ${safeFreeText(title)} » (axe ${mentalAxisLabel(
    axis,
  )}). Correction pas encore refermée par le membre, à reprendre au prochain échange.`;
}

export async function reinforceObjectiveAction(
  memberId: string,
  objectiveId: string,
): Promise<ReinforceObjectiveActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }
  if (
    typeof memberId !== 'string' ||
    memberId.length === 0 ||
    memberId.length > MAX_ID_LEN ||
    typeof objectiveId !== 'string' ||
    objectiveId.length === 0 ||
    objectiveId.length > MAX_ID_LEN
  ) {
    return { ok: false, error: 'invalid_input' };
  }

  // Read the objective back scoped to (id, memberId) — BOLA-safe : a forged id or
  // an objective belonging to another member degrades to `not_found`, never a
  // cross-member note. We only reinforce corrections (`sourceKind='annotation'`),
  // matching the panel that shows the « Renforcer » button.
  const objective = await db.mentalMicroObjective.findFirst({
    where: { id: objectiveId, memberId, sourceKind: 'annotation' },
    select: { title: true, axis: true },
  });
  if (!objective) {
    return { ok: false, error: 'not_found' };
  }

  try {
    await createAdminNote({
      memberId,
      authorId: session.user.id,
      body: buildReinforceNote(objective.title, objective.axis),
    });
  } catch (err) {
    console.error('[admin.objective.reinforce] note create failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'admin.objective.reinforced',
    userId: session.user.id,
    metadata: { objectiveId, memberId },
  });

  // Admin-only surface : refresh the member page so the new note appears in the
  // Notes tab. Never a member route (the note must never reach the member).
  revalidatePath(`/admin/members/${memberId}`);

  return { ok: true };
}
