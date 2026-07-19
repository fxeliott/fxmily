'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { createAdminNote } from '@/lib/admin/admin-notes-service';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { safeFreeText } from '@/lib/text/safe';

/**
 * J6 (admin-scale, scope 7) — bulk admin action v1.
 *
 * At 30 → 1000 members the coach needs to act on a COHORT SUBSET in one gesture
 * (e.g. filter `?attention=1`, select the page, drop the same follow-up note).
 * v1 ships the SAFEST possible mass action: a private admin coaching note added
 * to every selected member. Deliberately chosen because it has **zero
 * member-facing side effect** (SPEC §7.7 — an AdminNote is never shown to the
 * member: no push, no email, no state change to member data), so a bulk mistake
 * is fully recoverable and can never leak/alarm a member.
 *
 * Pattern carbone `reinforce-objective-actions.ts`: auth gate → input validation
 * → BOLA whitelist → `createAdminNote` → audit → revalidate. The note body is
 * admin-supplied free text, so it is hardened with `safeFreeText` (Fxmily canon:
 * any stored free text may one day feed an LLM prompt) and length-capped.
 */

export interface BulkNoteActionState {
  ok: boolean;
  /** Number of members actually noted (whitelisted ∩ write-succeeded). */
  created?: number;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'unknown';
}

/** Bound the fan-out: a single bulk gesture is a page-sized batch, not the cohort. */
const MAX_MEMBERS = 200;
/** cuid is 25 chars; 64 leaves margin (carbone reinforce-objective MAX_ID_LEN). */
const MAX_ID_LEN = 64;
const MAX_BODY = 2000;
const CUID_RE = /^[a-z0-9]{20,40}$/i;

export async function bulkAddMemberNoteAction(
  memberIds: string[],
  body: string,
): Promise<BulkNoteActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > MAX_MEMBERS) {
    return { ok: false, error: 'invalid_input' };
  }
  const cleanBody = typeof body === 'string' ? body.trim() : '';
  if (cleanBody.length === 0 || cleanBody.length > MAX_BODY) {
    return { ok: false, error: 'invalid_input' };
  }

  // Dedup + shape-validate the ids before they touch Prisma.
  const requested = [...new Set(memberIds)].filter(
    (id): id is string => typeof id === 'string' && id.length <= MAX_ID_LEN && CUID_RE.test(id),
  );
  if (requested.length === 0) return { ok: false, error: 'invalid_input' };

  // BULK BOLA / whitelist: keep only ids that are REAL members (`role: member`).
  // A forged id, an admin id, or a stale id is silently dropped — never noted.
  const members = await db.user.findMany({
    where: { id: { in: requested }, role: 'member' },
    select: { id: true },
  });
  if (members.length === 0) return { ok: false, error: 'invalid_input' };

  const safeBody = safeFreeText(cleanBody);
  let created = 0;
  for (const member of members) {
    try {
      await createAdminNote({ memberId: member.id, authorId: session.user.id, body: safeBody });
      created += 1;
    } catch (err) {
      // One failed write must not abort the batch — the others still land.
      console.error('[admin.members.bulkNote] note create failed', err);
    }
  }
  if (created === 0) return { ok: false, error: 'unknown' };

  await logAudit({
    action: 'admin.members.bulk_noted',
    userId: session.user.id,
    metadata: { requested: requested.length, created },
  });
  // Admin-only surface — never a member route (the notes must never reach them).
  revalidatePath('/admin/members');

  return { ok: true, created };
}
