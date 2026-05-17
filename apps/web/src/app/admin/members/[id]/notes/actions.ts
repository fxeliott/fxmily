'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import {
  AdminNoteNotFoundError,
  createAdminNote,
  deleteAdminNote,
  getAdminNoteById,
} from '@/lib/admin/admin-notes-service';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { adminNoteCreateSchema } from '@/lib/schemas/admin-note';

/**
 * Server Actions for the admin "Notes admin" tab (V2.1, SPEC §7.7).
 *
 * Pattern carbone J4 annotation actions:
 *   - re-`auth()` + status active + role=admin (defense in depth on top
 *     of `proxy.ts` gating `/admin/*`)
 *   - Zod re-parse of FormData (the server is the only authority)
 *   - discriminated `ActionState` for `useActionState`
 *
 * Privacy invariant (SPEC §7.7 "pas vu par lui"): there is NO
 * member-facing surface. These actions + the service live entirely under
 * `/admin/*`, and `revalidatePath` only ever touches the admin member
 * page — never `/journal` or any member route.
 */

export interface CreateAdminNoteActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'invalid_input' | 'member_not_found' | 'unknown';
  fieldErrors?: Record<string, string>;
  /** Set on success so the client can clear the textarea. */
  noteId?: string;
}

export interface DeleteAdminNoteActionState {
  ok: boolean;
  error?: 'unauthorized' | 'forbidden' | 'not_found' | 'unknown';
}

function flattenFieldErrors(error: import('zod').ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

/** Cap on the URL-derived id length — anti-DoS on the Postgres/Prisma
 * parser (pattern carbone J7 audit H9 "Server Actions sans cap longueur").
 * cuid is 25 chars; 64 leaves generous margin. */
const MAX_ID_LEN = 64;

/**
 * Create a private note about `memberId`. Curried with the member id via
 * `.bind(null, memberId)` so the form posts only the FormData payload.
 */
export async function createAdminNoteAction(
  memberId: string,
  _prev: CreateAdminNoteActionState | null,
  formData: FormData,
): Promise<CreateAdminNoteActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }
  if (typeof memberId !== 'string' || memberId.length === 0 || memberId.length > MAX_ID_LEN) {
    return { ok: false, error: 'invalid_input' };
  }

  const parsed = adminNoteCreateSchema.safeParse({ body: formData.get('body') ?? '' });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  // Fail fast on a stale/typo memberId with a readable error rather than an
  // opaque Prisma FK violation (`unknown`). Symmetry with the J4 mirror's
  // `trade_not_found` guard. PK lookup, select id only — negligible cost.
  const member = await db.user.findUnique({
    where: { id: memberId },
    select: { id: true },
  });
  if (!member) {
    return { ok: false, error: 'member_not_found' };
  }

  let noteId: string;
  try {
    const created = await createAdminNote({
      memberId,
      authorId: session.user.id,
      body: parsed.data.body,
    });
    noteId = created.id;
  } catch (err) {
    console.error('[admin.note.create] db insert failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'admin.note.created',
    userId: session.user.id,
    metadata: { noteId, memberId },
  });

  // Admin-only surface: refresh just the member page. Never a member route
  // (SPEC §7.7 — the member must never see these notes).
  revalidatePath(`/admin/members/${memberId}`);

  return { ok: true, noteId };
}

/**
 * Delete a note. Bound action (no `useActionState`) — an admin removes
 * their own notes; the `(id, authorId)` filter inside the service refuses
 * another admin's note (V1 solo-admin: always the author).
 */
export async function deleteAdminNoteAction(noteId: string): Promise<DeleteAdminNoteActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }
  if (typeof noteId !== 'string' || noteId.length === 0 || noteId.length > MAX_ID_LEN) {
    return { ok: false, error: 'not_found' };
  }

  // Resolve the note BEFORE deleting so we can revalidate the right
  // member page without a second round-trip after the row is gone.
  const note = await getAdminNoteById(noteId);
  if (!note) {
    return { ok: false, error: 'not_found' };
  }

  try {
    await deleteAdminNote(noteId, session.user.id);
  } catch (err) {
    if (err instanceof AdminNoteNotFoundError) return { ok: false, error: 'not_found' };
    console.error('[admin.note.delete] failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'admin.note.deleted',
    userId: session.user.id,
    metadata: { noteId, memberId: note.memberId },
  });

  revalidatePath(`/admin/members/${note.memberId}`);

  return { ok: true };
}
