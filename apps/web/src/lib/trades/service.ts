import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type {
  RealizedRSource,
  TradeDirection,
  TradeExitReason,
  TradeOutcome,
  TradeQuality,
  TradeSession,
} from '@/generated/prisma/enums';
import type { TradeModel } from '@/generated/prisma/models/Trade';

import { db } from '@/lib/db';
import { selectStorage } from '@/lib/storage';
import { computeRealizedR } from '@/lib/trading/calculations';

import { mergeNotes } from './notes';
import { STALE_OPEN_TRADE_MS } from './stale-open-threshold';

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
  /// J1 — mandatory TradingView entry link (replaces the former screenshot
  /// upload). Host-allowlisted at the Zod / Server Action edge.
  tradingViewEntryUrl: string;
  /// Tour 13 — optional member explanation of the entry screen. Hardened +
  /// length-capped at the Zod edge. `undefined` → NULL in DB.
  tradingViewEntryNote?: string | null;
  /// J1 — legacy pre-entry screenshot key, now OPTIONAL (pre-J1 trades keep
  /// their capture; the wizard no longer uploads one). Null when absent.
  screenshotEntryKey?: string | null;
  /// §31 — additional entry analysis captures (TradeMedia kind=entry). The
  /// primary proof is now the TradingView link; these stay extra attachments.
  /// Already cap-checked + BOLA-validated by the Server Action.
  extraEntryKeys?: string[];
}

export interface CloseTradeInput {
  exitedAt: Date;
  exitPrice: number;
  outcome: TradeOutcome;
  /**
   * Tour 10 — factual nature of the exit (TP hit, SL hit, BE, manual before
   * target, 20h time-exit). `null` = not answered (OPTIONAL, no gate — CANON).
   * SPEC §2: the ACT of how the position ended, never a judgement.
   */
  exitReason: TradeExitReason | null;
  /** Emotions felt DURING the open position (recalled at close). Master prompt §22. */
  emotionDuring: string[];
  emotionAfter: string[];
  /**
   * SPEC §28/§21 — "oublis" axis. Tri-state: `true` (followed all process, forgot
   * nothing), `false` (forgot/missed steps), `null` (not answered — OPTIONAL).
   * Mirror of `hedgeRespected`. SPEC §2: the ACT of completeness only.
   */
  processComplete: boolean | null;
  /**
   * S26 — « Fidélité à la gestion ». Three management hard-rules of the method,
   * answered at close. Tri-state each (`true`/`false`/`null` = not answered).
   * SPEC §2: the ACT of following the member's OWN execution rule only.
   */
  slPerRule: boolean | null;
  movedToBe: boolean | null;
  partialAtTarget: boolean | null;
  /** V1.8 — post-outcome LESSOR + Steenbarger bias tags (max 3, allowlisted Zod-side). */
  tags?: readonly string[];
  notes: string | undefined;
  /// J1 — mandatory TradingView exit link (replaces the former exit screenshot
  /// upload at close). Host-allowlisted at the Zod / Server Action edge.
  tradingViewExitUrl: string;
  /// Tour 13 — optional member explanation of the exit screen. Hardened +
  /// length-capped at the Zod edge. `undefined` → NULL in DB.
  tradingViewExitNote?: string | null;
  /// J1 — legacy exit screenshot key, now OPTIONAL. Null when absent.
  screenshotExitKey?: string | null;
}

/**
 * JSON-safe view of a `Trade` for client components and admin lists.
 * Prisma `Decimal` → `string`, `Date` → `string` (ISO 8601). Booleans and
 * enums are passed through.
 */
/** §31 — a serialized additional trade photo (only the client-needed fields:
 *  the raw `fileKey` is never exposed, only its `readUrl`). */
