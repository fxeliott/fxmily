import { describe, expect, it } from 'vitest';

import {
  daysBetweenLocal,
  evalAfterNConsecutiveLosses,
  evalEmotionLogged,
  evalHedgeViolation,
  evalNoCheckinStreak,
  evalPlanViolationsInWindow,
  evalSleepDeficitThenTrade,
  evalWinStreak,
  evaluateTrigger,
} from './evaluators';
import type { TriggerCheckinInput, TriggerContext, TriggerTradeInput } from './types';

// =============================================================================
// Test fixtures
// =============================================================================

function trade(over: Partial<TriggerTradeInput> = {}): TriggerTradeInput {
  return {
    closedAt: new Date('2026-05-07T10:00:00Z'),
    exitedAt: new Date('2026-05-07T10:00:00Z'),
    enteredAt: new Date('2026-05-07T08:00:00Z'),
    outcome: 'loss',
    session: 'london',
    planRespected: true,
    hedgeRespected: null,
    emotionBefore: [],
    emotionAfter: [],
    ...over,
  };
}

function checkin(over: Partial<TriggerCheckinInput> = {}): TriggerCheckinInput {
  return {
    date: '2026-05-07',
    slot: 'morning',
    moodScore: 7,
    sleepHours: 7.5,
    planRespectedToday: null,
    emotionTags: [],
    ...over,
  };
}

function ctxAt(now: Date, todayLocal = '2026-05-07'): TriggerContext {
  return {
    now,
    timezone: 'Europe/Paris',
    todayLocal,
    recentClosedTrades: [],
    recentCheckins: [],
    recentAllTrades: [],
    // M4 fix : default to 90 days old account so triggers fire as before.
    userCreatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

// =============================================================================
// 1. after_n_consecutive_losses
// =============================================================================

describe('evalAfterNConsecutiveLosses', () => {
  const now = new Date('2026-05-07T12:00:00Z');

  it('matches when N losses in a row from most recent (window=any)', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-05T10:00:00Z'), outcome: 'win' }),
      trade({ closedAt: new Date('2026-05-06T10:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-06T11:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-06T12:00:00Z'), outcome: 'loss' }),
    ];
    const r = evalAfterNConsecutiveLosses(
      { kind: 'after_n_consecutive_losses', n: 3, window: 'any' },
      ctx,
    );
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.snapshot.details.count).toBe(3);
  });

  it('does NOT match if a win sits between recent losses', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-06T10:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-06T11:00:00Z'), outcome: 'win' }), // breaks streak
      trade({ closedAt: new Date('2026-05-06T12:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-06T13:00:00Z'), outcome: 'loss' }),
    ];
    const r = evalAfterNConsecutiveLosses(
      { kind: 'after_n_consecutive_losses', n: 3, window: 'any' },
      ctx,
    );
    expect(r.matched).toBe(false);
  });

  it('break_even ALSO breaks the streak (not a loss)', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-06T10:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-06T11:00:00Z'), outcome: 'break_even' }),
      trade({ closedAt: new Date('2026-05-06T12:00:00Z'), outcome: 'loss' }),
    ];
    const r = evalAfterNConsecutiveLosses(
      { kind: 'after_n_consecutive_losses', n: 2, window: 'any' },
      ctx,
    );
    // Only 1 loss at the head → no match.
    expect(r.matched).toBe(false);
  });

  it('respects rolling_24h window', () => {
    const ctx = ctxAt(now); // now=12:00 UTC
    ctx.recentClosedTrades = [
      // 25h ago — outside window
      trade({ closedAt: new Date('2026-05-06T11:00:00Z'), outcome: 'loss' }),
      // 5h ago — inside
      trade({ closedAt: new Date('2026-05-07T07:00:00Z'), outcome: 'loss' }),
      // 1h ago
      trade({ closedAt: new Date('2026-05-07T11:00:00Z'), outcome: 'loss' }),
    ];
    const r = evalAfterNConsecutiveLosses(
      { kind: 'after_n_consecutive_losses', n: 3, window: 'rolling_24h' },
      ctx,
    );
    // Only 2 in the 24h window → no match (need 3).
    expect(r.matched).toBe(false);
  });

  it('respects session window', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-07T08:00:00Z'), outcome: 'loss', session: 'asia' }),
      trade({ closedAt: new Date('2026-05-07T09:00:00Z'), outcome: 'loss', session: 'london' }),
      trade({ closedAt: new Date('2026-05-07T10:00:00Z'), outcome: 'loss', session: 'london' }),
      trade({ closedAt: new Date('2026-05-07T11:00:00Z'), outcome: 'loss', session: 'london' }),
    ];
    const r = evalAfterNConsecutiveLosses(
      { kind: 'after_n_consecutive_losses', n: 3, window: 'session' },
      ctx,
    );
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.snapshot.details.window).toBe('session');
      expect(r.snapshot.details.count).toBe(3);
    }
  });

  it('FR triggeredBy label includes window phrase', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-07T08:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-07T09:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-07T10:00:00Z'), outcome: 'loss' }),
    ];
    const r = evalAfterNConsecutiveLosses(
      { kind: 'after_n_consecutive_losses', n: 3, window: 'rolling_24h' },
      ctx,
    );
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.triggeredBy).toContain('24 h');
  });
});

