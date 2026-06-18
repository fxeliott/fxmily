import 'server-only';

import { db } from '@/lib/db';
import type { MonthlyDebriefPatterns } from '@/lib/schemas/monthly-debrief';

import type { SerializedMonthlyDebrief } from './types';

/**
 * V1.4 — `MonthlyDebrief` READ-ONLY service layer (SPEC §25, J-M3/J-M4).
 *
 * Carbon of `training-debrief/service.ts` reads, minus the mutations: a
 * monthly debrief is an **AI synthesis written by the batch pipeline**
 * (J-M2 `persistGeneratedReports`), never by the member — there is no
 * member `submit`/upsert here. This layer serializes persisted rows for the
 * member page (`/debrief-mensuel`) and Eliott's read-only admin panel
 * (`/admin/members/[id]?tab=monthly-debrief`, SPEC §25.4/§25.6). The lone
 * write is `markMonthlyDebriefSeen` (S6 audit) — a first-view acknowledgement
 * stamp, NOT content authoring (mirror of the calendar disclosure stamp).
 *
 * User-scoped strict — every function takes a `userId`/`memberId` and never
 * crosses members (defence-in-depth on top of the page's `auth()` /
 * `role==='admin'` gate).
 *
 * 🚨 §21.5 (SPEC §25.7). This file does NOT touch `db.trainingTrade` /
 * `db.trade` — it reads ONLY the persisted `MonthlyDebrief` row, whose
 * `summaryTraining` is the §21.5-safe (count/recency-only) text the AI wrote
 * from a snapshot that structurally carried no backtest P&L. There is no
 * recomputation here, so no leak surface (the blocking anti-leak suite
 * Block G also pins `@/lib/monthly-debrief/*` clean of training-P&L tokens).
 */

// =============================================================================
// Helpers
// =============================================================================

export function toSerializedMonthlyDebrief(row: {
  id: string;
  userId: string;
  monthStart: Date;
  monthEnd: Date;
  generatedAt: Date;
  progressionNarrative: string;
  summaryReal: string;
  summaryTraining: string;
  risks: unknown;
  recommendations: unknown;
  patterns: unknown;
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costEur: { toString(): string };
  sentToMemberAt: Date | null;
  sentToMemberEmail: string | null;
  pushEnqueuedAt: Date | null;
  seenAt: Date | null;
}): SerializedMonthlyDebrief {
  // `risks`/`recommendations`/`patterns` are persisted ONLY through
  // `monthlyDebriefOutputSchema.strict()` (J-M2 batch persist double-net), so
  // the shapes are sound. We still narrow defensively at the read edge — a
  // hand-edited row must never crash the member page.
  const risks = Array.isArray(row.risks) ? (row.risks as string[]) : [];
  const recommendations = Array.isArray(row.recommendations)
    ? (row.recommendations as string[])
    : [];
  const patterns =
    row.patterns !== null && typeof row.patterns === 'object' && !Array.isArray(row.patterns)
      ? (row.patterns as MonthlyDebriefPatterns)
      : {};

  return {
    id: row.id,
    userId: row.userId,
    // `@db.Date` columns store a UTC-midnight date; `.toISOString().slice(0,10)`
    // is the canon read for a DATE (carbon `training-debrief/service.ts:79` —
    // no `localDateOf` here because the column has no time component).
    monthStart: row.monthStart.toISOString().slice(0, 10),
    monthEnd: row.monthEnd.toISOString().slice(0, 10),
    generatedAt: row.generatedAt.toISOString(),
    progressionNarrative: row.progressionNarrative,
    summaryReal: row.summaryReal,
    summaryTraining: row.summaryTraining,
    risks,
    recommendations,
    patterns,
    claudeModel: row.claudeModel,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreateTokens: row.cacheCreateTokens,
    costEur: row.costEur.toString(),
    sentToMemberAt: row.sentToMemberAt ? row.sentToMemberAt.toISOString() : null,
    sentToMemberEmail: row.sentToMemberEmail,
    pushEnqueuedAt: row.pushEnqueuedAt ? row.pushEnqueuedAt.toISOString() : null,
    seenAt: row.seenAt ? row.seenAt.toISOString() : null,
  };
}