export interface SerializedTradeMedia {
  id: string;
  kind: string;
  readUrl: string;
  createdAt: string;
}

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
  /** SPEC §28/§21 — "oublis" axis (tri-state: true / false / null=not answered). */
  processComplete: boolean | null;
  /** S26 — management-fidelity acts (tri-state each: true / false / null). */
  slPerRule: boolean | null;
  movedToBe: boolean | null;
  partialAtTarget: boolean | null;
  notes: string | null;
  screenshotEntryKey: string | null;
  /// J1 — TradingView entry link (mandatory for J1+ trades, null for pre-J1).
  tradingViewEntryUrl: string | null;
  /// Tour 13 — member's optional explanation of the entry screen (null when absent).
  tradingViewEntryNote: string | null;
  // Post-exit (nullable until closed)
  exitedAt: string | null;
  exitPrice: string | null;
  outcome: TradeOutcome | null;
  /** Tour 10 — factual exit nature (tri-state enum, null = not answered / legacy). */
  exitReason: TradeExitReason | null;
  realizedR: string | null;
  realizedRSource: RealizedRSource | null;
  emotionDuring: string[];
  emotionAfter: string[];
  screenshotExitKey: string | null;
  /// J1 — TradingView exit link (mandatory at close for J1+ trades, null for
  /// pre-J1 / still-open trades).
  tradingViewExitUrl: string | null;
  /// Tour 13 — member's optional explanation of the exit screen (null when absent).
  tradingViewExitNote: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True iff `closedAt` is set. Convenience flag for UI. */
  isClosed: boolean;
  /** §31 — additional entry analysis photos. Only `getTradeById` (the detail
   *  view) populates them; list/close/report serializations omit it. */
  media?: SerializedTradeMedia[];
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

