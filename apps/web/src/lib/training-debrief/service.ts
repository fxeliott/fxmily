import 'server-only';

import { db } from '@/lib/db';
import { parseLocalDate } from '@/lib/checkin/timezone';
import type { TrainingDebriefInput } from '@/lib/schemas/training-debrief';

import {
  computeTrainingDebriefStats,
  selectWeekTrades,
  type TrainingDebriefStatTrade,
  type TrainingDebriefStats,
} from './stats';

/**
 * V1.3 — `TrainingDebrief` service layer (SPEC §23).
 *
 * User-scoped strict — every function takes a `userId` and never touches
 * another member's rows (defence-in-depth on top of the Server Action's
 * `auth()` re-check). Free-text is sanitised at the Zod boundary (caller).
 *
 * `weekStart` enters as a validated `YYYY-MM-DD` Monday string; we convert to
 * a UTC-midnight `Date` via `parseLocalDate` (carbone `weekly-review/
 * service.ts`) so Postgres `@db.Date` truncation never drifts a day across
 * timezones (invariant PR#96).
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5 — BLOCKING). `loadTrainingDebriefStats`
 * reads `db.trainingTrade` with an EXPLICIT `select` of only the four safe
 * columns (`id`, `enteredAt`, `pair`, `systemRespected`, `lessonLearned`) — it
 * NEVER selects `resultR` / `outcome` / `plannedRR`. The annotation rollup is
 * a bare `count`. The blocking anti-leak suite pins this query shape.
 */

// =============================================================================
// Public API types
// =============================================================================

/**
 * JSON-safe view of `TrainingDebrief` for client components.
 * `Date` → `YYYY-MM-DD` / ISO timestamp. No PII outside `userId`.
 */