// =============================================================================
// 2. plan_violations_in_window
// =============================================================================

describe('evalPlanViolationsInWindow', () => {
  const now = new Date('2026-05-07T12:00:00Z');

  it('counts trade-side violations within window', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentClosedTrades = [
      trade({ enteredAt: new Date('2026-05-03T08:00:00Z'), planRespected: false }),
      trade({ enteredAt: new Date('2026-05-05T08:00:00Z'), planRespected: false }),
      trade({ enteredAt: new Date('2026-05-07T08:00:00Z'), planRespected: false }),
    ];
    const r = evalPlanViolationsInWindow({ kind: 'plan_violations_in_window', n: 2, days: 7 }, ctx);
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.snapshot.details.total).toBe(3);
  });

  it('counts evening-checkin planRespectedToday=false too', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [
      checkin({ date: '2026-05-05', slot: 'evening', planRespectedToday: false }),
      checkin({ date: '2026-05-06', slot: 'evening', planRespectedToday: false }),
    ];
    const r = evalPlanViolationsInWindow({ kind: 'plan_violations_in_window', n: 2, days: 7 }, ctx);
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.snapshot.details.checkinViolations).toBe(2);
  });

  it('ignores trades outside the window (older than days back)', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentClosedTrades = [
      // 10 days ago — outside 7d window
      trade({ enteredAt: new Date('2026-04-27T08:00:00Z'), planRespected: false }),
      trade({ enteredAt: new Date('2026-04-28T08:00:00Z'), planRespected: false }),
    ];
    const r = evalPlanViolationsInWindow({ kind: 'plan_violations_in_window', n: 2, days: 7 }, ctx);
    expect(r.matched).toBe(false);
  });

  it('ignores planRespected=true trades', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentClosedTrades = [
      trade({ enteredAt: new Date('2026-05-05T08:00:00Z'), planRespected: true }),
      trade({ enteredAt: new Date('2026-05-06T08:00:00Z'), planRespected: true }),
    ];
    const r = evalPlanViolationsInWindow({ kind: 'plan_violations_in_window', n: 1, days: 7 }, ctx);
    expect(r.matched).toBe(false);
  });
});

// =============================================================================
// 3. sleep_deficit_then_trade
// =============================================================================

