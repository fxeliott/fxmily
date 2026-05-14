import 'server-only';

import { db } from '@/lib/db';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { weekEndFromWeekStart, type WeeklyReviewInput } from '@/lib/schemas/weekly-review';

/**
 * V1.8 REFLECT — `WeeklyReview` service layer (member-facing Sunday recap).
 *
 * User-scoped strict — every function takes a `userId` and never touches
 * another member's rows (defense-in-depth on top of the Server Action's
 * `auth()` re-check). All free-text is sanitized at the Zod boundary
 * (caller responsibility) so this layer trusts its input and focuses on
 * persistence + read shape.
 *
 * `weekStart` enters as the validated `YYYY-MM-DD` string (Zod guarantees
 * Monday-validity + window). We convert to a UTC midnight `Date` via
 * `parseLocalDate` (carbone J5 `checkin/service.ts`) so Postgres `@db.Date`
 * truncation never drifts a day across timezones.
 *
 * `weekEnd` is computed server-side from `weekStart + 6 days` — never
 * trusted from input (single source of truth, anti-tamper).
 */

// =============================================================================
// Public API types
// =============================================================================

/**
 * JSON-safe view of `WeeklyReview` for client components.
 * `Date` → `YYYY-MM-DD` / ISO timestamp. No PII outside `userId`.
 */
export interface SerializedWeeklyReview {
  id: string;
  userId: string;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
  biggestWin: string;
  biggestMistake: string;
  bestPractice: string | null;
  lessonLearned: string;
  nextWeekFocus: string;
  submittedAt: string; // ISO
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface SubmitWeeklyReviewResult {
  review: SerializedWeeklyReview;
  /** True if the row didn't exist before (upsert create branch). */
  wasNew: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function toSerialized(row: {
  id: string;
  userId: string;
  weekStart: Date;
  weekEnd: Date;
  biggestWin: string;
  biggestMistake: string;
  bestPractice: string | null;
  lessonLearned: string;
  nextWeekFocus: string;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): SerializedWeeklyReview {
  return {
    id: row.id,
    userId: row.userId,
    weekStart: row.weekStart.toISOString().slice(0, 10),
    weekEnd: row.weekEnd.toISOString().slice(0, 10),
    biggestWin: row.biggestWin,
    biggestMistake: row.biggestMistake,
    bestPractice: row.bestPractice,
    lessonLearned: row.lessonLearned,
    nextWeekFocus: row.nextWeekFocus,
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Persist a weekly review — upserts on `(userId, weekStart)` so a member
 * who re-opens the wizard for an already-submitted week updates in place.
 *
 * Returns the serialized row + a `wasNew` flag (true if create branch fired,
 * useful for audit metadata + UX "Submission enregistrée" vs "Modification
 * enregistrée").
 */
export async function submitWeeklyReview(
  userId: string,
  input: WeeklyReviewInput,
): Promise<SubmitWeeklyReviewResult> {
  const weekStartDb = parseLocalDate(input.weekStart);
  const weekEndDb = weekEndFromWeekStart(input.weekStart);

  // Pre-check existence to decide `wasNew` deterministically — Prisma's
  // `upsert` doesn't expose which branch fired, and a two-step transaction
  // is overkill at 30-member scale (the worst-case race is two concurrent
  // tabs from the same user, which is irrelevant here).
  const existing = await db.weeklyReview.findUnique({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    select: { id: true },
  });

  const row = await db.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    create: {
      userId,
      weekStart: weekStartDb,
      weekEnd: weekEndDb,
      biggestWin: input.biggestWin,
      biggestMistake: input.biggestMistake,
      bestPractice: input.bestPractice ?? null,
      lessonLearned: input.lessonLearned,
      nextWeekFocus: input.nextWeekFocus,
    },
    update: {
      // weekEnd is recomputed from weekStart and never changes for a given
      // composite key — but we still write it so a legacy row created by a
      // bugged service version gets reconciled.
      weekEnd: weekEndDb,
      biggestWin: input.biggestWin,
      biggestMistake: input.biggestMistake,
      bestPractice: input.bestPractice ?? null,
      lessonLearned: input.lessonLearned,
      nextWeekFocus: input.nextWeekFocus,
      submittedAt: new Date(), // bump on update so the audit timeline reflects edits
    },
  });

  return {
    review: toSerialized(row),
    wasNew: existing == null,
  };
}

// =============================================================================
// Reads
// =============================================================================

/**
 * Read a member's review for a specific week. Returns `null` if absent.
 */
export async function getWeeklyReview(
  userId: string,
  weekStart: string,
): Promise<SerializedWeeklyReview | null> {
  const weekStartDb = parseLocalDate(weekStart);
  const row = await db.weeklyReview.findUnique({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
  });
  return row ? toSerialized(row) : null;
}

/**
 * Read a member's review by cuid. User-scoped — returns `null` if the row
 * belongs to a different member (no enumeration leak via 404).
 *
 * Implementation : single `findFirst({ id, userId })` query — atomic,
 * collapses two-step `findUnique + post-check` into one SQL round-trip and
 * eliminates the theoretical timing oracle on "row exists for someone else".
 * Carbon of the `cards/service.ts` `getDelivery` pattern.
 */
export async function getWeeklyReviewById(
  userId: string,
  id: string,
): Promise<SerializedWeeklyReview | null> {
  if (id.length === 0 || id.length > 64) return null;
  const row = await db.weeklyReview.findFirst({ where: { id, userId } });
  return row ? toSerialized(row) : null;
}

/**
 * V1.9 TIER F — single-column query for the dashboard widget.
 *
 * Returns the `weekStart` (YYYY-MM-DD) of the member's most recent review,
 * or `null` if they've never submitted one. Caller (`DashboardReflectWidget`)
 * only renders the date and a "submitted yes/no" flag, so projecting one
 * column instead of fetching all 17 saves a row-build + row-serialize per
 * dashboard render — meaningful at 30→100 active members hitting the home
 * page hourly.
 */
export async function getLastReviewWeekStart(userId: string): Promise<string | null> {
  const row = await db.weeklyReview.findFirst({
    where: { userId },
    orderBy: { weekStart: 'desc' },
    select: { weekStart: true },
  });
  return row ? row.weekStart.toISOString().slice(0, 10) : null;
}

/**
 * List the member's most recent reviews (newest first). Default `limit=12`
 * = a quarter's worth of weekly reviews, enough for a UI timeline without
 * pagination.
 */
export async function listMyRecentReviews(
  userId: string,
  limit = 12,
): Promise<SerializedWeeklyReview[]> {
  const rows = await db.weeklyReview.findMany({
    where: { userId },
    orderBy: { weekStart: 'desc' },
    take: Math.max(1, Math.min(limit, 52)), // bound 1..52
  });
  return rows.map(toSerialized);
}
