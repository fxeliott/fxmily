import 'server-only';

import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { logAudit } from '@/lib/auth/audit';

import { isOnCooldown, pickBestMatch, type DeliveryHistoryEntry } from './cooldown';
import { evaluateTrigger } from './evaluators';
import { parseTriggerRule } from './schema';
import { isHatClass, type HatClass, type TriggerContext, type TriggerEvalResult } from './types';

/**
 * Mark Douglas dispatch engine (J7).
 *
 * Public surface:
 *   - `evaluateAndDispatchForUser(userId, options?)` — full pipeline used by
 *     Server Actions (`scheduleDouglasDispatch` from `lib/cards/scheduler.ts`)
 *     and the cron `/api/cron/dispatch-douglas`.
 *
 * Pipeline:
 *   1. Fetch context: user + last 30d trades + last 60d check-ins +
 *      published cards with `triggerRules` + last 14d delivery history.
 *   2. Evaluate every published card's rule against the context.
 *   3. Filter matched cards, drop those on cooldown.
 *   4. Pick the highest priority eligible card.
 *   5. Persist a `MarkDouglasDelivery` row (idempotent on
 *      `(userId, cardId, triggeredOn)`).
 *   6. Emit a `douglas.dispatched` audit row.
 *
 * Returns the persisted delivery shape (or `null` if no card was dispatched).
 *
 * **Idempotency**: the unique index on `(userId, cardId, triggeredOn)`
 * enforces "max 1 delivery of card X to user U per local day". A second call
 * within the same day with the same matched card is a no-op (P2002 caught,
 * resolved to `null`).
 */

export interface EvaluateOptions {
  /** Inject `now` for tests. */
  now?: Date;
}

export interface DispatchResult {
  delivered: {
    deliveryId: string;
    cardId: string;
    cardSlug: string;
    triggeredBy: string;
  } | null;
  /** Diagnostic counters for cron audit. */
  matched: number;
  evaluated: number;
  skippedCooldown: number;
}

const TRADES_WINDOW_DAYS = 30;
const CHECKINS_WINDOW_DAYS = 60;
const HISTORY_WINDOW_DAYS = 14; // covers the longest cooldown (black-hat)