describe('evalSleepDeficitThenTrade', () => {
  const now = new Date('2026-05-07T12:00:00Z');

  it('matches when morning checkin shows < minHours AND a trade entered today', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [checkin({ date: '2026-05-07', slot: 'morning', sleepHours: 5 })];
    ctx.recentAllTrades = [trade({ enteredAt: new Date('2026-05-07T09:00:00Z') })];
    const r = evalSleepDeficitThenTrade({ kind: 'sleep_deficit_then_trade', minHours: 6 }, ctx);
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.snapshot.details.sleepHours).toBe(5);
  });

  it('does not match when sleep >= minHours', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [checkin({ date: '2026-05-07', slot: 'morning', sleepHours: 7 })];
    ctx.recentAllTrades = [trade({ enteredAt: new Date('2026-05-07T09:00:00Z') })];
    const r = evalSleepDeficitThenTrade({ kind: 'sleep_deficit_then_trade', minHours: 6 }, ctx);
    expect(r.matched).toBe(false);
  });

  it('does not match when no trade entered today (only sleep deficit)', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [checkin({ date: '2026-05-07', slot: 'morning', sleepHours: 5 })];
    ctx.recentAllTrades = [];
    const r = evalSleepDeficitThenTrade({ kind: 'sleep_deficit_then_trade', minHours: 6 }, ctx);
    expect(r.matched).toBe(false);
  });

  it('does not match when no morning checkin today', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [checkin({ date: '2026-05-06', slot: 'morning', sleepHours: 5 })];
    ctx.recentAllTrades = [trade({ enteredAt: new Date('2026-05-07T09:00:00Z') })];
    const r = evalSleepDeficitThenTrade({ kind: 'sleep_deficit_then_trade', minHours: 6 }, ctx);
    expect(r.matched).toBe(false);
  });
});

// =============================================================================
// 4. emotion_logged
// =============================================================================

describe('evalEmotionLogged', () => {
  const now = new Date('2026-05-07T12:00:00Z');

  it('matches a tag in trade.emotionBefore within 24h', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentAllTrades = [
      trade({
        enteredAt: new Date('2026-05-07T09:00:00Z'),
        emotionBefore: ['fomo'],
      }),
    ];
    const r = evalEmotionLogged({ kind: 'emotion_logged', tag: 'fomo' }, ctx);
    expect(r.matched).toBe(true);
  });

  it('matches a tag in checkin.emotionTags today', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [checkin({ date: '2026-05-07', emotionTags: ['fearful'] })];
    const r = evalEmotionLogged({ kind: 'emotion_logged', tag: 'fearful' }, ctx);
    expect(r.matched).toBe(true);
  });

  it('does not match if tag is older than 24h on trade and not on today checkin', () => {
    const ctx = ctxAt(now, '2026-05-07');
    // Yesterday checkin — only today checkins are searched.
    ctx.recentCheckins = [checkin({ date: '2026-05-06', emotionTags: ['fomo'] })];
    // Trade fully in the past (> 24h on both enter and exit).
    ctx.recentAllTrades = [
      trade({
        enteredAt: new Date('2026-05-04T09:00:00Z'),
        exitedAt: new Date('2026-05-04T11:00:00Z'),
        closedAt: new Date('2026-05-04T11:00:00Z'),
        emotionBefore: ['fomo'],
      }),
    ];
    const r = evalEmotionLogged({ kind: 'emotion_logged', tag: 'fomo' }, ctx);
    expect(r.matched).toBe(false);
  });

  it('matches when an open trade entered <24h ago carries the tag (still exposed)', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentAllTrades = [
      trade({
        enteredAt: new Date('2026-05-07T09:00:00Z'),
        exitedAt: null,
        closedAt: null,
        emotionBefore: ['fomo'],
      }),
    ];
    const r = evalEmotionLogged({ kind: 'emotion_logged', tag: 'fomo' }, ctx);
    expect(r.matched).toBe(true);
  });
});

// =============================================================================
// 5. win_streak
// =============================================================================

describe('evalWinStreak', () => {
  const now = new Date('2026-05-07T12:00:00Z');

  it('matches N wins in a row from most recent', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-04T10:00:00Z'), outcome: 'loss' }),
      trade({ closedAt: new Date('2026-05-05T10:00:00Z'), outcome: 'win' }),
      trade({ closedAt: new Date('2026-05-06T10:00:00Z'), outcome: 'win' }),
      trade({ closedAt: new Date('2026-05-07T10:00:00Z'), outcome: 'win' }),
      trade({ closedAt: new Date('2026-05-07T11:00:00Z'), outcome: 'win' }),
      trade({ closedAt: new Date('2026-05-07T12:00:00Z'), outcome: 'win' }),
    ];
    const r = evalWinStreak({ kind: 'win_streak', n: 5 }, ctx);
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.snapshot.details.count).toBe(5);
  });

  it('does not match when latest is a loss', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-07T10:00:00Z'), outcome: 'win' }),
      trade({ closedAt: new Date('2026-05-07T11:00:00Z'), outcome: 'win' }),
      trade({ closedAt: new Date('2026-05-07T12:00:00Z'), outcome: 'loss' }),
    ];
    const r = evalWinStreak({ kind: 'win_streak', n: 2 }, ctx);
    expect(r.matched).toBe(false);
  });
});

