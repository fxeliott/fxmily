/**
 * The seven Mark Douglas trigger evaluators (J7, SPEC §7.6).
 *
 * Pure functions only — no Date.now(), no Prisma, no env. The engine
 * (`engine.ts`) builds a `TriggerContext` snapshot once, then dispatches to
 * these evaluators. This separation makes the evaluators trivially testable
 * (vs the cooldown layer which needs a DB mock).
 *
 * Mark Douglas grounding (Trading in the Zone, ch. 6/7/10/11):
 *   - Tilt is a mental-state phenomenon, not strictly time-bound. Default
 *     window for `after_n_consecutive_losses` is 'any' (most recent N closed
 *     trades, regardless of when). Configurable to 'rolling_24h' or 'session'
 *     when an admin wants finer-grained pushes.
 *   - The four core fears (FOMO, peur de perdre, peur de se tromper, peur de
 *     laisser sur la table) are each tracked via the `emotion_logged` rule.
 *   - "Anything can happen" — the engine NEVER pushes more than one card per
 *     member per local day (anti-spam, enforced at engine level not here).
 */

import { localDateOf, shiftLocalDate, type LocalDateString } from '@/lib/checkin/timezone';

import type {
  ConsecutiveLossesWindow,
  TriggerCheckinInput,
  TriggerContext,
  TriggerEvalResult,
  TriggerRule,
  TriggerTradeInput,
} from './types';

// =============================================================================
// Public API — one entry per kind + a dispatch helper
// =============================================================================

/**
 * Dispatch on `rule.kind`. Exhaustive switch — TS will complain if a new
 * kind is added to the union without a matching case.
 */
export function evaluateTrigger(rule: TriggerRule, ctx: TriggerContext): TriggerEvalResult {
  switch (rule.kind) {
    case 'after_n_consecutive_losses':
      return evalAfterNConsecutiveLosses(rule, ctx);
    case 'plan_violations_in_window':
      return evalPlanViolationsInWindow(rule, ctx);
    case 'sleep_deficit_then_trade':
      return evalSleepDeficitThenTrade(rule, ctx);
    case 'emotion_logged':
      return evalEmotionLogged(rule, ctx);
    case 'win_streak':
      return evalWinStreak(rule, ctx);
    case 'no_checkin_streak':
      return evalNoCheckinStreak(rule, ctx);
    case 'hedge_violation':
      return evalHedgeViolation(rule, ctx);
    case 'no_training_activity_in_window':
      return evalNoTrainingActivityInWindow(rule, ctx);
  }
}

// =============================================================================
// 1. after_n_consecutive_losses — tilt management
// =============================================================================

