import 'server-only';

import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import type { MindsetCheckInput } from '@/lib/schemas/mindset-check';

import {
  buildMindsetTrend,
  computeMindsetProfile,
  type MindsetCheckRecord,
  type MindsetDimensionTrend,
  type MindsetProfile,
} from './profile';
import { weekEndFromWeekStart } from './week';

/**
 * V1.5 — `MindsetCheck` service layer (SPEC §27).
 *
 * User-scoped strict — every function takes a `userId`/`memberId` and never
 * touches another member's rows (defence-in-depth on top of the Server
 * Action's `auth()` re-check).
 *
 * `weekStart` enters as a validated `YYYY-MM-DD` Monday string; we convert to
 * a UTC-midnight `Date` via `parseLocalDate` so Postgres `@db.Date`
 * truncation never drifts a day across timezones (invariant PR#96 / §27.7).
 * `weekEnd` is ALWAYS service-computed (`weekStart + 6 j`, SPEC §27.3
 * anti-tamper) — never received from nor required of the client.
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5/§27.7 — BLOCKING, by construction).
 * This service reads ONLY `db.mindsetCheck` (its own 0-FK table). It NEVER
 * touches `db.trade` / `db.trainingTrade` / `db.behavioralScore` / any
 * real-edge object, NEVER selects a P&L, and feeds NOTHING into scoring /
 * engagement / triggers. The mindset profile (dimensions, trends) is computed
 * PURELY at render from the row's own `responses` + the frozen versioned
 * instrument — derived data has no column, NEVER stored (anti-drift, SSOT).
 */

// =============================================================================
// Public API types
// =============================================================================

