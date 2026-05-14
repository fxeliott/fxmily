import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type {
  RealizedRSource,
  TradeDirection,
  TradeOutcome,
  TradeQuality,
  TradeSession,
} from '@/generated/prisma/enums';
import type { TradeModel } from '@/generated/prisma/models/Trade';

import { db } from '@/lib/db';
import { computeRealizedR } from '@/lib/trading/calculations';

import { mergeNotes } from './notes';

/**
 * Trade journal service layer (J2).
 *
 * All exported functions are user-scoped: they take a `userId` and refuse
 * to read or mutate any trade that doesn't belong to that user (defence in
 * depth — the proxy already checks the session, and the Server Actions
 * call `auth()` again before invoking us). Admins use a separate service
 * (J3 — `lib/trades/admin-service.ts`) that bypasses ownership; we keep
 * the two surfaces distinct on purpose.
 *
 * Numeric inputs are plain `number`s. Prisma 7's Decimal column accepts a
 * number transparently and the precision matches our `Decimal(20, 8)` /
 * `Decimal(6, 2)` columns up to 15 significant digits, which is well
 * above any retail trading need.
 */

// ----- Public API types -------------------------------------------------------

export interface CreateTradeInput {
  pair: string;
  direction: TradeDirection;
  session: TradeSession;
  enteredAt: Date;
  entryPrice: number;
  lotSize: number;
  stopLossPrice: number | null;
  plannedRR: number;
  /// V1.5 — Steenbarger setup quality. Optional, NULL when not captured.
  tradeQuality?: TradeQuality | null;
  /// V1.5 — Tharp risk % of account. Optional, NULL when not captured.
  riskPct?: number | null;
  emotionBefore: string[];
  planRespected: boolean;
  hedgeRespected: boolean | null;
  notes: string | undefined;
  screenshotEntryKey: string;
}

export interface CloseTradeInput {
  exitedAt: Date;
  exitPrice: number;
  outcome: TradeOutcome;
  emotionAfter: string[];
  /** V1.8 — post-outcome LESSOR + Steenbarger bias tags (max 3, allowlisted Zod-side). */
  tags?: readonly string[];
  notes: string | undefined;
  screenshotExitKey: string;
}

/**
 * JSON-safe view of a `Trade` for client components and admin lists.
 * Prisma `Decimal` → `string`, `Date` → `string` (ISO 8601). Booleans and
 * enums are passed through.
 */
export interface SerializedTrade {
  id: string;
  userId: string;
  pair: string;
  direction: TradeDirection;
  session: TradeSession;
  enteredAt: string;
  entryPrice: string;
  lotSize: string;
  stopLossPrice: string | null;
  plannedRR: string;
  /// V1.5 — Steenbarger setup quality (A/B/C/null).
  tradeQuality: TradeQuality | null;
  /// V1.5 — Tharp risk % of account (Decimal as string, null when not captured).
  riskPct: string | null;
  emotionBefore: string[];
  planRespected: boolean;
  hedgeRespected: boolean | null;
  notes: string | null;
  screenshotEntryKey: string | null;
  // Post-exit (nullable until closed)
  exitedAt: string | null;
  exitPrice: string | null;
  outcome: TradeOutcome | null;
  realizedR: string | null;
  realizedRSource: RealizedRSource | null;
  emotionAfter: string[];
  screenshotExitKey: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True iff `closedAt` is set. Convenience flag for UI. */
  isClosed: boolean;
}

export type TradeStatusFilter = 'all' | 'open' | 'closed';

export interface ListTradesOptions {
  status?: TradeStatusFilter;
  /** 1–50, default 20. */
  limit?: number;
  /** Trade id to read after (cursor pagination). */
  cursor?: string | undefined;
}

export interface ListTradesResult {
  items: SerializedTrade[];
  nextCursor: string | null;
}

// ----- Helpers ----------------------------------------------------------------

function toSerialized(trade: TradeModel): SerializedTrade {
  return {
    id: trade.id,
    userId: trade.userId,
    pair: trade.pair,
    direction: trade.direction,
    session: trade.session,
    enteredAt: trade.enteredAt.toISOString(),
    entryPrice: trade.entryPrice.toString(),
    lotSize: trade.lotSize.toString(),
    stopLossPrice: trade.stopLossPrice == null ? null : trade.stopLossPrice.toString(),
    plannedRR: trade.plannedRR.toString(),
    tradeQuality: trade.tradeQuality,
    riskPct: trade.riskPct == null ? null : trade.riskPct.toString(),
    emotionBefore: [...trade.emotionBefore],
    planRespected: trade.planRespected,
    hedgeRespected: trade.hedgeRespected,
    notes: trade.notes,
    screenshotEntryKey: trade.screenshotEntryKey,
    exitedAt: trade.exitedAt ? trade.exitedAt.toISOString() : null,
    exitPrice: trade.exitPrice == null ? null : trade.exitPrice.toString(),
    outcome: trade.outcome,
    realizedR: trade.realizedR == null ? null : trade.realizedR.toString(),
    realizedRSource: trade.realizedRSource,
    emotionAfter: [...trade.emotionAfter],
    screenshotExitKey: trade.screenshotExitKey,
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    isClosed: trade.closedAt !== null,
  };
}

