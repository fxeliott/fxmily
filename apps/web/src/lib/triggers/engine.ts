import 'server-only';

import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { logAudit } from '@/lib/auth/audit';
import { enqueueDouglasDeliveryNotification } from '@/lib/notifications/enqueue';
// 🚨 §21.5 — the ONLY symbol the trigger engine may import from the training
// module: the count-only primitive. Anything else (a serialized backtest,
// `db.trainingTrade`, a P&L field) is a statistical-isolation breach.
import { countRecentTrainingActivity } from '@/lib/training/training-trade-service';
// T1 "cerveau actif" — score history feeds the pure `score_drift` evaluator
// (via `detectMomentum`). User-scoped trend points (date + 4 dims), no P&L.
import { getBehavioralScoreHistory } from '@/lib/scoring/service';
// A-Z hardening (audit ERR-1/ERR-2) — this engine was the ONLY dispatch
// pipeline that never reported to Sentry; a real DB failure on delivery
// persistence was console-only and invisible to on-call. Mirrors the twin in
// `lib/scoring/service.ts`.
import { reportWarning } from '@/lib/observability';
// Tour 12 (action 3) — the member's dominant mental axis (from their onboarding
// profile) weights the same-priority tie-break in `pickBestMatch`. Read-only,
// deterministic; `null` for un-profiled members → historical pick order.
import { getDominantMentalAxis } from '@/lib/coaching/service';
import type { DouglasCategory } from '@/generated/prisma/enums';

import {
  isOnCooldown,
  isRoutineSaturated,
  pickBestMatch,
  type DeliveryHistoryEntry,
  type RoutineEngagementEntry,
} from './cooldown';
import { evaluateTrigger } from './evaluators';
import { parseTriggerRule } from './schema';
import {
  isHatClass,
  type HatClass,
  type TriggerContext,
  type TriggerEvalResult,
  type TriggerRule,
} from './types';

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
  /**
   * S10 perf — the bulk cron passes the published trigger cards pre-fetched +
   * pre-parsed ONCE (they are member-INDEPENDENT: the query has no `userId`), so
   * the per-member path skips the redundant `markDouglasCard.findMany` + per-card
   * `parseTriggerRule`. Absent on the single-user realtime path (the Server-Action
   * scheduler), which self-fetches so its behaviour is byte-identical.
   */
  preparsedCards?: readonly PreparsedCard[];
}

/** A published trigger card with its rule already validated (rule never null). */
export type PreparsedCard = {
  readonly id: string;
  readonly slug: string;
  readonly priority: number;
  readonly hatClass: string;
  /** Tour 12 (action 3) — fed to the picker's profile-aware tie-break. */
  readonly category: DouglasCategory;
  readonly rule: TriggerRule;
};

const PUBLISHED_TRIGGER_CARD_SELECT = {
  id: true,
  slug: true,
  priority: true,
  hatClass: true,
  category: true,
  triggerRules: true,
} as const;

/**
 * Fetch + parse the published trigger cards ONCE. Cards are member-independent,
 * so the bulk dispatch (`dispatchForAllActiveMembers`) loads them a single time
 * instead of re-querying + re-parsing per member — mirrors the scoring cron's
 * member-independent-data-through-options pattern (`scoring/service.ts`). Invalid
 * rules are skipped + warned once per card per run (not per member).
 */
