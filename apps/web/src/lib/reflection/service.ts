import 'server-only';

import { db } from '@/lib/db';
import { parseLocalDate } from '@/lib/checkin/timezone';
import type { ReflectionEntryInput } from '@/lib/schemas/reflection';

/**
 * V1.8 REFLECT — `ReflectionEntry` service layer (CBT Ellis ABCD).
 *
 * User-scoped strict. Multiple entries per day allowed (no unique
 * constraint at DB level), so the create path is straight-forward — no
 * upsert idempotency needed.
 *
 * Free-text fields are sanitized at the Zod boundary (caller).
 */

// =============================================================================
// Public API types
// =============================================================================

export interface SerializedReflectionEntry {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  triggerEvent: string;
  beliefAuto: string;
  consequence: string;
  disputation: string;
  createdAt: string; // ISO
}

// =============================================================================
// Helpers
// =============================================================================

function toSerialized(row: {
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
// Mutations
// =============================================================================

/**
 * Read a member's reflection entry by cuid. User-scoped — returns `null`
 * if the row belongs to a different member (anti-enumeration via 404).
 *
 * Implementation : single `findFirst({ id, userId })` query — atomic,
 * collapses two-step `findUnique + post-check` into one SQL round-trip and
 * eliminates the theoretical timing oracle on "row exists for someone else".
 * Carbon of the `cards/service.ts` `getDelivery` pattern.
 */
export async function getReflectionById(
  userId: string,
  id: string,
): Promise<SerializedReflectionEntry | null> {
  if (id.length === 0 || id.length > 64) return null;
  const row = await db.reflectionEntry.findFirst({ where: { id, userId } });
  return row ? toSerialized(row) : null;
}

export async function createReflectionEntry(
  userId: string,
  input: ReflectionEntryInput,
): Promise<SerializedReflectionEntry> {
  const dateDb = parseLocalDate(input.date);
  const row = await db.reflectionEntry.create({
    data: {
      userId,
      date: dateDb,
      triggerEvent: input.triggerEvent,
      beliefAuto: input.beliefAuto,
      consequence: input.consequence,
      disputation: input.disputation,
    },
  });
  return toSerialized(row);
}

// =============================================================================
// Reads
// =============================================================================

/**
 * List the member's reflection entries from the last `windowDays` days
 * (default 30, max 365), newest first. Returns an empty array if nothing
 * in the window.
 */
export async function listRecentReflections(
  userId: string,
  windowDays = 30,
): Promise<SerializedReflectionEntry[]> {
  const bounded = Math.max(1, Math.min(windowDays, 365));
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - bounded);
  // Anchor to UTC midnight so the DATE column comparison is inclusive.
  horizon.setUTCHours(0, 0, 0, 0);

  const rows = await db.reflectionEntry.findMany({
    where: {
      userId,
      date: { gte: horizon },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toSerialized);
}