// ----- Service ----------------------------------------------------------------

export class TradeNotFoundError extends Error {
  constructor() {
    super('trade not found');
    this.name = 'TradeNotFoundError';
  }
}

export class TradeAlreadyClosedError extends Error {
  constructor() {
    super('trade is already closed');
    this.name = 'TradeAlreadyClosedError';
  }
}

export async function createTrade(
  userId: string,
  input: CreateTradeInput,
): Promise<SerializedTrade> {
  const trade = await db.trade.create({
    data: {
      userId,
      pair: input.pair,
      direction: input.direction,
      session: input.session,
      enteredAt: input.enteredAt,
      entryPrice: new Prisma.Decimal(input.entryPrice),
      lotSize: new Prisma.Decimal(input.lotSize),
      stopLossPrice: input.stopLossPrice == null ? null : new Prisma.Decimal(input.stopLossPrice),
      plannedRR: new Prisma.Decimal(input.plannedRR),
      // V1.5 — Steenbarger setup quality + Tharp risk %.
      tradeQuality: input.tradeQuality ?? null,
      riskPct: input.riskPct == null ? null : new Prisma.Decimal(input.riskPct),
      emotionBefore: input.emotionBefore,
      planRespected: input.planRespected,
      hedgeRespected: input.hedgeRespected,
      notes: input.notes ?? null,
      screenshotEntryKey: input.screenshotEntryKey,
    },
  });
  return toSerialized(trade);
}

/**
 * Finalize an open trade with the post-exit block. Computes `realizedR` and
 * tags `realizedRSource`. Refuses if the trade is already closed.
 */
export async function closeTrade(
  userId: string,
  tradeId: string,
  input: CloseTradeInput,
): Promise<SerializedTrade> {
  const updated = await db.$transaction(async (tx) => {
    const existing = await tx.trade.findUnique({
      where: { id: tradeId },
      select: {
        id: true,
        userId: true,
        direction: true,
        entryPrice: true,
        stopLossPrice: true,
        plannedRR: true,
        closedAt: true,
        notes: true,
      },
    });

    if (!existing || existing.userId !== userId) {
      throw new TradeNotFoundError();
    }
    if (existing.closedAt !== null) {
      throw new TradeAlreadyClosedError();
    }

    const realized = computeRealizedR({
      direction: existing.direction,
      entryPrice: existing.entryPrice.toNumber(),
      exitPrice: input.exitPrice,
      stopLossPrice: existing.stopLossPrice ? existing.stopLossPrice.toNumber() : null,
      plannedRR: existing.plannedRR.toNumber(),
      outcome: input.outcome,
    });

    // Notes are append-only at close: keep the pre-entry notes verbatim and
    // suffix the new ones under a delimiter. Both reads happen within the
    // same transaction; the row will be locked by the upcoming UPDATE.
    const mergedNotes = mergeNotes(existing.notes, input.notes);

    return tx.trade.update({
      where: { id: tradeId },
      data: {
        exitedAt: input.exitedAt,
        exitPrice: new Prisma.Decimal(input.exitPrice),
        outcome: input.outcome,
        realizedR: new Prisma.Decimal(realized.value),
        realizedRSource: realized.source,
        emotionAfter: input.emotionAfter,
        // V1.8 — persist post-outcome bias tags. Defaults to `[]` so V1 trades
        // closed before V1.8 stay valid ; explicit `[]` overrides any prior
        // value (admin edits go through a dedicated path).
        tags: [...(input.tags ?? [])],
        screenshotExitKey: input.screenshotExitKey,
        closedAt: new Date(),
        ...(mergedNotes !== existing.notes ? { notes: mergedNotes } : {}),
      },
    });
  });

  return toSerialized(updated);
}

export async function getTradeById(
  userId: string,
  tradeId: string,
): Promise<SerializedTrade | null> {
  const trade = await db.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.userId !== userId) return null;
  return toSerialized(trade);
}

export async function listTradesForUser(
  userId: string,
  options: ListTradesOptions = {},
): Promise<ListTradesResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const status = options.status ?? 'all';

  const where: Prisma.TradeWhereInput = { userId };
  if (status === 'open') where.closedAt = null;
  if (status === 'closed') where.closedAt = { not: null };

  const trades = await db.trade.findMany({
    where,
    orderBy: { enteredAt: 'desc' },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = trades.length > limit;
  const items = hasMore ? trades.slice(0, limit) : trades;

  return {
    items: items.map(toSerialized),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export async function deleteTrade(userId: string, tradeId: string): Promise<void> {
  const result = await db.trade.deleteMany({ where: { id: tradeId, userId } });
  if (result.count === 0) {
    throw new TradeNotFoundError();
  }
}

/**
 * Total counts by open/closed state. Used by the journal list page so the
 * footer ("3 ouverts · 12 clôturés") stays accurate regardless of the
 * active filter.
 */
export async function countTradesByStatus(
  userId: string,
): Promise<{ open: number; closed: number }> {
  const [open, closed] = await Promise.all([
    db.trade.count({ where: { userId, closedAt: null } }),
    db.trade.count({ where: { userId, closedAt: { not: null } } }),
  ]);
  return { open, closed };
}
