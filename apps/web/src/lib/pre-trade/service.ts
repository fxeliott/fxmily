import 'server-only';

import { db } from '@/lib/db';
import type { PreTradeCheckInput } from '@/lib/schemas/pre-trade-check';
import {
  computePlanAlignmentRate,
  computeReasonDistribution,
  computeStopLossPredefinedRate,
  type PreTradeAnalyticsInput,
  type RateResult,
  type ReasonDistributionResult,
} from '@/lib/pre-trade/analytics';

/**
 * V2.3 — `PreTradeCheck` service layer (Session BB, ADR-003).
 *
 * User-scoped strict. Pattern J5 `lib/checkin/service.ts` carbone — pure
 * functions over Prisma client, never touches `auth()` (Server Action
 * boundary), never touches `headers()` (Edge runtime hazard).
 *
 * Serialization : `Date → ISO` for client-component consumption (RSC
 * cannot serialize `Date` natively in some setups). No `Decimal` in this
 * model so no `.toString()` dance (cf. `SerializedTrade`).
 *
 * Auto-link : a Trade created within `LINK_DEFAULT_WINDOW_MIN` minutes of
 * a PreTradeCheck gets the check's `linkedTradeId` updated (best-effort,
 * V1 single-instance race window documented). See `linkRecentCheckToTrade`
 * JSDoc for race notes.
 */

/**
 * Default window (in minutes) within which a Trade auto-links to the most
 * recent unlinked PreTradeCheck. Empirical retail intraday decision→entry
 * latency = ~5-15 min ; 15 min covers ~90 % of legitimate flows without
 * over-attributing late entries to old checks.
 */
export const LINK_DEFAULT_WINDOW_MIN = 15;

/**
 * Hard cap on `listRecentPreTradeChecks` page size — defense against a
 * caller passing `Number.MAX_SAFE_INTEGER` and forcing a full-table scan.
 */
export const MAX_LIST_LIMIT = 100;

/**
 * Serialized shape returned to client components. `createdAt` is ISO
 * string ; `linkedTradeId` keeps its nullable string nature.
 */
export interface SerializedPreTradeCheck {
  id: string;
  userId: string;
  createdAt: string; // ISO 8601
  reasonToTrade: 'edge' | 'fomo' | 'revenge' | 'boredom';
  emotionLabel: 'calme' | 'excite' | 'frustre' | 'anxieux';
  planAlignment: boolean;
  stopLossPredefined: boolean;
  linkedTradeId: string | null;
}

interface PreTradeCheckRow {
  id: string;
  userId: string;
  createdAt: Date;
  reasonToTrade: SerializedPreTradeCheck['reasonToTrade'];
  emotionLabel: SerializedPreTradeCheck['emotionLabel'];
  planAlignment: boolean;
  stopLossPredefined: boolean;
  linkedTradeId: string | null;
}

function serialize(row: PreTradeCheckRow): SerializedPreTradeCheck {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    reasonToTrade: row.reasonToTrade,
    emotionLabel: row.emotionLabel,
    planAlignment: row.planAlignment,
    stopLossPredefined: row.stopLossPredefined,
    linkedTradeId: row.linkedTradeId,
  };
}

/**
 * Persist a new PreTradeCheck. Caller (Server Action) MUST have already
 * Zod-validated `input` against `preTradeCheckSchema`.
 */
export async function createPreTradeCheck(
  userId: string,
  input: PreTradeCheckInput,
): Promise<SerializedPreTradeCheck> {
  const row = await db.preTradeCheck.create({
    data: {
      userId,
      reasonToTrade: input.reasonToTrade,
      emotionLabel: input.emotionLabel,
      planAlignment: input.planAlignment,
      stopLossPredefined: input.stopLossPredefined,
    },
  });
  return serialize(row);
}

/**
 * List recent checks for a user, newest first. `limit` is clamped to
 * `[1, MAX_LIST_LIMIT]` (defense against `Number.MAX_SAFE_INTEGER` or
 * negative integers from a buggy caller).
 *
 * V1 has no pagination cursor — at 30 members × ~1 check / day = ~900
 * rows total, the dashboard widget reads only the top 20.
 */
export async function listRecentPreTradeChecks(
  userId: string,
  limit = 20,
): Promise<SerializedPreTradeCheck[]> {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), MAX_LIST_LIMIT);
  const rows = await db.preTradeCheck.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: safeLimit,
  });
  return rows.map(serialize);
}