export interface SerializedTrainingDebrief {
  id: string;
  userId: string;
  weekStart: string; // YYYY-MM-DD
  processStrengthOne: string;
  processStrengthTwo: string;
  microAdjustment: string;
  transversalLesson: string;
  submittedAt: string; // ISO
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface SubmitTrainingDebriefResult {
  debrief: SerializedTrainingDebrief;
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
  processStrengthOne: string;
  processStrengthTwo: string;
  microAdjustment: string;
  transversalLesson: string;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): SerializedTrainingDebrief {
  return {
    id: row.id,
    userId: row.userId,
    weekStart: row.weekStart.toISOString().slice(0, 10),
    processStrengthOne: row.processStrengthOne,
    processStrengthTwo: row.processStrengthTwo,
    microAdjustment: row.microAdjustment,
    transversalLesson: row.transversalLesson,
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Persist a training debrief — upserts on `(userId, weekStart)` so a member
 * who re-opens the wizard for an already-submitted week updates in place
 * (idempotency, SPEC §23.4 — re-submit same week = 1 row).
 *
 * Returns the serialized row + a `wasNew` flag (create vs update branch),
 * useful for audit metadata + UX "enregistré" vs "mis à jour".
 */
export async function submitTrainingDebrief(
  userId: string,
  input: TrainingDebriefInput,
): Promise<SubmitTrainingDebriefResult> {
  const weekStartDb = parseLocalDate(input.weekStart);

  // Pre-check existence to decide `wasNew` deterministically — Prisma's
  // `upsert` doesn't expose which branch fired, and a two-step transaction is
  // overkill at 30-member scale (carbone `weekly-review/service.ts`).
  const existing = await db.trainingDebrief.findUnique({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    select: { id: true },
  });

  const row = await db.trainingDebrief.upsert({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    create: {
      userId,
      weekStart: weekStartDb,
      processStrengthOne: input.processStrengthOne,
      processStrengthTwo: input.processStrengthTwo,
      microAdjustment: input.microAdjustment,
      transversalLesson: input.transversalLesson,
    },
    update: {
      processStrengthOne: input.processStrengthOne,
      processStrengthTwo: input.processStrengthTwo,
      microAdjustment: input.microAdjustment,
      transversalLesson: input.transversalLesson,
      submittedAt: new Date(), // bump on edit so the timeline reflects the latest pass
    },
  });

  return { debrief: toSerialized(row), wasNew: existing == null };
}

// =============================================================================
// Reads
// =============================================================================

/** Read a member's debrief for a specific week. Returns `null` if absent. */
export async function getTrainingDebrief(
  userId: string,
  weekStart: string,
): Promise<SerializedTrainingDebrief | null> {
  const weekStartDb = parseLocalDate(weekStart);
  const row = await db.trainingDebrief.findUnique({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
  });
  return row ? toSerialized(row) : null;
}

/**
 * Read a member's debrief by cuid. User-scoped — returns `null` if the row
 * belongs to a different member (no enumeration leak via 404). Single
 * `findFirst({ id, userId })` (V1.9 TIER B canon: one SQL, no timing oracle).
 */
export async function getTrainingDebriefById(
  userId: string,
  id: string,
): Promise<SerializedTrainingDebrief | null> {
  if (id.length === 0 || id.length > 64) return null;
  const row = await db.trainingDebrief.findFirst({ where: { id, userId } });
  return row ? toSerialized(row) : null;
}

/**
 * List the member's most recent debriefs (newest first). Default `limit=12`
 * = a quarter's worth, enough for the landing timeline (SPEC §23.4) without
 * pagination. Bounded 1..52.
 */
export async function listMyRecentTrainingDebriefs(
  userId: string,
  limit = 12,
): Promise<SerializedTrainingDebrief[]> {
  const rows = await db.trainingDebrief.findMany({
    where: { userId },
    orderBy: { weekStart: 'desc' },
    take: Math.max(1, Math.min(limit, 52)),
  });
  return rows.map(toSerialized);
}

/**
 * List every debrief of a member for Eliott's READ-ONLY admin view
 * (`/admin/members/[id]?tab=training`, SPEC §23.4). Admin-scoping is the
 * caller's responsibility (the admin page already gates `role === 'admin'`);
 * this is a plain user-scoped read by `memberId`, newest first. Bounded so a
 * prolific member can't unbound the admin render.
 */
export async function listTrainingDebriefsForMember(
  memberId: string,
  limit = 52,
): Promise<SerializedTrainingDebrief[]> {
  const rows = await db.trainingDebrief.findMany({
    where: { userId: memberId },
    orderBy: { weekStart: 'desc' },
    take: Math.max(1, Math.min(limit, 104)),
  });
  return rows.map(toSerialized);
}

// =============================================================================
// §21.5-sensitive read — process stats (computed, never stored)
// =============================================================================

/**
 * Load the process-stats panel for `(userId, weekStart)`.
 *
 * 🚨 §21.5 (BLOCKING): the `db.trainingTrade` query selects ONLY the four safe
 * columns — NEVER `resultR` / `outcome` / `plannedRR`. The annotation rollup
 * is a bare `count` on the in-week backtest ids (no comment text, no P&L).
 * The pure aggregator (`./stats.ts`) then computes the 4 families.
 *
 * Fetch window: an ASYMMETRIC UTC slack of `[weekStartDb − 1 day,
 * weekStartDb + 8 days]` around the Paris week `[weekStart, weekStart+6j]`.
 * `weekStartDb` is the Monday at UTC-midnight; Paris is UTC+1 (CET) / UTC+2
 * (CEST), so the earliest in-week instant is Mon-00:00 Paris = Sun 22:00/23:00
 * UTC (covered by the `−1 day` lower bound) and the latest is Sun-23:59 Paris
 * = Sun 21:59/22:59 UTC (amply covered by the `+8 days` upper bound, i.e. the
 * NEXT Tuesday 00:00 UTC). The over-fetch is deliberate — the pure
 * `selectWeekTrades` then narrows precisely by Europe/Paris civil day in BOTH
 * DST regimes (invariant §23.7; the CET-winter boundary is pinned by
 * `stats.test.ts`). Belt-and-suspenders, like the Habit×Trade loader.
 */
export async function loadTrainingDebriefStats(
  userId: string,
  weekStart: string,
): Promise<TrainingDebriefStats> {
  const weekStartDb = parseLocalDate(weekStart);
  const fetchFrom = new Date(weekStartDb);
  fetchFrom.setUTCDate(fetchFrom.getUTCDate() - 1);
  const fetchTo = new Date(weekStartDb);
  fetchTo.setUTCDate(fetchTo.getUTCDate() + 8);

  const rows = await db.trainingTrade.findMany({
    where: { userId, enteredAt: { gte: fetchFrom, lte: fetchTo } },
    // 🚨 §21.5 — EXPLICIT safe projection. NEVER add resultR/outcome/plannedRR.
    select: {
      id: true,
      enteredAt: true,
      pair: true,
      systemRespected: true,
      lessonLearned: true,
    },
  });

  const candidates: TrainingDebriefStatTrade[] = rows.map((r) => ({
    id: r.id,
    enteredAt: r.enteredAt.toISOString(),
    pair: r.pair,
    systemRespected: r.systemRespected,
    lessonLearned: r.lessonLearned,
  }));

  // Single source of truth for the in-week set: `inWeek` feeds BOTH the
  // annotation count and the stat families. We pass `inWeek` (not
  // `candidates`) to the aggregator so the two cannot diverge — the internal
  // `selectWeekTrades` re-filter stays (idempotent on an already-in-week set)
  // as a defence if the function is ever called directly with raw candidates.
  const inWeek = selectWeekTrades(candidates, weekStart);
  const annotationCount =
    inWeek.length === 0
      ? 0
      : await db.trainingAnnotation.count({
          where: { trainingTradeId: { in: inWeek.map((t) => t.id) } },
        });

  return computeTrainingDebriefStats(inWeek, annotationCount, weekStart);
}

/**
 * Batched variant of `loadTrainingDebriefStats` for the admin training tab,
 * which renders up to 12 weekly debriefs at once (SPEC §23.4). Instead of N+1
 * (1 `findMany` + 1 `count` PER week = up to 25 queries), this runs exactly TWO
 * queries — one `findMany` over the union window [min−1d, max+8d] and one
 * annotation `groupBy` over all in-range backtest ids — then dispatches per week
 * in memory via the pure `selectWeekTrades` (S8 verif-layer; closes backlog P2
 * MAJ-36 "N+1 onglet training", held in S7 by §21.5 prudence).
 *
 * 🚨 §21.5 (BLOCKING) — IDENTICAL safe contract as `loadTrainingDebriefStats`:
 * the `db.trainingTrade` query selects ONLY the four safe columns (NEVER
 * `resultR`/`outcome`/`plannedRR`) and the annotation rollup is a bare
 * `groupBy` count (no comment text, no P&L). Block F's source-grep + the new
 * `service.test.ts` runtime assertion pin this query shape.
 */
export async function loadTrainingDebriefStatsForWeeks(
  userId: string,
  weekStarts: string[],
): Promise<Map<string, TrainingDebriefStats>> {
  if (weekStarts.length === 0) return new Map();

  // Union fetch window covering every requested week: [min−1d, max+8d] UTC —
  // same asymmetric Paris-DST slack as the single-week loader, applied to the
  // earliest/latest Monday so `selectWeekTrades` can narrow each week precisely.
  const bases = weekStarts.map((w) => parseLocalDate(w));
  const minBase = bases.reduce((a, b) => (a < b ? a : b));
  const maxBase = bases.reduce((a, b) => (a > b ? a : b));
  const fetchFrom = new Date(minBase);
  fetchFrom.setUTCDate(fetchFrom.getUTCDate() - 1);
  const fetchTo = new Date(maxBase);
  fetchTo.setUTCDate(fetchTo.getUTCDate() + 8);

  const rows = await db.trainingTrade.findMany({
    where: { userId, enteredAt: { gte: fetchFrom, lte: fetchTo } },
    // 🚨 §21.5 — EXPLICIT safe projection. NEVER add resultR/outcome/plannedRR.
    select: {
      id: true,
      enteredAt: true,
      pair: true,
      systemRespected: true,
      lessonLearned: true,
    },
  });

  const candidates: TrainingDebriefStatTrade[] = rows.map((r) => ({
    id: r.id,
    enteredAt: r.enteredAt.toISOString(),
    pair: r.pair,
    systemRespected: r.systemRespected,
    lessonLearned: r.lessonLearned,
  }));

  // ONE groupBy for ALL in-range backtests — bare count, never findMany of
  // comments/P&L. Empty range → no query (mirror the single-week guard).
  const annByTrade =
    candidates.length === 0
      ? new Map<string, number>()
      : new Map(
          (
            await db.trainingAnnotation.groupBy({
              by: ['trainingTradeId'],
              where: { trainingTradeId: { in: candidates.map((c) => c.id) } },
              _count: { _all: true },
            })
          ).map((g) => [g.trainingTradeId, g._count._all]),
        );

  const out = new Map<string, TrainingDebriefStats>();
  for (const weekStart of weekStarts) {
    const inWeek = selectWeekTrades(candidates, weekStart);
    const annotationCount = inWeek.reduce((sum, t) => sum + (annByTrade.get(t.id) ?? 0), 0);
    out.set(weekStart, computeTrainingDebriefStats(inWeek, annotationCount, weekStart));
  }
  return out;
}
