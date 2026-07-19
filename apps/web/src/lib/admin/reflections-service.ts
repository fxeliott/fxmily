import 'server-only';

import { db } from '@/lib/db';
import type { SerializedReflectionEntry } from '@/lib/reflection/service';

/**
 * Admin reflections service (J6-admin-scale item 4, SPEC §21.6 — "Vue admin des
 * réflexions" : liste chronologique cross-membres + par membre, lecture seule).
 *
 * **Trust boundary** : every function here assumes the caller is an authenticated
 * admin. We do NOT recheck the role inside the service — that's the route /
 * Server Action's job (defense in depth at the edge, single source of truth).
 *
 * Mirroring the J3 split: the member-facing user-scoped reads live in
 * `lib/reflection/service.ts`; the cross-member / bypass-ownership variant lives
 * here so the two scopes stay distinct on purpose.
 *
 * READ-ONLY by construction — no mutation, ever. The `ReflectionEntry` text is a
 * private CBT (Ellis ABCD) journal; this view exists ONLY under `/admin/*`, its
 * output is NEVER pushed by email / notification / digest, and the reflection
 * TEXT is NEVER written to the audit log (metadata carries ids + counts only).
 */

// =============================================================================
// Public API types
// =============================================================================

/**
 * A reflection entry decorated with the minimum member identity the admin feed
 * needs to render a row + link to `/admin/members/[id]`. The four ABCD fields
 * are surfaced verbatim (server-rendered) — this is the whole point of the view.
 */
export interface AdminReflectionEntry {
  id: string;
  memberId: string;
  memberDisplayName: string;
  memberEmail: string;
  date: string; // YYYY-MM-DD (local civil day the member picked)
  triggerEvent: string; // A — Activating event
  beliefAuto: string; // B — Automatic belief
  consequence: string; // C — Consequence
  disputation: string; // D — Disputation / reframe
  createdAt: string; // ISO
}

export interface ListReflectionsOptions {
  limit?: number;
  cursor?: string | undefined;
}

export interface AdminReflectionsPage {
  items: AdminReflectionEntry[];
  nextCursor: string | null;
}

export interface MemberReflectionsPage {
  items: SerializedReflectionEntry[];
  nextCursor: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

const MAX_PAGE = 50;

function clampLimit(limit: number | undefined): number {
  return Math.min(MAX_PAGE, Math.max(1, limit ?? MAX_PAGE));
}

/**
 * Full name reconstructed for display ("Eliott Pena"), falling back to the email
 * when both name parts are empty. Carbon of the members-service displayName rule
 * so the admin surfaces never drift on how a member is labelled.
 */
function displayNameOf(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName.length > 0 ? fullName : user.email;
}

function serialize(row: {
  id: string;
  userId: string;
  date: Date;
  triggerEvent: string;
  beliefAuto: string;
  consequence: string;
  disputation: string;
  createdAt: Date;
}): SerializedReflectionEntry {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString().slice(0, 10),
    triggerEvent: row.triggerEvent,
    beliefAuto: row.beliefAuto,
    consequence: row.consequence,
    disputation: row.disputation,
    createdAt: row.createdAt.toISOString(),
  };
}

// =============================================================================
// Reads
// =============================================================================

/**
 * Cross-member chronological feed (newest first) for `/admin/reflections`.
 *
 * Ordering + cursor are anchored on `createdAt` (a precise timestamp), NOT on
 * `date` (a calendar day, non-unique — a member can write several entries for
 * the same civil day). `id` is the final tiebreaker so the cursor is a total
 * order and never skips/repeats a row across pages. Carbon of the J3
 * members-service cursor pattern (`take: limit + 1`, `cursor: { id }`, `skip: 1`).
 *
 * The `@@index([createdAt(sort: Desc)])` added in migration
 * `20260719120000_j6_reflection_created_at_index` backs this feed.
 */
export async function listReflectionsForAdmin(
  options: ListReflectionsOptions = {},
): Promise<AdminReflectionsPage> {
  const limit = clampLimit(options.limit);

  const rows = await db.reflectionEntry.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      date: true,
      triggerEvent: true,
      beliefAuto: true,
      consequence: true,
      disputation: true,
      createdAt: true,
      user: {
        select: { firstName: true, lastName: true, email: true },
      },
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  if (pageRows.length === 0) return { items: [], nextCursor: null };

  const items: AdminReflectionEntry[] = pageRows.map((row) => ({
    id: row.id,
    memberId: row.userId,
    memberDisplayName: displayNameOf(row.user),
    memberEmail: row.user.email,
    date: row.date.toISOString().slice(0, 10),
    triggerEvent: row.triggerEvent,
    beliefAuto: row.beliefAuto,
    consequence: row.consequence,
    disputation: row.disputation,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    items,
    nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
  };
}

/**
 * Single-member chronological feed (newest first) for the `?tab=reflections`
 * panel of `/admin/members/[id]`. Same cursor semantics as the cross-member
 * feed (createdAt desc, id desc tiebreaker) scoped to `{ userId: memberId }`.
 */
export async function listReflectionsForMemberAsAdmin(
  memberId: string,
  options: ListReflectionsOptions = {},
): Promise<MemberReflectionsPage> {
  const limit = clampLimit(options.limit);

  const rows = await db.reflectionEntry.findMany({
    where: { userId: memberId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  if (pageRows.length === 0) return { items: [], nextCursor: null };

  return {
    items: pageRows.map(serialize),
    nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
  };
}