// =============================================================================
// 6. no_checkin_streak
// =============================================================================

describe('evalNoCheckinStreak', () => {
  const now = new Date('2026-05-07T12:00:00Z');

  it('matches when last checkin was N+ days ago', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [checkin({ date: '2026-04-29' }), checkin({ date: '2026-04-30' })];
    const r = evalNoCheckinStreak({ kind: 'no_checkin_streak', days: 7 }, ctx);
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.snapshot.details.lastCheckinDate).toBe('2026-04-30');
      expect(r.snapshot.details.daysSince).toBe(7);
    }
  });

  it('does not match when last checkin is recent', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [checkin({ date: '2026-05-05' })];
    const r = evalNoCheckinStreak({ kind: 'no_checkin_streak', days: 7 }, ctx);
    expect(r.matched).toBe(false);
  });

  it('matches when no checkin at all in the window (orphan member)', () => {
    const ctx = ctxAt(now, '2026-05-07');
    ctx.recentCheckins = [];
    const r = evalNoCheckinStreak({ kind: 'no_checkin_streak', days: 7 }, ctx);
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.snapshot.details.lastCheckinDate).toBe(null);
  });
});

// =============================================================================
// 7. hedge_violation
// =============================================================================

describe('evalHedgeViolation', () => {
  const now = new Date('2026-05-07T12:00:00Z');

  it('matches when most recent trade has hedgeRespected=false', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [
      trade({ closedAt: new Date('2026-05-06T10:00:00Z'), hedgeRespected: true }),
      trade({ closedAt: new Date('2026-05-07T10:00:00Z'), hedgeRespected: false }),
    ];
    const r = evalHedgeViolation({ kind: 'hedge_violation' }, ctx);
    expect(r.matched).toBe(true);
  });

  it('does not match when most recent has hedgeRespected=null (N/A)', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [trade({ hedgeRespected: null })];
    const r = evalHedgeViolation({ kind: 'hedge_violation' }, ctx);
    expect(r.matched).toBe(false);
  });

  it('does not match when most recent has hedgeRespected=true', () => {
    const ctx = ctxAt(now);
    ctx.recentClosedTrades = [trade({ hedgeRespected: true })];
    const r = evalHedgeViolation({ kind: 'hedge_violation' }, ctx);
    expect(r.matched).toBe(false);
  });

  it('does not match when no closed trades at all', () => {
    const ctx = ctxAt(now);
    const r = evalHedgeViolation({ kind: 'hedge_violation' }, ctx);
    expect(r.matched).toBe(false);
  });
});

// =============================================================================
// dispatch + helpers
// =============================================================================

describe('evaluateTrigger dispatcher', () => {
  it('dispatches to the right evaluator by kind', () => {
    const ctx = ctxAt(new Date('2026-05-07T12:00:00Z'));
    ctx.recentClosedTrades = [trade({ outcome: 'loss' }), trade({ outcome: 'loss' })];
    const r = evaluateTrigger({ kind: 'after_n_consecutive_losses', n: 2, window: 'any' }, ctx);
    expect(r.matched).toBe(true);
  });
});

describe('daysBetweenLocal', () => {
  it('returns 0 for the same day', () => {
    expect(daysBetweenLocal('2026-05-07', '2026-05-07')).toBe(0);
  });
  it('returns 1 for consecutive days', () => {
    expect(daysBetweenLocal('2026-05-06', '2026-05-07')).toBe(1);
  });
  it('returns 7 for a week', () => {
    expect(daysBetweenLocal('2026-04-30', '2026-05-07')).toBe(7);
  });
  it('handles month boundary', () => {
    expect(daysBetweenLocal('2026-04-30', '2026-05-01')).toBe(1);
  });
  it('returns negative if b is before a', () => {
    expect(daysBetweenLocal('2026-05-07', '2026-05-01')).toBe(-6);
  });
});