function toSerialized(
  trade: TradeModel,
  media?: ReadonlyArray<{ id: string; kind: string; fileKey: string; createdAt: Date }>,
): SerializedTrade {
  const storage = selectStorage();
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
    processComplete: trade.processComplete,
    slPerRule: trade.slPerRule,
    movedToBe: trade.movedToBe,
    partialAtTarget: trade.partialAtTarget,
    notes: trade.notes,
    screenshotEntryKey: trade.screenshotEntryKey,
    tradingViewEntryUrl: trade.tradingViewEntryUrl,
    tradingViewEntryNote: trade.tradingViewEntryNote,
    exitedAt: trade.exitedAt ? trade.exitedAt.toISOString() : null,
    exitPrice: trade.exitPrice == null ? null : trade.exitPrice.toString(),
    outcome: trade.outcome,
    exitReason: trade.exitReason,
    realizedR: trade.realizedR == null ? null : trade.realizedR.toString(),
    realizedRSource: trade.realizedRSource,
    emotionDuring: [...trade.emotionDuring],
    emotionAfter: [...trade.emotionAfter],
    screenshotExitKey: trade.screenshotExitKey,
    tradingViewExitUrl: trade.tradingViewExitUrl,
    tradingViewExitNote: trade.tradingViewExitNote,
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    isClosed: trade.closedAt !== null,
    media: (media ?? []).map((m) => ({
      id: m.id,
      kind: m.kind,
      readUrl: storage.getReadUrl(m.fileKey),
      createdAt: m.createdAt.toISOString(),
    })),
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

/**
 * S2 audit 2026-06-11 — the only cross-field exit/entry check used to live in
 * `tradeFullSchema` (dead code for the real close path) : `closeTrade` happily
 * persisted `exitedAt < enteredAt`, poisoning durations, session attribution
 * and the future S3 reconciliation. Enforced here, where the trade row (and
 * its authoritative `enteredAt`) is loaded anyway.
 */
export class TradeExitBeforeEntryError extends Error {
  constructor() {
    super('exitedAt is before enteredAt');
    this.name = 'TradeExitBeforeEntryError';
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
      tradingViewEntryUrl: input.tradingViewEntryUrl,
      tradingViewEntryNote: input.tradingViewEntryNote ?? null,
      screenshotEntryKey: input.screenshotEntryKey ?? null,
      // §31 — additional entry photos written atomically with the trade via the
      // nested create (kind defaults to `entry`). Empty/absent → no media rows.
      ...(input.extraEntryKeys && input.extraEntryKeys.length > 0
        ? { media: { create: input.extraEntryKeys.map((fileKey) => ({ fileKey })) } }
        : {}),
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
        enteredAt: true,
      },
    });

    if (!existing || existing.userId !== userId) {
      throw new TradeNotFoundError();
    }
    if (existing.closedAt !== null) {
      throw new TradeAlreadyClosedError();
    }
    if (input.exitedAt.getTime() < existing.enteredAt.getTime()) {
      throw new TradeExitBeforeEntryError();
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
    // suffix the new ones under a delimiter. The findUnique above is a plain
    // read and takes NO row lock under READ COMMITTED, so the JS `closedAt`
    // guard alone cannot stop a concurrent double-close — the lock only
    // materialises at the UPDATE below, after both transactions have already
    // read closedAt=null. The optimistic `closedAt: null` predicate on the
    // UPDATE closes that window: the loser matches 0 rows → P2025 → folded to
    // TradeAlreadyClosedError, so a duplicate submit can never overwrite the
    // authoritative close (exit price / outcome / realizedR) nor double-append
    // the exit notes (RC#7 TX-1).
    const mergedNotes = mergeNotes(existing.notes, input.notes);

    try {
      return await tx.trade.update({
        where: { id: tradeId, closedAt: null },
        data: {
          exitedAt: input.exitedAt,
          exitPrice: new Prisma.Decimal(input.exitPrice),
          outcome: input.outcome,
          // Tour 10 — factual exit nature. Null passthrough (not answered is
          // NEVER coerced to a value the member did not give).
          exitReason: input.exitReason,
          realizedR: new Prisma.Decimal(realized.value),
          realizedRSource: realized.source,
          emotionDuring: input.emotionDuring,
          emotionAfter: input.emotionAfter,
          // SPEC §28/§21 — persist the "oublis" axis. Tri-state passed through
          // verbatim (null = not answered → never coerced to false, which would
          // fabricate a "forgot" signal the member never gave). Mirror of
          // hedgeRespected / marketAnalysisDone null-handling.
          processComplete: input.processComplete,
          // S26 — persist the 3 management-fidelity acts. Same null-passthrough as
          // processComplete: null (not answered) is NEVER coerced to false, which
          // would fabricate a "rule broken" signal the member never gave.
          slPerRule: input.slPerRule,
          movedToBe: input.movedToBe,
          partialAtTarget: input.partialAtTarget,
          // V1.8 — persist post-outcome bias tags. Defaults to `[]` so V1 trades
          // closed before V1.8 stay valid ; explicit `[]` overrides any prior
          // value (admin edits go through a dedicated path).
          tags: [...(input.tags ?? [])],
          tradingViewExitUrl: input.tradingViewExitUrl,
          tradingViewExitNote: input.tradingViewExitNote ?? null,
          screenshotExitKey: input.screenshotExitKey ?? null,
          closedAt: new Date(),
          ...(mergedNotes !== existing.notes ? { notes: mergedNotes } : {}),
        },
      });
    } catch (err) {
      // Optimistic-lock guard (RC#7 TX-1): the `closedAt: null` predicate
      // matched 0 rows because a concurrent close already committed between
      // our read and this write → Prisma P2025. Fold to the same already-closed
      // error the JS guard raises so the second writer is a deterministic
      // no-op, never a silent clobber of the authoritative close.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
        throw new TradeAlreadyClosedError();
      }
      throw err;
    }
  });

  return toSerialized(updated);
}