export async function evaluateAndDispatchForUser(
  userId: string,
  options: EvaluateOptions = {},
): Promise<DispatchResult> {
  const now = options.now ?? new Date();

  // --- 1. Fetch user (need timezone) -----------------------------------------
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, timezone: true, status: true, createdAt: true },
  });
  if (!user || user.status !== 'active') {
    return emptyResult();
  }
  const timezone = user.timezone || 'Europe/Paris';
  const todayLocal = localDateOf(now, timezone);

  // --- 2. Fetch trades + checkins + cards + history (parallel) ---------------
  const tradesWindowStart = parseLocalDate(shiftLocalDate(todayLocal, -(TRADES_WINDOW_DAYS - 1)));
  const checkinsWindowStart = parseLocalDate(
    shiftLocalDate(todayLocal, -(CHECKINS_WINDOW_DAYS - 1)),
  );
  const historyCutoff = new Date(now.getTime() - HISTORY_WINDOW_DAYS * 24 * 3600 * 1000);

  const [trades, checkins, cards, deliveries] = await Promise.all([
    db.trade.findMany({
      where: {
        userId,
        OR: [
          { closedAt: { gte: tradesWindowStart } },
          { closedAt: null, enteredAt: { gte: tradesWindowStart } },
        ],
      },
      select: {
        closedAt: true,
        exitedAt: true,
        enteredAt: true,
        outcome: true,
        session: true,
        planRespected: true,
        hedgeRespected: true,
        emotionBefore: true,
        emotionAfter: true,
      },
    }),
    db.dailyCheckin.findMany({
      where: { userId, date: { gte: checkinsWindowStart } },
      select: {
        date: true,
        slot: true,
        moodScore: true,
        sleepHours: true,
        planRespectedToday: true,
        emotionTags: true,
      },
    }),
    db.markDouglasCard.findMany({
      where: { published: true, triggerRules: { not: Prisma.JsonNull } },
      select: { id: true, slug: true, priority: true, hatClass: true, triggerRules: true },
    }),
    db.markDouglasDelivery.findMany({
      where: { userId, createdAt: { gte: historyCutoff } },
      select: { cardId: true, createdAt: true },
    }),
  ]);

  // --- 3. Build TriggerContext -----------------------------------------------
  const closedTrades = trades.filter((t) => t.closedAt !== null);

  const ctx: TriggerContext = {
    now,
    timezone,
    todayLocal,
    recentClosedTrades: closedTrades.map((t) => ({
      closedAt: t.closedAt,
      exitedAt: t.exitedAt,
      enteredAt: t.enteredAt,
      outcome: t.outcome,
      session: t.session,
      planRespected: t.planRespected,
      hedgeRespected: t.hedgeRespected,
      emotionBefore: t.emotionBefore,
      emotionAfter: t.emotionAfter,
    })),
    recentAllTrades: trades.map((t) => ({
      closedAt: t.closedAt,
      exitedAt: t.exitedAt,
      enteredAt: t.enteredAt,
      outcome: t.outcome,
      session: t.session,
      planRespected: t.planRespected,
      hedgeRespected: t.hedgeRespected,
      emotionBefore: t.emotionBefore,
      emotionAfter: t.emotionAfter,
    })),
    userCreatedAt: user.createdAt,
    recentCheckins: checkins.map((c) => ({
      date: c.date.toISOString().slice(0, 10),
      slot: c.slot,
      moodScore: c.moodScore,
      sleepHours: c.sleepHours == null ? null : Number(c.sleepHours.toString()),
      planRespectedToday: c.planRespectedToday,
      emotionTags: c.emotionTags,
    })),
  };

  // --- 4. Evaluate each card's rule ------------------------------------------
  type Match = {
    cardId: string;
    cardSlug: string;
    priority: number;
    hatClass: HatClass;
    result: Extract<TriggerEvalResult, { matched: true }>;
  };
  const matches: Match[] = [];
  let evaluated = 0;
  for (const card of cards) {
    const rule = parseTriggerRule(card.triggerRules);
    if (!rule) {
      console.warn('[douglas.engine] invalid triggerRules', { cardId: card.id });
      continue;
    }
    evaluated++;
    const result = evaluateTrigger(rule, ctx);
    if (result.matched) {
      const hat: HatClass = isHatClass(card.hatClass) ? card.hatClass : 'white';
      matches.push({
        cardId: card.id,
        cardSlug: card.slug,
        priority: card.priority,
        hatClass: hat,
        result,
      });
    }
  }

  if (matches.length === 0) {
    return { delivered: null, matched: 0, evaluated, skippedCooldown: 0 };
  }

  // --- 5. Cooldown filter + pick best ---------------------------------------
  const history: DeliveryHistoryEntry[] = deliveries.map((d) => ({
    cardId: d.cardId,
    createdAtMs: d.createdAt.getTime(),
  }));

  const eligible = matches.filter((m) => !isOnCooldown(m.cardId, m.hatClass, history, now));
  const skippedCooldown = matches.length - eligible.length;

  const picked = pickBestMatch({
    matched: eligible.map((m) => ({ id: m.cardId, priority: m.priority, hatClass: m.hatClass })),
    history,
    now,
  });
  if (!picked) {
    return { delivered: null, matched: matches.length, evaluated, skippedCooldown };
  }
  const winner = matches.find((m) => m.cardId === picked.cardId)!;

  // --- 6. Persist delivery (idempotent) -------------------------------------
  const triggeredOn = parseLocalDate(todayLocal);
  try {
    const row = await db.markDouglasDelivery.create({
      data: {
        userId,
        cardId: winner.cardId,
        triggeredBy: winner.result.triggeredBy,
        triggerSnapshot: winner.result.snapshot as unknown as object,
        triggeredOn,
      },
      select: { id: true },
    });
    await logAudit({
      action: 'douglas.dispatched',
      userId,
      metadata: {
        deliveryId: row.id,
        cardId: winner.cardId,
        cardSlug: winner.cardSlug,
        triggerKind: winner.result.snapshot.kind,
        priority: winner.priority,
        hatClass: winner.hatClass,
      },
    });
    return {
      delivered: {
        deliveryId: row.id,
        cardId: winner.cardId,
        cardSlug: winner.cardSlug,
        triggeredBy: winner.result.triggeredBy,
      },
      matched: matches.length,
      evaluated,
      skippedCooldown,
    };
  } catch (err) {
    // P2002 on (userId, cardId, triggeredOn) → already delivered today, no-op.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return { delivered: null, matched: matches.length, evaluated, skippedCooldown };
    }
    console.error('[douglas.engine] persist failed', err);
    return { delivered: null, matched: matches.length, evaluated, skippedCooldown };
  }
}

function emptyResult(): DispatchResult {
  return { delivered: null, matched: 0, evaluated: 0, skippedCooldown: 0 };
}

// =============================================================================
// Bulk variant (for the cron — temporal triggers like no_checkin_streak)
// =============================================================================

export interface BulkDispatchResult {
  scanned: number;
  delivered: number;
  matched: number;
  errors: number;
  ranAt: string;
}

/**
 * Run the dispatch pipeline for every active member. Used by the temporal
 * cron `/api/cron/dispatch-douglas` (every 6h). Bounded concurrency keeps
 * the Postgres pool happy.
 */
export async function dispatchForAllActiveMembers(now?: Date): Promise<BulkDispatchResult> {
  const ranAt = (now ?? new Date()).toISOString();
  const batchSize = 25;

  const users = await db.user.findMany({
    where: { status: 'active' },
    select: { id: true },
  });

  let delivered = 0;
  let matched = 0;
  let errors = 0;

  for (let i = 0; i < users.length; i += batchSize) {
    const slice = users.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      slice.map((u) => evaluateAndDispatchForUser(u.id, now ? { now } : {})),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.delivered) delivered++;
        matched += r.value.matched;
      } else {
        errors++;
        console.error('[douglas.engine] user dispatch failed:', r.reason);
      }
    }
  }

  return { scanned: users.length, delivered, matched, errors, ranAt };
}