/**
 * Auto-link the most recent unlinked PreTradeCheck for `userId` (created
 * within `windowMin` minutes) to the given `tradeId`. Returns the linked
 * check's id, or `null` if no match.
 *
 * Race window (acceptable V1, documented for V2 escalation) :
 *   - 2 trades created concurrently within the same window can both pass
 *     `findFirst` before either `update` lands. Postgres-level row-locking
 *     is NOT applied here ; the predicate `linkedTradeId: null` on the
 *     `update` `where` clause acts as optimistic locking, so the second
 *     update yields `count: 0` (no-op).
 *   - We catch Prisma `P2025` ("record not found / where clause failed")
 *     and treat it as "lost the race" → return null. The first trade
 *     wins, the second trade gets `null` (correct semantics — only ONE
 *     check should attribute to ONE trade).
 *
 * V2 if multi-instance scale : use Postgres advisory lock or
 * `SELECT ... FOR UPDATE SKIP LOCKED` in a transaction.
 */
/**
 * V2.3 ext #2 — Session HH backend (Dashboard analytics widget).
 *
 * Default window for analytics aggregation = 30 calendar days. Aligned with
 * scoring J6 (`windowDays = 30`), habit-trade-correlation V2.1.3 fetch window,
 * REFLECT V1.8 weekly cadence × 4. Member-meaningful timescale to detect
 * patterns without being too short (noise) or too long (stale signal).
 */
export const PRE_TRADE_ANALYTICS_DEFAULT_WINDOW_DAYS = 30;

/** Maximum window cap to prevent unbounded scans by buggy callers. */
const PRE_TRADE_ANALYTICS_MAX_WINDOW_DAYS = 365;

/**
 * Aggregated analytics for a member over a recent window (default 30 days).
 *
 * Three independent metrics — each uses the same sample-size floor
 * ({@link MIN_SAMPLE_PRE_TRADE_ANALYTICS}) so the UI can render them
 * coherently (all `ok` together, or all `insufficient_data` together).
 *
 * `asOf` is the ISO timestamp at which the window was computed (returned for
 * traceability / UI labels like "Données arrêtées au 27 mai 2026 08h").
 */
export interface PreTradeAnalyticsData {
  windowDays: number;
  asOf: string;
  reasonDistribution: ReasonDistributionResult;
  planAlignmentRate: RateResult;
  stopLossPredefinedRate: RateResult;
}

/**
 * Load the recent PreTradeChecks for a member, filtered by a sliding
 * `windowDays` window, and compute the three analytics dimensions via the
 * pure `lib/pre-trade/analytics` module.
 *
 * Single Prisma query (one `findMany`), narrow `select` (only the 3 fields
 * the analytics need + nothing else — data-minimality canon §16). Window
 * is computed via `now − windowDays * 86400000` (instant filter on
 * `createdAt`, NOT `@db.Date` — `PreTradeCheck.createdAt` is a `DateTime`
 * mirror of `Trade.enteredAt` and similar §21.1 timestamps, NOT a civil
 * calendar day like `DailyCheckin.date`).
 *
 * `windowDays` is clamped to `[1, 365]` to defeat caller-side abuse without
 * silently failing — `Math.min(Math.max(...), max)` mirrors
 * `linkRecentCheckToTrade` pattern.
 */
export async function loadPreTradeAnalyticsData(
  userId: string,
  windowDays: number = PRE_TRADE_ANALYTICS_DEFAULT_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<PreTradeAnalyticsData> {
  const safeWindow = Math.min(
    Math.max(1, Math.trunc(windowDays)),
    PRE_TRADE_ANALYTICS_MAX_WINDOW_DAYS,
  );
  const since = new Date(now.getTime() - safeWindow * 86_400_000);

  const rows = await db.preTradeCheck.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      reasonToTrade: true,
      planAlignment: true,
      stopLossPredefined: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const inputs: PreTradeAnalyticsInput[] = rows.map((row) => ({
    reasonToTrade: row.reasonToTrade,
    planAlignment: row.planAlignment,
    stopLossPredefined: row.stopLossPredefined,
  }));

  return {
    windowDays: safeWindow,
    asOf: now.toISOString(),
    reasonDistribution: computeReasonDistribution(inputs),
    planAlignmentRate: computePlanAlignmentRate(inputs),
    stopLossPredefinedRate: computeStopLossPredefinedRate(inputs),
  };
}

export async function linkRecentCheckToTrade(
  userId: string,
  tradeId: string,
  windowMin = LINK_DEFAULT_WINDOW_MIN,
): Promise<string | null> {
  const safeWindow = Math.min(Math.max(1, Math.trunc(windowMin)), 60 * 24); // cap 24h sanity
  const since = new Date(Date.now() - safeWindow * 60_000);

  const recent = await db.preTradeCheck.findFirst({
    where: {
      userId,
      linkedTradeId: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!recent) return null;

  try {
    // Optimistic locking via `linkedTradeId: null` predicate in `where`.
    // If a concurrent update has set linkedTradeId between findFirst and
    // here, Prisma throws P2025 ("record to update not found") → null.
    await db.preTradeCheck.update({
      where: { id: recent.id, linkedTradeId: null },
      data: { linkedTradeId: tradeId },
    });
    return recent.id;
  } catch (err) {
    // P2025 = record not found (lost the race). Other errors = bubble up.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
      return null;
    }
    throw err;
  }
}