async function loadPublishedTriggerCards(): Promise<PreparsedCard[]> {
  const rows = await db.markDouglasCard.findMany({
    where: { published: true, triggerRules: { not: Prisma.JsonNull } },
    select: PUBLISHED_TRIGGER_CARD_SELECT,
  });
  const cards: PreparsedCard[] = [];
  for (const row of rows) {
    const rule = parseTriggerRule(row.triggerRules);
    if (!rule) {
      // RC#7 SF-2 — a published card whose triggerRules no longer parse (schema
      // drift orphaning a legacy row, or an out-of-band DB write) is silently
      // dropped from dispatch for EVERY member. Route it to Sentry (bare
      // console.warn is not captured server-side) so an operator sees it,
      // matching the persist_failed / bulk_dispatch_failed reporting below.
      reportWarning('douglas.engine', 'invalid_trigger_rules', { cardId: row.id });
      continue;
    }
    cards.push({
      id: row.id,
      slug: row.slug,
      priority: row.priority,
      hatClass: row.hatClass,
      category: row.category,
      rule,
    });
  }
  return cards;
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
    // Tour 15 — `weekendsOff` feeds the off-aware `no_checkin_streak` (an off day
    // is not a missed ritual). Read here (already fetching the user) so the
    // per-member path adds no extra round-trip for the flag itself.
    select: { id: true, timezone: true, status: true, createdAt: true, weekendsOff: true },
  });
  if (!user || user.status !== 'active') {
    return emptyResult();
  }
  const timezone = user.timezone || 'Europe/Paris';
  const todayLocal = localDateOf(now, timezone);

  // --- 1.5 Member-day cap (S4 DOD2-T2-1) -------------------------------------
  // The documented invariant is « ≤ 1 fiche Douglas par membre par JOUR »
  // (anti-spam, posture calme) — but the unique index `(userId, cardId,
  // triggeredOn)` only enforces it PER CARD: with 4 cron ticks/day + the
  // realtime scheduler, tick 2 could deliver a DIFFERENT matched card the
  // same local day. Checked BEFORE the heavy context fetch — a member
  // already served today skips the 5 parallel queries entirely (the common
  // case on 3 of the 4 daily ticks). Best-effort against concurrent racers
  // (no DB-level member-day unique without a migration); the 5s scheduler
  // debounce makes the residual window negligible vs the previous fully
  // uncapped behavior.
  const triggeredOn = parseLocalDate(todayLocal);
  const alreadyServedToday = await db.markDouglasDelivery.findFirst({
    where: { userId, triggeredOn },
    select: { id: true },
  });
  if (alreadyServedToday) {
    return emptyResult();
  }

  // --- 2. Fetch trades + checkins + cards + history (parallel) ---------------
  const tradesWindowStart = parseLocalDate(shiftLocalDate(todayLocal, -(TRADES_WINDOW_DAYS - 1)));
  const checkinsWindowStart = parseLocalDate(
    shiftLocalDate(todayLocal, -(CHECKINS_WINDOW_DAYS - 1)),
  );
  const historyCutoff = new Date(now.getTime() - HISTORY_WINDOW_DAYS * 24 * 3600 * 1000);

  // S10 perf — reuse the bulk cron's pre-parsed, member-independent cards when
  // provided; otherwise self-fetch so the single-user realtime path is identical.
  const cardsPromise: Promise<readonly PreparsedCard[]> = options.preparsedCards
    ? Promise.resolve(options.preparsedCards)
    : loadPublishedTriggerCards();

  const [
    trades,
    checkins,
    activeCards,
    deliveries,
    trainingActivity,
    scoreHistory,
    dominantAxis,
    offDayRows,
  ] = await Promise.all([
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
        emotionDuring: true,
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
    cardsPromise,
    db.markDouglasDelivery.findMany({
      where: { userId, createdAt: { gte: historyCutoff } },
      // TASK C (§26) — `seenAt` + `sourceAlertId` added (additive) so the
      // routine-saturation check can read engagement. `sourceAlertId` separates
      // ROUTINE deliveries (null = classic evaluators) from ALERTE ones (S3
      // constancy engine) — the latter are NEVER spaced. `cardId` + `createdAt`
      // remain for the unchanged hatClass-cooldown path.
      select: { cardId: true, createdAt: true, seenAt: true, sourceAlertId: true },
    }),
    // 🚨 §21.5 — sanctioned training→real-edge touchpoint #2 (trigger
    // engine). Count-only primitive; the inactivity trigger is recency-only
    // so only `.lastEnteredAt` is consumed. NEVER a backtest P&L. Reuses the
    // 30d trade window start as the (unused-for-recency) count bound.
    countRecentTrainingActivity(userId, tradesWindowStart),
    // T1 — behavioral-score trend (ascending, 90d default) for `score_drift`.
    // detectMomentum needs ≥6 points over a 42d window; 90d covers it with slack.
    getBehavioralScoreHistory(userId),
    // Tour 12 (action 3) — member's dominant mental axis (profile S2), read in
    // parallel so it adds no wall-clock. `null` for un-profiled members → the
    // picker keeps its historical `priority DESC, id ASC` order (no regression).
    getDominantMentalAxis(userId),
    // Tour 15 — explicit off days over the same check-in lookback window, so the
    // off-aware `no_checkin_streak` skips them. One indexed range query, run in
    // parallel (no added wall-clock). Weekends are covered by the `weekendsOff`
    // flag already on `user`, not this table.
    db.memberOffDay.findMany({
      where: { userId, date: { gte: checkinsWindowStart } },
      select: { date: true },
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
      emotionDuring: t.emotionDuring,
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
      emotionDuring: t.emotionDuring,
      emotionAfter: t.emotionAfter,
    })),
    userCreatedAt: user.createdAt,
    // 🚨 §21.5 — recency DATE only, derived from the count-only primitive's
    // all-time `lastEnteredAt`. The inactivity evaluator reads this; no
    // backtest P&L ever enters the TriggerContext.
    lastTrainingActivityLocalDate: trainingActivity.lastEnteredAt
      ? localDateOf(new Date(trainingActivity.lastEnteredAt), timezone)
      : null,
    // T1 "cerveau actif" — trend points (date + 4 dims) consumed by the pure
    // `score_drift` evaluator via `detectMomentum`. Structurally a
    // MomentumHistoryPoint[]; passed straight through (no P&L, user-scoped).
    scoreHistory,
    recentCheckins: checkins.map((c) => ({
      date: c.date.toISOString().slice(0, 10),
      slot: c.slot,
      moodScore: c.moodScore,
      sleepHours: c.sleepHours == null ? null : Number(c.sleepHours.toString()),
      planRespectedToday: c.planRespectedToday,
      emotionTags: c.emotionTags,
    })),
    // Tour 15 — off-day inputs for the off-aware `no_checkin_streak`. Weekend
    // preference from the user row + the explicit declared dates in the window.
    offContext: {
      weekendsOff: user.weekendsOff,
      explicitDates: new Set(offDayRows.map((r) => r.date.toISOString().slice(0, 10))),
    },
  };

  // --- 4. Evaluate each card's rule ------------------------------------------
  type Match = {
    cardId: string;
    cardSlug: string;
    priority: number;
    hatClass: HatClass;
    /** Tour 12 (action 3) — carried through to the picker's profile tie-break. */
    category: DouglasCategory;
    result: Extract<TriggerEvalResult, { matched: true }>;
  };
  const matches: Match[] = [];
  let evaluated = 0;
  for (const card of activeCards) {
    evaluated++;
    const result = evaluateTrigger(card.rule, ctx);
    if (result.matched) {
      const hat: HatClass = isHatClass(card.hatClass) ? card.hatClass : 'white';
      matches.push({
        cardId: card.id,
        cardSlug: card.slug,
        priority: card.priority,
        hatClass: hat,
        category: card.category,
        result,
      });
    }
  }

  if (matches.length === 0) {
    return { delivered: null, matched: 0, evaluated, skippedCooldown: 0 };
  }

  // --- 4.5 Routine-cadence adaptive spacing (TASK C, §26) -------------------
  // CONSERVATIVE engagement gate. Every card this engine dispatches is a
  // ROUTINE fiche (`sourceAlertId === null`); ALERTE fiches come from the S3
  // constancy engine (`lib/verification/alerts.ts`) and are never routed here,
  // so they are never spaced. If the K most-recent ROUTINE deliveries were ALL
  // left unseen, the member is saturated → skip today's routine fiche (one
  // less nudge, never one more). OFF-equivalent when routine history < K, so
  // new + lightly-served members keep the exact pre-TASK-C behaviour. Reversible:
  // delete this block to restore byte-identical old cadence. NEVER touches the
  // ≤1-fiche/day cap, the hatClass cooldown, or any ALERTE delivery.
  const routineEngagement: RoutineEngagementEntry[] = deliveries.map((d) => ({
    createdAtMs: d.createdAt.getTime(),
    seenAtMs: d.seenAt ? d.seenAt.getTime() : null,
    isRoutine: d.sourceAlertId === null,
  }));
  if (isRoutineSaturated(routineEngagement)) {
    return { delivered: null, matched: matches.length, evaluated, skippedCooldown: 0 };
  }

  // --- 5. Cooldown filter + pick best ---------------------------------------
  const history: DeliveryHistoryEntry[] = deliveries.map((d) => ({
    cardId: d.cardId,
    createdAtMs: d.createdAt.getTime(),
  }));

  const eligible = matches.filter((m) => !isOnCooldown(m.cardId, m.hatClass, history, now));
  const skippedCooldown = matches.length - eligible.length;

  const picked = pickBestMatch({
    matched: eligible.map((m) => ({
      id: m.cardId,
      priority: m.priority,
      hatClass: m.hatClass,
      category: m.category,
    })),
    history,
    now,
    // Tour 12 (action 3) — profile-aware tie-break AFTER priority + cooldown.
    dominantAxis,
  });
  if (!picked) {
    return { delivered: null, matched: matches.length, evaluated, skippedCooldown };
  }
  const winner = matches.find((m) => m.cardId === picked.cardId)!;

  // --- 6. Persist delivery (idempotent) -------------------------------------
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
    // Session 3 §28 — emit the "alerté immédiatement en cas de dérive" push.
    // Best-effort (the helper never throws — returns null on failure), so a
    // queue hiccup never undoes the delivery. The web-push dispatcher's
    // reception path (TTL/urgency/preference/copy) was already wired (J9); only
    // this emission was missing → a drift was previously PULL-only (dashboard).
    await enqueueDouglasDeliveryNotification(userId, {
      deliveryId: row.id,
      cardSlug: winner.cardSlug,
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
    // A real DB failure here (pool exhausted, FK, timeout, deadlock) loses a
    // member's coaching delivery. Surface it to Sentry — best-effort, never
    // alters the return flow. (Audit ERR-1, twin of scoring/service.ts.)
    reportWarning('douglas.engine', 'persist_failed', {
      userId,
      cardId: winner.cardId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
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

  // S10 perf — the published trigger cards are member-independent, so load +
  // parse them ONCE here instead of once per member inside the loop (was an
  // O(members) redundant findMany + Zod parse on every 00:00 UTC tick).
  const [users, preparsedCards] = await Promise.all([
    db.user.findMany({ where: { status: 'active' }, select: { id: true } }),
    loadPublishedTriggerCards(),
  ]);

  let delivered = 0;
  let matched = 0;
  let errors = 0;

  for (let i = 0; i < users.length; i += batchSize) {
    const slice = users.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      slice.map((u) =>
        evaluateAndDispatchForUser(u.id, { ...(now ? { now } : {}), preparsedCards }),
      ),
    );
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        if (r.value.delivered) delivered++;
        matched += r.value.matched;
      } else {
        errors++;
        // Audit ERR-2/CRON-4 — a per-member dispatch crash was console-only,
        // so the cron's `errors` counter ticked but on-call never saw the
        // cause (twin: weekly-report/service.ts). Surface to Sentry.
        reportWarning('douglas.engine', 'bulk_dispatch_failed', {
          userId: slice[idx]?.id,
          error: r.reason instanceof Error ? r.reason.message.slice(0, 200) : 'unknown',
        });
      }
    });
  }

  return { scanned: users.length, delivered, matched, errors, ranAt };
}
