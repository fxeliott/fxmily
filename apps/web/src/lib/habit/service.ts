import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { habitLogInputSchema, type HabitKind, type HabitLogInput } from '@/lib/schemas/habit-log';

/**
 * V2.0 TRACK — `HabitLog` service layer.
 *
 * Posture : user-scoped strict. Every function takes a `userId` and never
 * touches another member's rows (defense-in-depth on top of the Server
 * Action's `auth()` re-check). Free-text + structured value are sanitized /
 * shape-validated at the Zod boundary (caller responsibility).
 *
 * Idempotency : `(userId, date, kind)` is unique. `upsertHabitLog` performs
 * a Prisma `upsert` so re-submitting the same kind for the same date
 * replaces the prior value (rather than throwing P2002). This matches the
 * morning check-in pattern (one row per slot per day).
 */

// =============================================================================
// Public API types
// =============================================================================

export interface SerializedHabitLog {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  kind: HabitKind;
  /**
   * The raw JSON payload. Callers can cast through the matching `HabitKind`
   * value schema (`sleepValueSchema.parse`, etc.) to type-narrow.
   */
  value: unknown;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertHabitLogResult {
  log: SerializedHabitLog;
  /** True if the row didn't exist before (create branch). */
  wasNew: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

interface HabitLogRow {
  id: string;
  userId: string;
  date: Date;
  kind: HabitKind;
  value: Prisma.JsonValue;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSerialized(row: HabitLogRow): SerializedHabitLog {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString().slice(0, 10),
    kind: row.kind,
    value: row.value,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Persist a habit log — upserts on `(userId, date, kind)` so a member who
 * re-fills the same kind for the same day replaces the prior value rather
 * than colliding on the unique constraint.
 */
export async function upsertHabitLog(
  userId: string,
  input: HabitLogInput,
): Promise<UpsertHabitLogResult> {
  // Belt-and-suspenders re-parse (V1.9 R2 security-auditor catch M3) —
  // services are user-scoped trust boundaries too. A caller bypassing the
  // Server Action layer (refactor, internal cron, test helper) can pass an
  // unvalidated object cast to `HabitLogInput`. Re-parsing here costs <1ms
  // and pins the shape against type-cast leaks across the boundary.
  const safe = habitLogInputSchema.parse(input);
  const dateDb = parseLocalDate(safe.date);

  const existing = await db.habitLog.findUnique({
    where: { userId_date_kind: { userId, date: dateDb, kind: safe.kind } },
    select: { id: true },
  });

  // Prisma's `Json` field accepts our validated shape — the value type is
  // generic-by-design at the DB layer (kind-specific shape is the Zod's
  // responsibility, not Prisma's).
  const valueJson = safe.value as unknown as Prisma.InputJsonValue;

  const row = await db.habitLog.upsert({
    where: { userId_date_kind: { userId, date: dateDb, kind: safe.kind } },
    create: {
      userId,
      date: dateDb,
      kind: safe.kind,
      value: valueJson,
      notes: safe.notes ?? null,
    },
    update: {
      value: valueJson,
      notes: safe.notes ?? null,
    },
  });

  return {
    log: toSerialized(row as unknown as HabitLogRow),
    wasNew: existing == null,
  };
}

// =============================================================================
// Reads
// =============================================================================

/**
 * Read a single habit log by id, user-scoped. Returns `null` if the row
 * belongs to another member — defense-in-depth via `findFirst({ id, userId })`
 * (pattern carbone V1.9 TIER B `getWeeklyReviewById`).
 */
export async function getHabitLogById(
  userId: string,
  id: string,
): Promise<SerializedHabitLog | null> {
  if (id.length === 0 || id.length > 64) return null;
  const row = await db.habitLog.findFirst({ where: { id, userId } });
  return row ? toSerialized(row as unknown as HabitLogRow) : null;
}

/**
 * List a member's logs from the last `windowDays` days (default 30, max 90),
 * newest first. All kinds in one query — caller filters by kind if needed.
 */
export async function listRecentHabitLogs(
  userId: string,
  windowDays = 30,
): Promise<SerializedHabitLog[]> {
  const bounded = Math.max(1, Math.min(windowDays, 90));
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - bounded);
  horizon.setUTCHours(0, 0, 0, 0);

  const rows = await db.habitLog.findMany({
    where: { userId, date: { gte: horizon } },
    orderBy: [{ date: 'desc' }, { kind: 'asc' }],
  });
  return rows.map((r) => toSerialized(r as unknown as HabitLogRow));
}

/**
 * List a member's logs for a specific kind over `windowDays` days. Hits the
 * `(userId, kind, date desc)` index — constant cost regardless of cohort size.
 */
export async function listHabitLogsByKind(
  userId: string,
  kind: HabitKind,
  windowDays = 30,
): Promise<SerializedHabitLog[]> {
  const bounded = Math.max(1, Math.min(windowDays, 90));
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - bounded);
  horizon.setUTCHours(0, 0, 0, 0);

  const rows = await db.habitLog.findMany({
    where: { userId, kind, date: { gte: horizon } },
    orderBy: { date: 'desc' },
  });
  return rows.map((r) => toSerialized(r as unknown as HabitLogRow));
}

// =============================================================================
// V2.1.3 — Habit × Trade correlation data loader
// =============================================================================

/** Serialized trade slice for the correlation (Decimal -> number at the
 *  boundary, never crossing the RSC/client edge as a Prisma.Decimal). */
export interface TradeForCorrelation {
  /** ISO UTC datetime — the analytics layer buckets this to a Paris day. */
  enteredAt: string;
  /** `realized_r` as a finite number. Only `computed`-source rows are
   *  returned (callers never see `estimated` — see filter below). */
  realizedR: number;
  /** Present only when the member graded the setup (V1.5). */
  tradeQuality?: 'A' | 'B' | 'C';
}

export interface HabitTradeCorrelationData {
  habitLogs: SerializedHabitLog[];
  trades: TradeForCorrelation[];
}

/**
 * Load the inputs for the V2.1.3 correlation card: the member's recent
 * habit logs (all kinds, for the heatmap + per-kind pairing) and their
 * closed, *computed*-R trades over the same window.
 *
 * Why `realizedRSource = 'computed'` only: `estimated` R has no precise
 * magnitude (it's `plannedRR | -1 | 0` fallback) and would corrupt a
 * correlation. This mirrors the J6 expectancy/R-distribution convention
 * (`apps/web/CLAUDE.md` J6 TODO "exclude realizedRSource='estimated'").
 *
 * The day-matching itself (Europe/Paris wall-clock, never UTC slice) lives
 * in the pure `lib/analytics/habit-trade-correlation` module — this
 * function only fetches + serializes. Both queries are user-scoped and
 * index-backed (`habit_logs (userId, date desc)` /
 * `trades (userId, closedAt)` + `(userId, enteredAt desc)`).
 *
 * Fetch window = requested `windowDays` **+ 1 day slack** (symmetric on
 * both queries). The trade filter is `enteredAt >= horizon` (UTC) while
 * the pairing buckets to a Europe/Paris civil day — without the slack a
 * boundary-day trade could be fetched while its habit log isn't (or
 * vice-versa), silently dropping ≤1 pair at the window edge. The pure
 * module only pairs days present in BOTH sets, so an extra unmatched day
 * is harmless; the slack just removes the UTC/Paris boundary asymmetry
 * (code-review V2.1.3 T2#1). The *analytical* window the member sees
 * stays `windowDays`.
 */
export async function loadHabitTradeCorrelationData(
  userId: string,
  windowDays = 30,
): Promise<HabitTradeCorrelationData> {
  const bounded = Math.max(1, Math.min(windowDays, 90));
  // +1 day slack (symmetric on both queries) absorbs the Europe/Paris vs
  // UTC boundary — see JSDoc above. Clamped so it never exceeds the
  // `listRecentHabitLogs` 90-day ceiling (keeps both fetches symmetric).
  const fetchDays = Math.min(bounded + 1, 90);
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - fetchDays);
  horizon.setUTCHours(0, 0, 0, 0);

  const [habitLogs, tradeRows] = await Promise.all([
    listRecentHabitLogs(userId, fetchDays),
    db.trade.findMany({
      where: {
        userId,
        closedAt: { not: null },
        realizedR: { not: null },
        realizedRSource: 'computed',
        enteredAt: { gte: horizon },
      },
      select: { enteredAt: true, realizedR: true, tradeQuality: true },
      orderBy: { enteredAt: 'desc' },
    }),
  ]);

  const trades: TradeForCorrelation[] = [];
  for (const row of tradeRows) {
    if (row.realizedR == null) continue; // narrowed by the where, belt-and-suspenders
    const realizedR = Number(row.realizedR.toString());
    if (!Number.isFinite(realizedR)) continue;
    trades.push({
      enteredAt: row.enteredAt.toISOString(),
      realizedR,
      ...(row.tradeQuality ? { tradeQuality: row.tradeQuality } : {}),
    });
  }

  return { habitLogs, trades };
}