export function evalAfterNConsecutiveLosses(
  rule: Extract<TriggerRule, { kind: 'after_n_consecutive_losses' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  const closed = filterClosedByWindow(ctx.recentClosedTrades, rule.window, ctx.now);
  // Walk from most recent backwards, count `loss`. break_even and win break the streak.
  const sorted = [...closed].sort(byClosedAtDesc);
  let count = 0;
  for (const t of sorted) {
    if (t.outcome === 'loss') count++;
    else break;
  }
  if (count >= rule.n) {
    return {
      matched: true,
      triggeredBy: triggeredByLabelLosses(count, rule.window),
      snapshot: {
        kind: rule.kind,
        rule,
        details: {
          count,
          requiredN: rule.n,
          window: rule.window,
          mostRecentClosedAt: sorted[0]?.closedAt?.toISOString() ?? null,
        },
      },
    };
  }
  return { matched: false };
}

function filterClosedByWindow(
  trades: TriggerTradeInput[],
  window: ConsecutiveLossesWindow,
  now: Date,
): TriggerTradeInput[] {
  if (window === 'any') return trades;
  if (window === 'rolling_24h') {
    const cutoff = new Date(now.getTime() - 24 * 3600 * 1000);
    return trades.filter((t) => t.closedAt !== null && t.closedAt >= cutoff);
  }
  // 'session' — match TradeSession of the most recent closed trade.
  const sorted = [...trades].sort(byClosedAtDesc);
  const head = sorted[0];
  if (!head) return [];
  return trades.filter((t) => t.session === head.session);
}

function triggeredByLabelLosses(count: number, window: ConsecutiveLossesWindow): string {
  const tail =
    window === 'rolling_24h' ? ' sur 24 h' : window === 'session' ? ' sur la même session' : '';
  return `${count} trades perdants consécutifs${tail}`;
}

// =============================================================================
// 2. plan_violations_in_window — discipline
// =============================================================================

export function evalPlanViolationsInWindow(
  rule: Extract<TriggerRule, { kind: 'plan_violations_in_window' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  // Window: today-rule.days+1 .. today (inclusive), local-day anchor.
  const startDay = shiftLocalDate(ctx.todayLocal, -(rule.days - 1));

  // Count trade-side violations (planRespected === false), entered on or after startDay.
  const tradeViolations = ctx.recentClosedTrades.filter((t) => {
    if (t.planRespected !== false) return false;
    const enteredDay = localDateOf(t.enteredAt, ctx.timezone);
    return enteredDay >= startDay && enteredDay <= ctx.todayLocal;
  });

  // Count check-in-side violations (evening: planRespectedToday === false), within window.
  const checkinViolations = ctx.recentCheckins.filter(
    (c) =>
      c.slot === 'evening' &&
      c.planRespectedToday === false &&
      c.date >= startDay &&
      c.date <= ctx.todayLocal,
  );

  const total = tradeViolations.length + checkinViolations.length;
  if (total >= rule.n) {
    return {
      matched: true,
      triggeredBy: `Plan non respecté ${total} fois sur ${rule.days} jours`,
      snapshot: {
        kind: rule.kind,
        rule,
        details: {
          total,
          requiredN: rule.n,
          windowDays: rule.days,
          tradeViolations: tradeViolations.length,
          checkinViolations: checkinViolations.length,
          windowStart: startDay,
          windowEnd: ctx.todayLocal,
        },
      },
    };
  }
  return { matched: false };
}

// =============================================================================
// 3. sleep_deficit_then_trade — fatigue
// =============================================================================

export function evalSleepDeficitThenTrade(
  rule: Extract<TriggerRule, { kind: 'sleep_deficit_then_trade' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  // Find today's morning check-in with sleep < minHours.
  const todaysMorning = ctx.recentCheckins.find(
    (c) => c.slot === 'morning' && c.date === ctx.todayLocal,
  );
  if (!todaysMorning || todaysMorning.sleepHours === null) {
    return { matched: false };
  }
  if (todaysMorning.sleepHours >= rule.minHours) {
    return { matched: false };
  }
  // Find any trade entered today (open or closed).
  const tradesToday = ctx.recentAllTrades.filter(
    (t) => localDateOf(t.enteredAt, ctx.timezone) === ctx.todayLocal,
  );
  if (tradesToday.length === 0) return { matched: false };

  return {
    matched: true,
    triggeredBy: `Sommeil ${todaysMorning.sleepHours} h et ${tradesToday.length} trade${tradesToday.length > 1 ? 's' : ''} ce jour`,
    snapshot: {
      kind: rule.kind,
      rule,
      details: {
        sleepHours: todaysMorning.sleepHours,
        minHours: rule.minHours,
        tradesToday: tradesToday.length,
        date: ctx.todayLocal,
      },
    },
  };
}

// =============================================================================
// 4. emotion_logged — Douglas-fear surfaced
// =============================================================================

export function evalEmotionLogged(
  rule: Extract<TriggerRule, { kind: 'emotion_logged' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  const cutoff = new Date(ctx.now.getTime() - 24 * 3600 * 1000);

  // Search recent trades (entered or exited within 24h) for the tag.
  const matchingTrades = ctx.recentAllTrades.filter((t) => {
    const enteredRecent = t.enteredAt >= cutoff;
    const exitedRecent = t.exitedAt !== null && t.exitedAt >= cutoff;
    if (!enteredRecent && !exitedRecent) return false;
    return t.emotionBefore.includes(rule.tag) || t.emotionAfter.includes(rule.tag);
  });

  // Search today's check-ins for the tag.
  const matchingCheckins = ctx.recentCheckins.filter(
    (c) => c.date === ctx.todayLocal && c.emotionTags.includes(rule.tag),
  );

  if (matchingTrades.length === 0 && matchingCheckins.length === 0) {
    return { matched: false };
  }

  return {
    matched: true,
    triggeredBy: `Émotion « ${labelForTag(rule.tag)} » détectée`,
    snapshot: {
      kind: rule.kind,
      rule,
      details: {
        tag: rule.tag,
        tradeMatches: matchingTrades.length,
        checkinMatches: matchingCheckins.length,
        date: ctx.todayLocal,
      },
    },
  };
}

function labelForTag(tag: string): string {
  switch (tag) {
    case 'fomo':
      return 'FOMO';
    case 'fear-loss':
      return 'Peur de perdre';
    case 'fear-wrong':
      return 'Peur de se tromper';
    case 'fear-leaving-money':
      return 'Peur de laisser sur la table';
    case 'fearful':
      return 'Craintif';
    case 'greedy':
      return 'Avidité';
    case 'doubt':
      return 'Doute';
    default:
      return tag;
  }
}

// =============================================================================
// 5. win_streak — over-confidence
// =============================================================================

export function evalWinStreak(
  rule: Extract<TriggerRule, { kind: 'win_streak' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  const sorted = [...ctx.recentClosedTrades].sort(byClosedAtDesc);
  let count = 0;
  for (const t of sorted) {
    if (t.outcome === 'win') count++;
    else break;
  }
  if (count >= rule.n) {
    return {
      matched: true,
      triggeredBy: `${count} trades gagnants consécutifs`,
      snapshot: {
        kind: rule.kind,
        rule,
        details: {
          count,
          requiredN: rule.n,
          mostRecentClosedAt: sorted[0]?.closedAt?.toISOString() ?? null,
        },
      },
    };
  }
  return { matched: false };
}

// =============================================================================
// 6. no_checkin_streak — consistency
// =============================================================================

export function evalNoCheckinStreak(
  rule: Extract<TriggerRule, { kind: 'no_checkin_streak' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  // M4 fix : skip if user account is younger than rule.days (no spam onboarding day).
  const accountAgeMs = ctx.now.getTime() - ctx.userCreatedAt.getTime();
  const accountAgeDays = Math.floor(accountAgeMs / (24 * 3600 * 1000));
  if (accountAgeDays < rule.days) {
    return { matched: false };
  }

  // Most recent check-in date (any slot). Empty list → match (the user has been
  // active long enough per the guard above, but never checked in).
  if (ctx.recentCheckins.length === 0) {
    return {
      matched: true,
      triggeredBy: `Aucun check-in depuis au moins ${rule.days} jours`,
      snapshot: {
        kind: rule.kind,
        rule,
        details: {
          lastCheckinDate: null,
          daysSince: accountAgeDays,
          requiredDays: rule.days,
          accountAgeDays,
        },
      },
    };
  }

  const sorted = [...ctx.recentCheckins].sort((a, b) => (a.date < b.date ? 1 : -1));
  const last = sorted[0];
  if (!last) return { matched: false };

  const daysSince = daysBetweenLocal(last.date, ctx.todayLocal);
  if (daysSince >= rule.days) {
    return {
      matched: true,
      triggeredBy: `Aucun check-in depuis ${daysSince} jours`,
      snapshot: {
        kind: rule.kind,
        rule,
        details: {
          lastCheckinDate: last.date,
          daysSince,
          requiredDays: rule.days,
        },
      },
    };
  }
  return { matched: false };
}

// =============================================================================
// 7. hedge_violation — last trade had hedge=false
// =============================================================================

export function evalHedgeViolation(
  rule: Extract<TriggerRule, { kind: 'hedge_violation' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  const sorted = [...ctx.recentClosedTrades].sort(byClosedAtDesc);
  const last = sorted[0];
  if (!last) return { matched: false };
  // Only `false` (explicit violation) triggers — `null` = N/A is ignored.
  if (last.hedgeRespected !== false) return { matched: false };
  return {
    matched: true,
    triggeredBy: 'Hedge non respecté sur le dernier trade',
    snapshot: {
      kind: rule.kind,
      rule,
      details: {
        closedAt: last.closedAt?.toISOString() ?? null,
        session: last.session,
      },
    },
  };
}

// =============================================================================
// 8. no_training_activity_in_window — SPEC §21 J-T4 (backtest inactivity)
//
// Carbon mirror of `evalNoCheckinStreak`: defensive not-loaded skip +
// account-age guard (no onboarding-day spam) + recency check via the
// existing pure `daysBetweenLocal` (NO date-fns). Recency-only — `engine.ts`
// injects `ctx.lastTrainingActivityLocalDate` via the count-only
// `countRecentTrainingActivity` primitive. 🚨 §21.5: the snapshot carries
// counts/dates ONLY, never a backtest P&L (`resultR`/`outcome`/`plannedRR`).
// =============================================================================

export function evalNoTrainingActivityInWindow(
  rule: Extract<TriggerRule, { kind: 'no_training_activity_in_window' }>,
  ctx: TriggerContext,
): TriggerEvalResult {
  // Engine didn't inject training data → nothing to evaluate. The field is
  // optional on TriggerContext so the other 7 evaluators + fixtures compile.
  if (ctx.lastTrainingActivityLocalDate === undefined) {
    return { matched: false };
  }

  // M4 mirror — skip while the account is younger than the window so a
  // brand-new member isn't nagged before they could discover the module.
  const accountAgeMs = ctx.now.getTime() - ctx.userCreatedAt.getTime();
  const accountAgeDays = Math.floor(accountAgeMs / (24 * 3600 * 1000));
  if (accountAgeDays < rule.days) {
    return { matched: false };
  }

  // Account old enough, but the member has never backtested → fire.
  if (ctx.lastTrainingActivityLocalDate === null) {
    return {
      matched: true,
      triggeredBy: `Aucune session d'entraînement depuis l'inscription`,
      snapshot: {
        kind: rule.kind,
        rule,
        details: {
          lastTrainingDate: null,
          daysSince: accountAgeDays,
          requiredDays: rule.days,
          accountAgeDays,
        },
      },
    };
  }

  const daysSince = daysBetweenLocal(ctx.lastTrainingActivityLocalDate, ctx.todayLocal);
  if (daysSince >= rule.days) {
    return {
      matched: true,
      triggeredBy: `${daysSince} jours sans session d'entraînement`,
      snapshot: {
        kind: rule.kind,
        rule,
        details: {
          lastTrainingDate: ctx.lastTrainingActivityLocalDate,
          daysSince,
          requiredDays: rule.days,
          accountAgeDays,
        },
      },
    };
  }
  return { matched: false };
}

// =============================================================================
// Internal helpers
// =============================================================================

/** Most-recent first. Trades with null closedAt sort to the end. */
function byClosedAtDesc(a: TriggerTradeInput, b: TriggerTradeInput): number {
  if (!a.closedAt && !b.closedAt) return 0;
  if (!a.closedAt) return 1;
  if (!b.closedAt) return -1;
  return b.closedAt.getTime() - a.closedAt.getTime();
}

/**
 * Whole-day delta between two local YYYY-MM-DD strings (b - a). Returns
 * positive integer if b is after a. Pure string math + UTC midnight Date —
 * stable across DST.
 */
export function daysBetweenLocal(a: LocalDateString, b: LocalDateString): number {
  const da = parseDateUtc(a);
  const db = parseDateUtc(b);
  return Math.round((db.getTime() - da.getTime()) / (24 * 3600 * 1000));
}

function parseDateUtc(s: LocalDateString): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** Re-export of TriggerCheckinInput shape for callers wiring tests. */
export type { TriggerCheckinInput, TriggerContext, TriggerTradeInput };
