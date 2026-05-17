import 'server-only';

import { db } from '@/lib/db';
import type { AdminNoteModel } from '@/generated/prisma/models/AdminNote';

/**
 * Admin-scoped private-note service (V2.1, SPEC §7.7).
 *
 * **Trust boundary** : every function here assumes the caller is an
 * authenticated admin. The role is NOT re-checked inside the service —
 * that's the caller's job. The Server Actions in
 * `app/admin/members/[id]/notes/actions.ts` re-call `auth()` + assert
 * `role === 'admin'`, and `proxy.ts` gates `/admin/*` upstream.
 *
 * **The member NEVER sees these** (SPEC §7.7 "pas vu par lui"). There is
 * deliberately NO member-facing read path. Mirrors the J3/J4 admin split
 * (`lib/admin/annotations-service.ts`): keeping the helpers in an
 * admin-only module makes a stray member-side import surface as a missing
 * symbol rather than a silent privacy leak.
 */

// ----- Public API types -------------------------------------------------------

export interface CreateAdminNoteInput {
  /** The member the note is about. */
  memberId: string;
  /** The admin authoring the note. */
  authorId: string;
  body: string;
}

/** JSON-safe view of an `AdminNote`. Date → ISO string. */
export interface SerializedAdminNote {
  id: string;
  memberId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export class AdminNoteNotFoundError extends Error {
  constructor() {
    super('admin note not found');
    this.name = 'AdminNoteNotFoundError';
  }
}

// ----- Helpers ----------------------------------------------------------------

/** Map a Prisma row to the JSON-safe view. */
export function serializeAdminNote(row: AdminNoteModel): SerializedAdminNote {
  return {
    id: row.id,
    memberId: row.memberId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ----- Service ----------------------------------------------------------------

/**
 * Create a private note about `memberId`, authored by `authorId` (admin).
 *
 * Throws Prisma errors if either user FK is missing — the Server Action
 * wraps the call and surfaces them as `unknown` to the UI.
 */
export async function createAdminNote(input: CreateAdminNoteInput): Promise<SerializedAdminNote> {
  const row = await db.adminNote.create({
    data: {
      memberId: input.memberId,
      authorId: input.authorId,
      body: input.body,
    },
  });
  return serializeAdminNote(row);
}

/**
 * List every note about `memberId`, newest first. Admin-only — there is
 * no member-facing equivalent by design (SPEC §7.7).
 */
export async function listAdminNotesForMember(memberId: string): Promise<SerializedAdminNote[]> {
  const rows = await db.adminNote.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeAdminNote);
}

/**
 * Hard-delete a note. Requires both the id and the authoring admin's id
 * so a typo on either side surfaces as `not found` rather than a stray
 * delete (mirror of `deleteAnnotation`). The Server Action has already
 * re-checked role=admin.
 *
 * Throws `AdminNoteNotFoundError` if no row matched.
 */
export async function deleteAdminNote(id: string, authorId: string): Promise<void> {
  const result = await db.adminNote.deleteMany({ where: { id, authorId } });
  if (result.count === 0) {
    throw new AdminNoteNotFoundError();
  }
}

/**
 * Look up a single note by id. Returns null if absent. Admin-only path —
 * used by the delete Server Action to resolve `memberId` for revalidation
 * before the row is gone.
 */
export async function getAdminNoteById(id: string): Promise<SerializedAdminNote | null> {
  const row = await db.adminNote.findUnique({ where: { id } });
  return row ? serializeAdminNote(row) : null;
}