// =============================================================================
// Reads
// =============================================================================

/**
 * Read a member's monthly debrief by cuid. User-scoped — returns `null` if
 * the row belongs to a different member (no enumeration leak via 404).
 * Single `findFirst({ id, userId })` (V1.9 TIER B canon: one SQL, no timing
 * oracle). Used by the member page (`?id=` switch) and the admin panel.
 */
export async function getMonthlyDebriefById(
  userId: string,
  id: string,
): Promise<SerializedMonthlyDebrief | null> {
  if (id.length === 0 || id.length > 64) return null;
  const row = await db.monthlyDebrief.findFirst({ where: { id, userId } });
  return row ? toSerializedMonthlyDebrief(row) : null;
}

/**
 * List the member's most recent monthly debriefs (newest first). Default
 * `limit=12` = a year's worth, enough for the landing timeline (SPEC §25.4
 * "hero + timeline ~12 derniers mois") without pagination. Bounded 1..24.
 * Returns full serialized rows so the page can render the selected one
 * inline without a second round-trip.
 */
export async function listMyRecentMonthlyDebriefs(
  userId: string,
  limit = 12,
): Promise<SerializedMonthlyDebrief[]> {
  const rows = await db.monthlyDebrief.findMany({
    where: { userId },
    orderBy: { monthStart: 'desc' },
    take: Math.max(1, Math.min(limit, 24)),
  });
  return rows.map(toSerializedMonthlyDebrief);
}

/**
 * List every monthly debrief of a member for Eliott's READ-ONLY admin view
 * (`/admin/members/[id]?tab=monthly-debrief`, SPEC §25.4/§25.6 — lecture
 * seule, aucune action). Admin-scoping is the caller's responsibility (the
 * admin page already gates `role === 'admin'`); this is a plain user-scoped
 * read by `memberId`, newest first. Bounded so a prolific member can't
 * unbound the admin render.
 */
export async function listMonthlyDebriefsForMember(
  memberId: string,
  limit = 12,
): Promise<SerializedMonthlyDebrief[]> {
  const rows = await db.monthlyDebrief.findMany({
    where: { userId: memberId },
    orderBy: { monthStart: 'desc' },
    take: Math.max(1, Math.min(limit, 24)),
  });
  return rows.map(toSerializedMonthlyDebrief);
}

/**
 * The member's most recent debrief that they have NOT yet opened (`seenAt`
 * null), or `null` if none. Powers the calm dashboard nudge
 * (`MonthlyDebriefWidget`) — the widget surfaces only the freshest unread
 * synthesis and goes quiet once read (anti-Black-Hat §25.2, no nagging).
 * User-scoped; newest unread first.
 */
export async function getLatestUnreadMonthlyDebrief(
  userId: string,
): Promise<SerializedMonthlyDebrief | null> {
  const row = await db.monthlyDebrief.findFirst({
    where: { userId, seenAt: null },
    orderBy: { monthStart: 'desc' },
  });
  return row ? toSerializedMonthlyDebrief(row) : null;
}

// =============================================================================
// Seen stamp (member view) — the ONLY member-triggered write in this file.
// Mirrors the calendar `markAdaptiveCalendarDisclosureShown` stamp: a member
// reading their debrief on `/debrief-mensuel` records the first-view instant.
// This is a view acknowledgement, NOT content authoring (the AI synthesis
// itself is still write-once by the batch). It carries no P&L → no §21.5 leak.
// =============================================================================

/**
 * Stamp `seenAt = now()` the FIRST time the member opens a given debrief.
 * Idempotent + user-scoped via `updateMany({ id, userId, seenAt: null })` —
 * a re-view never overwrites the original timestamp, and a foreign `id` matches
 * zero rows (no cross-member write, no enumeration oracle). Returns whether a
 * row was freshly stamped (`true` only on the first view). Best-effort: callers
 * wrap it so a transient DB hiccup never 500s the member's debrief page.
 */
export async function markMonthlyDebriefSeen(userId: string, id: string): Promise<boolean> {
  if (id.length === 0 || id.length > 64) return false;
  const res = await db.monthlyDebrief.updateMany({
    where: { id, userId, seenAt: null },
    data: { seenAt: new Date() },
  });
  return res.count > 0;
}