export async function getTradeById(
  userId: string,
  tradeId: string,
): Promise<SerializedTrade | null> {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    // §31 — the detail view is the only surface that renders the additional
    // entry photos ; list/close views keep `media: []` (no include).
    include: {
      media: {
        select: { id: true, kind: true, fileKey: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!trade || trade.userId !== userId) return null;
  return toSerialized(trade, trade.media);
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
    // `enteredAt` is member input at minute precision (non-unique) — without
    // the `id` tiebreaker, cursor pagination could skip or duplicate trades
    // whose sort keys collide between two requests (S4 review finding).
    orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = trades.length > limit;
  const items = hasMore ? trades.slice(0, limit) : trades;

  return {
    // NB: not `.map(toSerialized)` — `.map` would pass the index as the second
    // `media` arg. The list view never renders the gallery anyway.
    items: items.map((t) => toSerialized(t)),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export async function deleteTrade(userId: string, tradeId: string): Promise<void> {
  // Read the media keys (ownership-scoped) BEFORE deleting so we can sweep the
  // stored files. The row delete cascades the TradeAnnotation rows but never
  // their bytes — the trade's own entry/exit captures + every admin-authored
  // annotation media would otherwise orphan on disk indefinitely (no janitor
  // cron exists). RGPD §17: a member's images must not survive their trade.
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: {
      screenshotEntryKey: true,
      screenshotExitKey: true,
      annotations: { select: { mediaKey: true } },
      // §31 — the additional entry photos cascade as ROWS, but their stored
      // bytes must be swept too (RGPD §17), exactly like the scalar captures.
      media: { select: { fileKey: true } },
    },
  });
  if (!trade) {
    throw new TradeNotFoundError();
  }

  const result = await db.trade.deleteMany({ where: { id: tradeId, userId } });
  if (result.count === 0) {
    // Lost a race (deleted between the read and here) — treat as not found.
    throw new TradeNotFoundError();
  }

  // Best-effort storage sweep — never fail the deletion if a file is already
  // gone (mirror of the admin annotation cleanup pattern).
  const storage = selectStorage();
  const keys = [
    trade.screenshotEntryKey,
    trade.screenshotExitKey,
    ...trade.annotations.map((a) => a.mediaKey),
    ...trade.media.map((m) => m.fileKey),
  ].filter((key): key is string => key !== null);
  for (const key of keys) {
    void storage.delete(key).catch(() => undefined);
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

// Threshold shared with the admin triage queue — single source of truth in
// `lib/trades/stale-open-threshold.ts` (same number, same strict comparator).
// Re-exported because the member-side tests read it from this module.
export { STALE_OPEN_TRADE_MS };

/**
 * Tour 13 — a trade the member logged but never closed silently drops out of
 * the behavioural score (exitReason / planRespected stay null) and stops
 * reflecting their real activity. This read spots the case for the member-side
 * gentle reminder on the hub: how many of THEIR trades have been open longer
 * than `STALE_OPEN_TRADE_MS`, and the id of the oldest one to deep-link to.
 *
 * "Open longer than 72 h" is measured from `enteredAt` (member-provided entry
 * timestamp) — the position's real age, which is what "a trade waiting to be
 * closed" means to the member — with the same strict `<` comparator as the
 * admin cohort queue (`lib/admin/attention-service.ts`), so both sides always
 * agree on what is stale. Read-only, ownership-scoped, bounded (one `count` +
 * one indexed `findFirst`, no list materialised). Returns `count: 0` /
 * `oldestTradeId: null` when nothing is stale, so the card renders nothing.
 */
export interface StaleOpenTradesSummary {
  count: number;
  /** Id of the oldest stale open trade, for a direct journal deep-link. */
  oldestTradeId: string | null;
}

export async function getStaleOpenTradesSummary(
  userId: string,
  now: Date = new Date(),
): Promise<StaleOpenTradesSummary> {
  const threshold = new Date(now.getTime() - STALE_OPEN_TRADE_MS);
  const where: Prisma.TradeWhereInput = {
    userId,
    closedAt: null,
    enteredAt: { lt: threshold },
  };

  const [count, oldest] = await Promise.all([
    db.trade.count({ where }),
    db.trade.findFirst({
      where,
      orderBy: { enteredAt: 'asc' },
      select: { id: true },
    }),
  ]);

  return { count, oldestTradeId: oldest?.id ?? null };
}
