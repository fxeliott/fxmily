'use server';

import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { reinstateMember, suspendMember } from '@/lib/admin/member-moderation';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { memberModerationActionSchema } from '@/lib/schemas/member-moderation';

/**
 * Server Actions for the admin "Modération" tab (F5, overhaul 2026-06-30, SPEC
 * §7.1 "Eliot peut suspendre / supprimer").
 *
 * Pattern carbone `access-requests/actions.ts` + `notes/actions.ts`:
 *   - re-`auth()` + `status==='active'` + `role==='admin'` (defense in depth on
 *     top of the `proxy.ts` `/admin/*` gate — a demoted/suspended admin holding
 *     a still-valid JWT must not moderate),
 *   - Zod re-parse of the FormData motif (the server is the only authority),
 *   - discriminated `ActionState` for `useActionState`,
 *   - Audit row is PII-FREE: `{memberId, eventId}` only — the free-text motif
 *     lives in the `MemberModerationEvent` row, never in `AuditLog`.
 *
 * Guards (the "garde self / dernier admin" of the brief):
 *   - an admin cannot suspend THEMSELVES (`memberId === admin.id`),
 *   - NO admin account can be suspended at all (`target.role === 'admin'`),
 *     which also neutralises the "last admin" problem — V1 is single-admin
 *     ("fxeliott unique", SPEC §13), but this holds even if multi-admin lands.
 */

export interface MemberModerationActionState {
  ok: boolean;
  message?: string;
  error?:
    | 'unauthorized'
    | 'forbidden'
    | 'invalid_input'
    | 'cannot_suspend_self'
    | 'cannot_suspend_admin'
    | 'member_not_found'
    | 'already_suspended'
    | 'not_suspended'
    | 'unknown';
  fieldErrors?: Record<string, string>;
}

/** Cap on the URL-derived id length — anti-DoS on the Prisma parser (carbone
 * `notes/actions.ts` J7 audit H9). cuid is 25 chars; 64 leaves margin. */
const MAX_ID_LEN = 64;

async function requireAdmin(): Promise<{ id: string } | null> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin' || session.user.status !== 'active') {
    return null;
  }
  return { id: session.user.id };
}

function flattenFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

function parseReason(
  formData: FormData,
): { ok: true; reason: string | null } | { ok: false; fieldErrors: Record<string, string> } {
  const raw = formData.get('reason');
  const parsed = memberModerationActionSchema.safeParse({
    reason: typeof raw === 'string' ? raw : '',
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenFieldErrors(parsed.error) };
  }
  return { ok: true, reason: parsed.data.reason };
}

/**
 * Suspend (expel) a member, optional motif. Curried with the member id via
 * `.bind(null, memberId)` so the form posts only the FormData payload.
 */
export async function suspendMemberAction(
  memberId: string,
  _prev: MemberModerationActionState | null,
  formData: FormData,
): Promise<MemberModerationActionState> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'forbidden', message: 'Accès refusé.' };

  if (typeof memberId !== 'string' || memberId.length === 0 || memberId.length > MAX_ID_LEN) {
    return { ok: false, error: 'invalid_input' };
  }
  if (memberId === admin.id) {
    return {
      ok: false,
      error: 'cannot_suspend_self',
      message: 'Tu ne peux pas te suspendre toi-même.',
    };
  }

  const reason = parseReason(formData);
  if (!reason.ok) {
    return { ok: false, error: 'invalid_input', fieldErrors: reason.fieldErrors };
  }

  // Read role + status for clear, distinct error messages (the atomic service
  // predicate re-asserts these, so a TOCTOU race degrades to a safe no-op).
  const target = await db.user.findUnique({
    where: { id: memberId },
    select: { id: true, role: true, status: true },
  });
  if (!target) return { ok: false, error: 'member_not_found', message: 'Membre introuvable.' };
  if (target.role === 'admin') {
    return {
      ok: false,
      error: 'cannot_suspend_admin',
      message: 'Un compte administrateur ne peut pas être suspendu.',
    };
  }
  if (target.status !== 'active') {
    return {
      ok: false,
      error: 'already_suspended',
      message:
        target.status === 'suspended'
          ? 'Ce membre est déjà suspendu.'
          : 'Ce membre ne peut pas être suspendu.',
    };
  }

  let result;
  try {
    result = await suspendMember({ memberId, actorId: admin.id, reason: reason.reason });
  } catch (err) {
    console.error('[admin.member.suspend] failed', err);
    return { ok: false, error: 'unknown', message: 'Échec de la suspension, réessaie.' };
  }
  if (!result.ok) {
    // Lost the guarded race (status changed since the read above).
    return {
      ok: false,
      error: 'already_suspended',
      message: "Ce membre n'est plus actif. Recharge la page.",
    };
  }

  await logAudit({
    action: 'admin.member.suspended',
    userId: admin.id,
    metadata: { memberId, eventId: result.event.id },
  });

  revalidatePath(`/admin/members/${memberId}`);
  revalidatePath('/admin/members');
  return { ok: true, message: 'Membre suspendu, accès révoqué immédiatement.' };
}

/**
 * Reinstate (réintégrer) a suspended member, optional motif. Curried with the
 * member id like `suspendMemberAction`.
 */
export async function reinstateMemberAction(
  memberId: string,
  _prev: MemberModerationActionState | null,
  formData: FormData,
): Promise<MemberModerationActionState> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'forbidden', message: 'Accès refusé.' };

  if (typeof memberId !== 'string' || memberId.length === 0 || memberId.length > MAX_ID_LEN) {
    return { ok: false, error: 'invalid_input' };
  }

  const reason = parseReason(formData);
  if (!reason.ok) {
    return { ok: false, error: 'invalid_input', fieldErrors: reason.fieldErrors };
  }

  const target = await db.user.findUnique({
    where: { id: memberId },
    select: { id: true, status: true },
  });
  if (!target) return { ok: false, error: 'member_not_found', message: 'Membre introuvable.' };
  if (target.status !== 'suspended') {
    return {
      ok: false,
      error: 'not_suspended',
      message: "Ce membre n'est pas suspendu.",
    };
  }

  let result;
  try {
    result = await reinstateMember({ memberId, actorId: admin.id, reason: reason.reason });
  } catch (err) {
    console.error('[admin.member.reinstate] failed', err);
    return { ok: false, error: 'unknown', message: 'Échec de la réintégration, réessaie.' };
  }
  if (!result.ok) {
    return {
      ok: false,
      error: 'not_suspended',
      message: "Ce membre n'est plus suspendu. Recharge la page.",
    };
  }

  await logAudit({
    action: 'admin.member.reinstated',
    userId: admin.id,
    metadata: { memberId, eventId: result.event.id },
  });

  revalidatePath(`/admin/members/${memberId}`);
  revalidatePath('/admin/members');
  return { ok: true, message: 'Membre réintégré, il peut de nouveau se connecter.' };
}
