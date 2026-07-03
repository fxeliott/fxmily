'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { resolveDiscrepancyAsAdmin } from '@/lib/verification/service';

/**
 * Tour 11 (chantier G, FINDING 3) — Server Action : the admin marks a
 * verification discrepancy as « traité » (open|acknowledged → resolved).
 *
 * Pattern carbone `notes/actions.ts` :
 *   - re-`auth()` + status active + role=admin (defense in depth on top of the
 *     `/admin/*` proxy gate),
 *   - id length cap (anti-DoS on the Prisma parser),
 *   - `logAudit` like every admin mutation,
 *   - `revalidatePath` only ever touches the ADMIN member page — this surface is
 *     admin-only, the member never sees the resolution control.
 *
 * The status flip itself is gate-locked in `resolveDiscrepancyAsAdmin` (WHERE
 * status IN open|acknowledged), so a concurrent reconcile flip is never clobbered.
 */

export interface ResolveDiscrepancyActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'not_found' | 'unknown';
}

/** cuid is 25 chars; 64 leaves generous margin (carbone notes/actions MAX_ID_LEN). */
const MAX_ID_LEN = 64;

export async function resolveDiscrepancyAction(
  memberId: string,
  discrepancyId: string,
): Promise<ResolveDiscrepancyActionState> {
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
    typeof discrepancyId !== 'string' ||
    discrepancyId.length === 0 ||
    discrepancyId.length > MAX_ID_LEN
  ) {
    return { ok: false, error: 'invalid_input' };
  }

  let flipped: number;
  try {
    flipped = await resolveDiscrepancyAsAdmin(discrepancyId);
  } catch (err) {
    console.error('[admin.discrepancy.resolve] update failed', err);
    return { ok: false, error: 'unknown' };
  }

  // 0 rows flipped = the gap was already resolved (reconcile won the race) or the
  // id is stale. Either way there is nothing to do; report « not_found » so the UI
  // stays honest rather than claiming a resolution that did not happen.
  if (flipped === 0) {
    return { ok: false, error: 'not_found' };
  }

  await logAudit({
    action: 'admin.discrepancy.resolved',
    userId: session.user.id,
    metadata: { discrepancyId, memberId },
  });

  // Admin-only surface : refresh just the member page's verification tab.
  revalidatePath(`/admin/members/${memberId}`);

  return { ok: true };
}