/** JSON-safe view of `MindsetCheck` for client/admin components. */
export interface SerializedMindsetCheck {
  id: string;
  userId: string;
  weekStart: string; // YYYY-MM-DD (Monday, Europe/Paris)
  weekEnd: string; // YYYY-MM-DD — service-computed SSOT (§27.3), display only
  instrumentVersion: number;
  /** Raw Likert payload `itemId → 1..5`. Profile is computed, never stored. */
  responses: Record<string, number>;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface SubmitMindsetCheckResult {
  check: SerializedMindsetCheck;
  /** True if the row didn't exist before (upsert create branch). */
  wasNew: boolean;
}

export interface MindsetDashboardData {
  /** Newest-first recent checks (raw, for the timeline). */
  recent: SerializedMindsetCheck[];
  /** This week's check if already submitted (prefill / "déjà fait"). */
  currentWeek: SerializedMindsetCheck | null;
  /** Profile of the most recent check, or `null` if none / unknown version. */
  latestProfile: MindsetProfile | null;
  /** Per-dimension trend, segmented intra-version (§27.7). */
  trend: readonly MindsetDimensionTrend[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Coerce a stored Prisma `Json` value into a flat `itemId → number` map.
 * Tampered / legacy shapes degrade to `{}` (the pure aggregator then scores
 * the affected dimension `null`, never a fabricated 0 — SPEC §27.4).
 */
function asResponses(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

function toSerialized(row: {
  id: string;
  userId: string;
  weekStart: Date;
  instrumentVersion: number;
  responses: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SerializedMindsetCheck {
  const weekStart = row.weekStart.toISOString().slice(0, 10);
  return {
    id: row.id,
    userId: row.userId,
    weekStart,
    weekEnd: weekEndFromWeekStart(weekStart),
    instrumentVersion: row.instrumentVersion,
    responses: asResponses(row.responses),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRecord(c: SerializedMindsetCheck): MindsetCheckRecord {
  return {
    weekStart: c.weekStart,
    instrumentVersion: c.instrumentVersion,
    responses: c.responses,
  };
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Persist a mindset check — upserts on `(userId, weekStart)` so a member who
 * re-opens the instrument for an already-submitted week updates in place
 * (idempotency, SPEC §27.4 — re-submit same week = 1 row). `updatedAt`
 * (`@updatedAt`) reflects the latest pass; there is no dedicated
 * `submittedAt` (minimal spec-faithful model, §27.3).
 */
export async function submitMindsetCheck(
  userId: string,
  input: MindsetCheckInput,
): Promise<SubmitMindsetCheckResult> {
  const weekStartDb = parseLocalDate(input.weekStart);

  // Pre-check existence to decide `wasNew` deterministically — Prisma's
  // `upsert` doesn't expose which branch fired, and a two-step transaction is
  // overkill at 30-member scale (carbone `training-debrief/service.ts`).
  const existing = await db.mindsetCheck.findUnique({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    select: { id: true },
  });

  const row = await db.mindsetCheck.upsert({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    create: {
      userId,
      weekStart: weekStartDb,
      instrumentVersion: input.instrumentVersion,
      responses: input.responses,
    },
    update: {
      instrumentVersion: input.instrumentVersion,
      responses: input.responses,
    },
  });

  return { check: toSerialized(row), wasNew: existing == null };
}

// =============================================================================
// Reads (user-scoped)
// =============================================================================

/** Read a member's check for a specific week. Returns `null` if absent. */
export async function getMindsetCheck(
  userId: string,
  weekStart: string,
): Promise<SerializedMindsetCheck | null> {
  const weekStartDb = parseLocalDate(weekStart);
  const row = await db.mindsetCheck.findUnique({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
  });
  return row ? toSerialized(row) : null;
}

/**
 * Read a member's check by cuid. User-scoped — returns `null` if the row
 * belongs to a different member (no enumeration leak via 404). Single
 * `findFirst({ id, userId })` (V1.9 TIER B canon: one SQL, no timing oracle).
 */
export async function getMindsetCheckById(
  userId: string,
  id: string,
): Promise<SerializedMindsetCheck | null> {
  if (id.length === 0 || id.length > 64) return null;
  const row = await db.mindsetCheck.findFirst({ where: { id, userId } });
  return row ? toSerialized(row) : null;
}

/**
 * List the member's most recent checks (newest first). Default `limit=12`
 * (a quarter), enough for the landing timeline without pagination. 1..52.
 */
export async function listMyRecentMindsetChecks(
  userId: string,
  limit = 12,
): Promise<SerializedMindsetCheck[]> {
  const rows = await db.mindsetCheck.findMany({
    where: { userId },
    orderBy: { weekStart: 'desc' },
    take: Math.max(1, Math.min(limit, 52)),
  });
  return rows.map(toSerialized);
}

/**
 * List every check of a member for Eliott's READ-ONLY admin view
 * (`/admin/members/[id]`, SPEC §27.4). Admin-scoping is the caller's
 * responsibility (the admin page gates `role === 'admin'`); this is a plain
 * user-scoped read by `memberId`, newest first, bounded.
 */
export async function listMindsetChecksForMember(
  memberId: string,
  limit = 52,
): Promise<SerializedMindsetCheck[]> {
  const rows = await db.mindsetCheck.findMany({
    where: { userId: memberId },
    orderBy: { weekStart: 'desc' },
    take: Math.max(1, Math.min(limit, 104)),
  });
  return rows.map(toSerialized);
}

// =============================================================================
// Composed read — profile + trend (PURE compute, never stored)
// =============================================================================

/**
 * Load everything the member dashboard / admin panel needs in ONE place:
 * recent checks + this week's check + the latest profile + the per-dimension
 * trend. The profile/trend are computed PURELY from the member's OWN mindset
 * rows (no real-edge read) — §21.5/§27.7 trivially satisfied by construction.
 */
export async function loadMindsetDashboardData(
  userId: string,
  currentWeekStart: string,
  recentLimit = 12,
): Promise<MindsetDashboardData> {
  const recent = await listMyRecentMindsetChecks(userId, recentLimit);
  const currentWeek = recent.find((c) => c.weekStart === currentWeekStart) ?? null;

  // `recent` is newest-first; the latest profile uses recent[0].
  const latest = recent[0];
  const latestProfile = latest
    ? computeMindsetProfile(latest.instrumentVersion, latest.responses)
    : null;

  const trend = buildMindsetTrend(recent.map(toRecord)).dimensions;

  return { recent, currentWeek, latestProfile, trend };
}
