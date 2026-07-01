/**
 * Vitest TDD for the J8 weekly-report builder (Phase A foundation).
 *
 * The builder is pure — fixture-in, snapshot-out. Tests cover :
 *   - Empty input (zero trades, zero check-ins) — sane defaults, all medians null.
 *   - Counters (wins/losses/BE, realizedR sum/mean, plan/hedge rates).
 *   - Sleep/mood/stress medians (odd + even sample sizes).
 *   - Streak from check-ins.
 *   - Mark Douglas delivery counters (delivered / seen / helpful).
 *   - Free-text aggregation (emotion tags frequency-sorted, pairs, sessions).
 *   - Journal excerpt sanitization + truncation + bidi/zero-width strip.
 *   - Score pass-through (null → all-null).
 */

import { describe, expect, it } from 'vitest';

import type { SerializedDelivery } from '@/lib/cards/types';
import type { SerializedCheckin } from '@/lib/checkin/service';
import { weeklySnapshotSchema } from '@/lib/schemas/weekly-report';
import type { SerializedTrade } from '@/lib/trades/service';

import { buildWeeklySnapshot, pseudonymizeMember } from './builder';
import type { BuilderInput } from './types';

const WEEK_START = new Date('2026-05-04T00:00:00Z'); // Monday
const WEEK_END = new Date('2026-05-10T23:59:59Z'); // Sunday

function emptyInput(): BuilderInput {
  return {
    userId: 'user_test_1',
    timezone: 'Europe/Paris',
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
    trades: [],
    checkins: [],
    deliveries: [],
    annotationsReceived: 0,
    annotationsViewed: 0,
    latestScore: null,
    // DOD3-01 / DoD#2 S6 — Session-3 counters default to the empty (no-signal)
    // shape; tests that exercise S3 override it.
    verification: { constancy: null, openDiscrepancyCount: 0, alertCount: 0 },
  };
}

// D3-01 — the builder reads `trade.tags` (post-outcome bias tags), which the
// shared `SerializedTrade` view does not surface; the loader serializes it
// inline so `BuilderInput['trades']` is `SerializedTrade & { tags: string[] }`.
type TradeFixture = SerializedTrade & { tags: string[] };

function makeTrade(partial: Partial<TradeFixture> = {}): TradeFixture {
  return {
    id: partial.id ?? 'trade_1',
    userId: 'user_test_1',
    pair: 'EURUSD',
    direction: 'long',
    session: 'london',
    enteredAt: '2026-05-05T08:00:00.000Z',
    entryPrice: '1.1000',
    lotSize: '0.10',
    stopLossPrice: '1.0950',
    plannedRR: '2',
    // V1.5 — defaults to null (V1 trades created before V1.5 ship are NULL).
    tradeQuality: null,
    riskPct: null,
    emotionBefore: ['calm'],
    planRespected: true,
    hedgeRespected: null,
    processComplete: null,
    slPerRule: null,
    movedToBe: null,
    partialAtTarget: null,
    notes: null,
    screenshotEntryKey: null,
    tradingViewEntryUrl: 'https://www.tradingview.com/x/entry123/',
    exitedAt: null,
    exitPrice: null,
    outcome: null,
    realizedR: null,
    realizedRSource: null,
    emotionDuring: [],
    emotionAfter: [],
    screenshotExitKey: null,
    tradingViewExitUrl: null,
    closedAt: null,
    createdAt: '2026-05-05T08:00:00.000Z',
    updatedAt: '2026-05-05T08:00:00.000Z',
    isClosed: false,
    // D3-01 — post-outcome bias tags, default empty (V1 trades had none).
    tags: [],
    ...partial,
  };
}

function closedTrade(
  outcome: 'win' | 'loss' | 'break_even',
  realizedR: number,
  partial: Partial<TradeFixture> = {},
): TradeFixture {
  return makeTrade({
    outcome,
    realizedR: realizedR.toString(),
    realizedRSource: 'computed',
    closedAt: '2026-05-05T10:00:00.000Z',
    exitedAt: '2026-05-05T10:00:00.000Z',
    exitPrice: '1.1100',
    isClosed: true,
    emotionAfter: [outcome === 'win' ? 'satisfied' : 'frustrated'],
    ...partial,
  });
}

function makeCheckin(
  slot: 'morning' | 'evening',
  partial: Partial<SerializedCheckin> = {},
): SerializedCheckin {
  const base: SerializedCheckin = {
    id: partial.id ?? `c_${slot}_${Math.random()}`,
    userId: 'user_test_1',
    date: '2026-05-05',
    slot,
    sleepHours: null,
    sleepQuality: null,
    morningRoutineCompleted: null,
    marketAnalysisDone: null,
    meditationMin: null,
    sportType: null,
    sportDurationMin: null,
    intention: null,
    planRespectedToday: null,
    hedgeRespectedToday: null,
    intentionKept: null,
    formationFollowed: null,
    caffeineMl: null,
    waterLiters: null,
    stressScore: null,
    gratitudeItems: [],
    moodScore: null,
    emotionTags: [],
    journalNote: null,
    submittedAt: '2026-05-05T08:00:00.000Z',
    createdAt: '2026-05-05T08:00:00.000Z',
    updatedAt: '2026-05-05T08:00:00.000Z',
  };
  return { ...base, ...partial };
}

function makeDelivery(partial: Partial<SerializedDelivery> = {}): SerializedDelivery {
  return {
    id: partial.id ?? 'd_1',
    userId: 'user_test_1',
    cardId: 'card_1',
    cardSlug: 'sortir-du-tilt',
    cardTitle: 'Sortir du tilt après une série de pertes',
    cardCategory: 'tilt',
    triggeredBy: '3 trades perdants consécutifs',
    triggeredOn: '2026-05-05',
    seenAt: null,
    dismissedAt: null,
    helpful: null,
    createdAt: '2026-05-05T10:00:00.000Z',
    ...partial,
  };
}

// =============================================================================

describe('buildWeeklySnapshot — empty input', () => {
  it('returns sane defaults with no trades / check-ins / deliveries', () => {
    const snap = buildWeeklySnapshot(emptyInput());
    // V1.5 pseudonymization — pseudonymLabel replaces raw userId at the prompt boundary.
    // V1.5.2 — widened to 32 bits (8 hex chars) + renamed `memberLabel` → `pseudonymLabel`.
    expect(snap.pseudonymLabel).toMatch(/^member-[A-F0-9]{8}$/);
    expect(snap.timezone).toBe('Europe/Paris');
    expect(snap.counters.tradesTotal).toBe(0);
    expect(snap.counters.tradesWin).toBe(0);
    expect(snap.counters.tradesLoss).toBe(0);
    expect(snap.counters.tradesBreakEven).toBe(0);
    expect(snap.counters.tradesOpen).toBe(0);
    expect(snap.counters.realizedRSum).toBe(0);
    expect(snap.counters.realizedRMean).toBeNull();
    expect(snap.counters.planRespectRate).toBeNull();
    expect(snap.counters.hedgeRespectRate).toBeNull();
    // SPEC §28/§21 — Session-2 process/habit axes: empty window → null rates
    // (no fake 0 %), meeting attendance 0/0 with null rate.
    expect(snap.counters.processCompleteRate).toBeNull();
    expect(snap.counters.formationFollowedRate).toBeNull();
    expect(snap.counters.marketAnalysisDoneRate).toBeNull();
    expect(snap.counters.morningRoutineCompletedRate).toBeNull();
    expect(snap.counters.meetingAttendance).toEqual({ scheduled: 0, completed: 0, rate: null });
    expect(snap.counters.morningCheckinsCount).toBe(0);
    expect(snap.counters.eveningCheckinsCount).toBe(0);
    expect(snap.counters.streakDays).toBe(0);
    expect(snap.counters.sleepHoursMedian).toBeNull();
    expect(snap.counters.moodMedian).toBeNull();
    expect(snap.counters.stressMedian).toBeNull();
    expect(snap.counters.douglasCardsDelivered).toBe(0);
    expect(snap.counters.douglasCardsSeen).toBe(0);
    expect(snap.counters.douglasCardsHelpful).toBe(0);
    expect(snap.freeText.emotionTags).toEqual([]);
    // D3-01 — no trades → no behaviour tags. D3-04 — 0/0 reliability split.
    expect(snap.freeText.behaviorTags).toEqual([]);
    expect(snap.counters.realizedRReliability).toEqual({ computed: 0, estimated: 0 });
    expect(snap.freeText.pairsTraded).toEqual([]);
    expect(snap.freeText.sessionsTraded).toEqual([]);
    expect(snap.freeText.journalExcerpts).toEqual([]);
    expect(snap.scores).toEqual({
      discipline: null,
      emotionalStability: null,
      consistency: null,
      engagement: null,
    });
  });
});

describe('buildWeeklySnapshot — trade counters', () => {
  it('aggregates wins / losses / BE / open with realizedR sum + mean', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1.2, { id: 't1' }),
      closedTrade('win', 0.8, { id: 't2' }),
      closedTrade('loss', -1, { id: 't3' }),
      closedTrade('break_even', 0, { id: 't4' }),
      makeTrade({ id: 't5_open', isClosed: false }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.tradesTotal).toBe(5);
    expect(snap.counters.tradesWin).toBe(2);
    expect(snap.counters.tradesLoss).toBe(1);
    expect(snap.counters.tradesBreakEven).toBe(1);
    expect(snap.counters.tradesOpen).toBe(1);
    expect(snap.counters.realizedRSum).toBe(1);
    expect(snap.counters.realizedRMean).toBe(0.25);
  });

  it('computes plan respect rate over closed trades only', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1, { planRespected: true }),
      closedTrade('loss', -1, { planRespected: false }),
      closedTrade('win', 1, { planRespected: true }),
      makeTrade({ isClosed: false, planRespected: true }), // open — excluded
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.planRespectRate).toBeCloseTo(2 / 3, 4);
  });

  it('hedge respect rate excludes nulls (N/A)', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1, { hedgeRespected: true }),
      closedTrade('loss', -1, { hedgeRespected: false }),
      closedTrade('break_even', 0, { hedgeRespected: null }), // N/A — excluded
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.hedgeRespectRate).toBe(0.5);
  });
});

describe('buildWeeklySnapshot — checkin medians + streak', () => {
  it('computes median sleepHours over morning checkins (odd sample)', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('morning', { id: 'm1', date: '2026-05-04', sleepHours: '6.5' }),
      makeCheckin('morning', { id: 'm2', date: '2026-05-05', sleepHours: '7.0' }),
      makeCheckin('morning', { id: 'm3', date: '2026-05-06', sleepHours: '8.0' }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.sleepHoursMedian).toBe(7);
    expect(snap.counters.streakDays).toBe(3);
  });

  it('computes median over even sample = mean of middle two', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('evening', { id: 'e1', date: '2026-05-04', stressScore: 3 }),
      makeCheckin('evening', { id: 'e2', date: '2026-05-05', stressScore: 5 }),
      makeCheckin('evening', { id: 'e3', date: '2026-05-06', stressScore: 6 }),
      makeCheckin('evening', { id: 'e4', date: '2026-05-07', stressScore: 8 }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.stressMedian).toBe(5.5);
  });

  it('mood median spans both morning + evening slots', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('morning', { id: 'mm1', moodScore: 6 }),
      makeCheckin('evening', { id: 'ee1', moodScore: 8 }),
      makeCheckin('evening', { id: 'ee2', moodScore: 7 }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.moodMedian).toBe(7);
  });

  it('streakDays counts unique dates across slots', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('morning', { id: 'a', date: '2026-05-04' }),
      makeCheckin('evening', { id: 'b', date: '2026-05-04' }), // same day, diff slot
      makeCheckin('morning', { id: 'c', date: '2026-05-05' }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.streakDays).toBe(2);
  });
});

// =============================================================================
// SPEC §7.10/§30 — routine & lifestyle counters (count-only, posture §2)
// =============================================================================

describe('buildWeeklySnapshot — routine & lifestyle counters (§7.10/§30 — count-only)', () => {
  it('aggregates sleepQuality median + meditation/sport/gratitude day counts (honest)', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('morning', {
        id: 'r1',
        date: '2026-05-04',
        sleepQuality: 8,
        meditationMin: 10,
        sportType: 'course',
        sportDurationMin: 30,
      }),
      makeCheckin('morning', {
        id: 'r2',
        date: '2026-05-05',
        sleepQuality: 6,
        meditationMin: 0, // logged 0 → NOT a meditation day
        sportType: null,
        sportDurationMin: null,
      }),
      makeCheckin('morning', {
        id: 'r3',
        date: '2026-05-06',
        sleepQuality: null, // unanswered → excluded from the median
        meditationMin: 20,
      }),
      makeCheckin('evening', { id: 'r4', date: '2026-05-04', gratitudeItems: ['ma famille'] }),
      makeCheckin('evening', { id: 'r5', date: '2026-05-05', gratitudeItems: [] }), // empty → no day
    ];
    const c = buildWeeklySnapshot(input).counters;
    expect(c.sleepQualityMedian).toBe(7); // median(8,6) — null excluded
    expect(c.meditationDaysCount).toBe(2); // 10 & 20 (the 0 is excluded)
    expect(c.meditationMinMedian).toBe(15); // median(10,20)
    expect(c.sportDaysCount).toBe(1); // only 2026-05-04 logged sport
    expect(c.gratitudeDaysCount).toBe(1); // only 2026-05-04 has a non-empty list
  });

  it('empty week → routine counters null/0 (no fake 0)', () => {
    const c = buildWeeklySnapshot(emptyInput()).counters;
    expect(c.sleepQualityMedian).toBeNull();
    expect(c.meditationMinMedian).toBeNull();
    expect(c.meditationDaysCount).toBe(0);
    expect(c.sportDaysCount).toBe(0);
    expect(c.gratitudeDaysCount).toBe(0);
  });
});

describe('buildWeeklySnapshot — Mark Douglas deliveries', () => {
  it('counts delivered / seen / helpful', () => {
    const input = emptyInput();
    input.deliveries = [
      makeDelivery({ id: 'd1' }), // not seen
      makeDelivery({ id: 'd2', seenAt: '2026-05-05T11:00:00Z' }), // seen, no feedback
      makeDelivery({
        id: 'd3',
        seenAt: '2026-05-05T11:00:00Z',
        helpful: true,
      }), // helpful
      makeDelivery({
        id: 'd4',
        seenAt: '2026-05-05T11:00:00Z',
        helpful: false,
      }), // not helpful
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.douglasCardsDelivered).toBe(4);
    expect(snap.counters.douglasCardsSeen).toBe(3);
    expect(snap.counters.douglasCardsHelpful).toBe(1);
  });
});

describe('buildWeeklySnapshot — free text aggregation', () => {
  it('emotion tags are frequency-sorted and capped at 20', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('loss', -1, { emotionBefore: ['fomo'], emotionAfter: ['frustrated', 'fomo'] }),
      closedTrade('win', 1, { emotionBefore: ['calm'], emotionAfter: ['satisfied'] }),
    ];
    input.checkins = [makeCheckin('evening', { emotionTags: ['fomo', 'tired'] })];
    const snap = buildWeeklySnapshot(input);
    // fomo appears 3 times, frustrated/calm/satisfied/tired 1 each.
    expect(snap.freeText.emotionTags[0]).toBe('fomo');
    expect(snap.freeText.emotionTags).toHaveLength(5);
  });

  it('aggregates emotionDuring into the weekly emotion summary (§22 axis)', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1, {
        emotionBefore: ['calm'],
        emotionDuring: ['anxious', 'doubt'],
        emotionAfter: ['satisfied'],
      }),
    ];
    const snap = buildWeeklySnapshot(input);
    // The in-position affect ("pendant") must feed the IA summary too, not just
    // entry/exit — 'anxious'/'doubt' are carried ONLY by emotionDuring here.
    expect(snap.freeText.emotionTags).toEqual(
      expect.arrayContaining(['calm', 'anxious', 'doubt', 'satisfied']),
    );
  });

  it('pairs traded are frequency-sorted and capped at 10', () => {
    const input = emptyInput();
    input.trades = [
      makeTrade({ id: 'a', pair: 'EURUSD' }),
      makeTrade({ id: 'b', pair: 'EURUSD' }),
      makeTrade({ id: 'c', pair: 'XAUUSD' }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.freeText.pairsTraded[0]).toBe('EURUSD');
    expect(snap.freeText.pairsTraded[1]).toBe('XAUUSD');
  });

  it('sessions traded preserve canonical order asia/london/newyork/overlap', () => {
    const input = emptyInput();
    input.trades = [
      makeTrade({ id: 'a', session: 'newyork' }),
      makeTrade({ id: 'b', session: 'asia' }),
      makeTrade({ id: 'c', session: 'newyork' }),
      makeTrade({ id: 'd', session: 'london' }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.freeText.sessionsTraded.map((s) => s.session)).toEqual([
      'asia',
      'london',
      'newyork',
    ]);
    expect(snap.freeText.sessionsTraded.find((s) => s.session === 'newyork')?.count).toBe(2);
  });
});

// =============================================================================
// D3-01 — behaviour bias tags (trade.tags — LESSOR/Steenbarger)
// =============================================================================

describe('buildWeeklySnapshot — behaviorTags (D3-01)', () => {
  it('empty week → empty behaviorTags array', () => {
    expect(buildWeeklySnapshot(emptyInput()).freeText.behaviorTags).toEqual([]);
  });

  it('collects trade.tags, counts occurrences, sorts by frequency desc', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('loss', -1, { id: 't1', tags: ['revenge-trade', 'loss-aversion'] }),
      closedTrade('loss', -1, { id: 't2', tags: ['revenge-trade'] }),
      makeTrade({ id: 't3', tags: ['overconfidence', 'revenge-trade'] }),
    ];
    const tags = buildWeeklySnapshot(input).freeText.behaviorTags;
    expect(tags[0]).toEqual({ tag: 'revenge-trade', count: 3 });
    expect(tags.find((b) => b.tag === 'loss-aversion')).toEqual({ tag: 'loss-aversion', count: 1 });
    expect(tags.find((b) => b.tag === 'overconfidence')).toEqual({
      tag: 'overconfidence',
      count: 1,
    });
  });

  it('caps distinct behaviour tags at BEHAVIOR_TAGS_MAX (12)', () => {
    const input = emptyInput();
    input.trades = Array.from({ length: 15 }, (_, i) =>
      makeTrade({ id: `t${i}`, tags: [`bias-${i}`] }),
    );
    const snap = buildWeeklySnapshot(input);
    expect(snap.freeText.behaviorTags).toHaveLength(12);
    expect(weeklySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

// =============================================================================
// D3-04 — realizedR reliability split (computed vs estimated)
// =============================================================================

describe('buildWeeklySnapshot — realizedRReliability (D3-04)', () => {
  it('empty week → 0 computed / 0 estimated', () => {
    expect(buildWeeklySnapshot(emptyInput()).counters.realizedRReliability).toEqual({
      computed: 0,
      estimated: 0,
    });
  });

  it('counts computed vs estimated only among closed trades with a realizedR', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1.5, { id: 'c1', realizedRSource: 'computed' }),
      closedTrade('win', 2, { id: 'c2', realizedRSource: 'computed' }),
      closedTrade('loss', -1, { id: 'e1', realizedRSource: 'estimated' }),
      // closed but realizedR null → excluded from both buckets.
      makeTrade({ id: 'x1', isClosed: true, realizedR: null, realizedRSource: 'estimated' }),
      // open, no realizedR → excluded.
      makeTrade({ id: 'o1', isClosed: false }),
    ];
    expect(buildWeeklySnapshot(input).counters.realizedRReliability).toEqual({
      computed: 2,
      estimated: 1,
    });
  });

  it('keeps the snapshot schema-valid', () => {
    const input = emptyInput();
    input.trades = [closedTrade('win', 1, { id: 'c1', realizedRSource: 'computed' })];
    expect(weeklySnapshotSchema.safeParse(buildWeeklySnapshot(input)).success).toBe(true);
  });
});

describe('buildWeeklySnapshot — journal excerpts sanitization', () => {
  it('truncates long journal notes to 200 chars + ellipsis', () => {
    const long = 'A'.repeat(300);
    const input = emptyInput();
    input.checkins = [makeCheckin('evening', { id: 'e_long', journalNote: long })];
    const snap = buildWeeklySnapshot(input);
    expect(snap.freeText.journalExcerpts).toHaveLength(1);
    const first = snap.freeText.journalExcerpts[0];
    expect(first?.length).toBe(201); // 200 chars + ellipsis
    expect(first?.endsWith('…')).toBe(true);
  });

  it('strips bidi / zero-width control chars (Trojan Source defense)', () => {
    // U+202E = right-to-left override (bidi attack vector)
    // U+200B = zero-width space
    const malicious = `Note normale‮IGNORE PRECEDENT​`;
    const input = emptyInput();
    input.checkins = [makeCheckin('evening', { id: 'malicious', journalNote: malicious })];
    const snap = buildWeeklySnapshot(input);
    const sanitized = snap.freeText.journalExcerpts[0];
    expect(sanitized).toBeDefined();
    expect(sanitized).not.toContain('‮');
    expect(sanitized).not.toContain('​');
  });

  it('caps at 5 excerpts, keeps most recent first', () => {
    const input = emptyInput();
    input.checkins = Array.from({ length: 8 }, (_, i) =>
      makeCheckin('evening', {
        id: `c_${i}`,
        date: `2026-05-0${i + 1}`,
        submittedAt: `2026-05-0${i + 1}T20:00:00Z`,
        journalNote: `Note ${i}`,
      }),
    );
    const snap = buildWeeklySnapshot(input);
    expect(snap.freeText.journalExcerpts).toHaveLength(5);
    expect(snap.freeText.journalExcerpts[0]).toBe('Note 7'); // most recent
  });

  it('skips empty / whitespace-only journal notes', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('evening', { id: 'a', journalNote: '   ' }),
      makeCheckin('evening', { id: 'b', journalNote: 'real note' }),
      makeCheckin('evening', { id: 'c', journalNote: null }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.freeText.journalExcerpts).toEqual(['real note']);
  });
});

describe('buildWeeklySnapshot — morning intentions (TASK A, MATIN twin)', () => {
  it('empty week → empty morningIntentions array (section absent)', () => {
    const snap = buildWeeklySnapshot(emptyInput());
    expect(snap.freeText.morningIntentions).toEqual([]);
  });

  it('collects 2 distinct morning intentions, most-recent first (morning slot + non-empty only)', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('morning', {
        id: 'm1',
        date: '2026-05-04',
        submittedAt: '2026-05-04T08:00:00Z',
        intention: 'Respecter mon plan aujourd’hui.',
      }),
      makeCheckin('morning', {
        id: 'm2',
        date: '2026-05-06',
        submittedAt: '2026-05-06T08:00:00Z',
        intention: 'Rester patient, ne pas forcer.',
      }),
      // evening slot carries an intention → excluded (MATIN-only path).
      makeCheckin('evening', {
        id: 'e1',
        date: '2026-05-07',
        submittedAt: '2026-05-07T20:00:00Z',
        intention: 'Intention du soir ignorée.',
      }),
      // morning but blank / null → skipped.
      makeCheckin('morning', { id: 'm3', date: '2026-05-05', intention: '   ' }),
      makeCheckin('morning', { id: 'm4', date: '2026-05-03', intention: null }),
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.freeText.morningIntentions).toEqual([
      'Rester patient, ne pas forcer.',
      'Respecter mon plan aujourd’hui.',
    ]);
  });
});

describe('buildWeeklySnapshot — scores pass-through', () => {
  it('null score → all-null', () => {
    const snap = buildWeeklySnapshot(emptyInput());
    expect(snap.scores).toEqual({
      discipline: null,
      emotionalStability: null,
      consistency: null,
      engagement: null,
    });
  });

  it('numeric score passes through', () => {
    const input = emptyInput();
    input.latestScore = {
      discipline: 78,
      emotionalStability: 65,
      consistency: 82,
      engagement: 91,
    };
    const snap = buildWeeklySnapshot(input);
    expect(snap.scores).toEqual({
      discipline: 78,
      emotionalStability: 65,
      consistency: 82,
      engagement: 91,
    });
  });

  it('partially-null score (insufficient_data on dimension) preserved', () => {
    const input = emptyInput();
    input.latestScore = {
      discipline: 78,
      emotionalStability: null, // insufficient sample
      consistency: 82,
      engagement: 91,
    };
    const snap = buildWeeklySnapshot(input);
    expect(snap.scores.emotionalStability).toBeNull();
    expect(snap.scores.discipline).toBe(78);
  });
});

describe('buildWeeklySnapshot — training volume (SPEC §21 J-T4)', () => {
  // 🚨 §21.5: the weekly report surfaces a COUNT of backtest sessions
  // (volume de pratique) ONLY. `BuilderInput` has no field by which a
  // backtest P&L (`resultR`/`outcome`/`plannedRR`) could reach the prompt.

  it('trainingSessionsCount defaults to 0 when the loader did not wire it', () => {
    const snap = buildWeeklySnapshot(emptyInput());
    expect(snap.counters.trainingSessionsCount).toBe(0);
  });

  it('propagates input.trainingActivityCount verbatim as the volume counter', () => {
    const input = emptyInput();
    input.trainingActivityCount = 4;
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.trainingSessionsCount).toBe(4);
  });

  it('is a pure integer count — deterministic, no hidden P&L channel', () => {
    const input = emptyInput();
    input.trainingActivityCount = 7;
    const a = buildWeeklySnapshot(input).counters.trainingSessionsCount;
    const b = buildWeeklySnapshot(input).counters.trainingSessionsCount;
    expect(a).toBe(7);
    expect(b).toBe(7);
  });
});

describe('buildWeeklySnapshot — annotations pass-through', () => {
  it('annotations counters propagated as-is', () => {
    const input = emptyInput();
    input.annotationsReceived = 3;
    input.annotationsViewed = 2;
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.annotationsReceived).toBe(3);
    expect(snap.counters.annotationsViewed).toBe(2);
  });
});

// =============================================================================
// SPEC §28/§21 — Session-2 process/habit axes as EXPLICIT NAMED COUNTERS
// =============================================================================

describe('buildWeeklySnapshot — Session-2 axis counters (§28 — count-only, by name)', () => {
  it('processCompleteRate = true / answered over CLOSED trades (null when unanswered)', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1, { id: 'p1', processComplete: true }),
      closedTrade('loss', -1, { id: 'p2', processComplete: true }),
      closedTrade('win', 1, { id: 'p3', processComplete: false }),
      closedTrade('break_even', 0, { id: 'p4', processComplete: null }), // unanswered — excluded
      makeTrade({ id: 'p5_open', isClosed: false, processComplete: true }), // open — excluded
    ];
    const snap = buildWeeklySnapshot(input);
    // 2 true over 3 answered closed trades.
    expect(snap.counters.processCompleteRate).toBeCloseTo(2 / 3, 4);
  });

  it('processCompleteRate is null when no closed trade answered the question', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1, { id: 'n1', processComplete: null }),
      makeTrade({ id: 'n2_open', isClosed: false, processComplete: true }),
    ];
    expect(buildWeeklySnapshot(input).counters.processCompleteRate).toBeNull();
  });

  it('formationFollowedRate = true / answered over EVENING checkins', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('evening', { id: 'f1', formationFollowed: true }),
      makeCheckin('evening', { id: 'f2', formationFollowed: false }),
      makeCheckin('evening', { id: 'f3', formationFollowed: null }), // unanswered — excluded
      makeCheckin('morning', { id: 'f4', formationFollowed: true }), // wrong slot — excluded
    ];
    expect(buildWeeklySnapshot(input).counters.formationFollowedRate).toBe(0.5);
  });

  it('marketAnalysisDoneRate + morningRoutineCompletedRate = true / answered over MORNINGS', () => {
    const input = emptyInput();
    input.checkins = [
      makeCheckin('morning', {
        id: 'a1',
        marketAnalysisDone: true,
        morningRoutineCompleted: true,
      }),
      makeCheckin('morning', {
        id: 'a2',
        marketAnalysisDone: true,
        morningRoutineCompleted: false,
      }),
      makeCheckin('morning', {
        id: 'a3',
        marketAnalysisDone: false,
        morningRoutineCompleted: null, // routine unanswered — excluded from its denom
      }),
      makeCheckin('evening', { id: 'a4', marketAnalysisDone: true }), // wrong slot — excluded
    ];
    const snap = buildWeeklySnapshot(input);
    expect(snap.counters.marketAnalysisDoneRate).toBeCloseTo(2 / 3, 4); // 2 true / 3 answered
    expect(snap.counters.morningRoutineCompletedRate).toBe(0.5); // 1 true / 2 answered
  });

  it('meetingAttendance reflects scheduled/completed counts + rate', () => {
    const input = emptyInput();
    input.meetingScheduledCount = 4;
    input.meetingCompletedCount = 3;
    expect(buildWeeklySnapshot(input).counters.meetingAttendance).toEqual({
      scheduled: 4,
      completed: 3,
      rate: 0.75,
    });
  });

  it('meetingAttendance rate is null when nothing was scheduled (no fake 0 %)', () => {
    const input = emptyInput();
    input.meetingScheduledCount = 0;
    input.meetingCompletedCount = 0;
    expect(buildWeeklySnapshot(input).counters.meetingAttendance).toEqual({
      scheduled: 0,
      completed: 0,
      rate: null,
    });
  });

  it('all five axes default gracefully when the loader did not wire meeting counts', () => {
    const snap = buildWeeklySnapshot(emptyInput());
    expect(snap.counters.meetingAttendance).toEqual({ scheduled: 0, completed: 0, rate: null });
  });
});

// =============================================================================
// V1.5 — pseudonymization (pseudonymLabel replaces userId at the prompt boundary)
// V1.5.2 — widened to 32 bits (8 hex chars) + NFC normalization + rename
// =============================================================================

describe('pseudonymizeMember — V1.5 prompt boundary defense', () => {
  it('produces a deterministic member-XXXXXXXX label (V1.5.2 32-bit)', () => {
    const label = pseudonymizeMember('user_test_1');
    expect(label).toMatch(/^member-[A-F0-9]{8}$/);
    // Same input → same output across calls (no Date.now or random).
    expect(pseudonymizeMember('user_test_1')).toBe(label);
  });

  it('different userIds produce different labels (collision-free at V1 cohort scale)', () => {
    const labels = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      labels.add(pseudonymizeMember(`user_test_${i}`));
    }
    // 1000 unique inputs in a 32-bit space (V1.5.2) → expected collisions ~0.0001.
    // We assert no collisions happen on this fixture (deterministic seeds).
    expect(labels.size).toBe(1000);
  });

  it('throws on empty userId (defense against programming errors — security M3)', () => {
    expect(() => pseudonymizeMember('')).toThrow(TypeError);
  });

  it('handles edge-case userIds (unicode, very long) without crashing', () => {
    expect(pseudonymizeMember('ñoño-éà')).toMatch(/^member-[A-F0-9]{8}$/);
    expect(pseudonymizeMember('a'.repeat(1000))).toMatch(/^member-[A-F0-9]{8}$/);
  });

  it('NFC-normalizes the userId before hashing (V1.5.2 — Unicode robustness)', () => {
    // The same character can be encoded NFC (composed) or NFD (decomposed) —
    // they hash differently as raw bytes but should yield the same label
    // after V1.5.2 NFC normalization.
    const nfc = 'é'; // é (single codepoint, NFC)
    const nfd = 'é'; // e + combining acute (NFD)
    expect(pseudonymizeMember(nfc)).toBe(pseudonymizeMember(nfd));
  });

  it('respects MEMBER_LABEL_SALT env var (V1.5 security M1 hardening)', () => {
    const userId = 'user_test_salted';
    const unsalted = pseudonymizeMember(userId, '');
    const salted = pseudonymizeMember(userId, 'fxmily-test-salt-32chars-long-enough');
    expect(salted).not.toBe(unsalted);
    expect(salted).toMatch(/^member-[A-F0-9]{8}$/);
    // Same salt → same label (deterministic).
    expect(pseudonymizeMember(userId, 'fxmily-test-salt-32chars-long-enough')).toBe(salted);
  });

  it('does NOT include the original userId in the label (one-way)', () => {
    const userId = 'cm0xyz123abc456def789';
    const label = pseudonymizeMember(userId);
    // The label is 8 hex chars (V1.5.2); the cuid is 21+ alphanum. No substring match.
    expect(label.toLowerCase()).not.toContain(userId.toLowerCase().slice(0, 8));
  });

  it('snapshot.pseudonymLabel is set (not snapshot.userId — that field is removed)', () => {
    const input = emptyInput();
    input.userId = 'user_test_pseudo';
    const snap = buildWeeklySnapshot(input);
    expect(snap.pseudonymLabel).toBe(pseudonymizeMember('user_test_pseudo'));
    // TypeScript: snap should not expose `userId` field anymore.
    // @ts-expect-error — `userId` is no longer a property of WeeklySnapshot.
    expect(snap.userId).toBeUndefined();
    // TypeScript: snap.memberLabel was renamed to snap.pseudonymLabel in V1.5.2.
    // @ts-expect-error — `memberLabel` is no longer a property of WeeklySnapshot.
    expect(snap.memberLabel).toBeUndefined();
  });
});

describe('DOD3-01 / DoD#2 S6 — Session-3 verification counters', () => {
  it('relays the verification slice verbatim into the snapshot (schema-valid)', () => {
    const snap = buildWeeklySnapshot({
      ...emptyInput(),
      verification: {
        constancy: { value: 81, honesty: 80, regularity: 95, discipline: 70 },
        openDiscrepancyCount: 1,
        alertCount: 0,
      },
    });
    expect(snap.verification).toEqual({
      constancy: { value: 81, honesty: 80, regularity: 95, discipline: 70 },
      openDiscrepancyCount: 1,
      alertCount: 0,
    });
    expect(weeklySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('accepts a null constancy (no signal — never a fake neutral score, §33.6)', () => {
    const snap = buildWeeklySnapshot(emptyInput());
    expect(snap.verification.constancy).toBeNull();
    expect(weeklySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

describe('buildWeeklySnapshot — patternSignals (S15 #7)', () => {
  it('omits patternSignals entirely when nothing clears its threshold', () => {
    const snap = buildWeeklySnapshot(emptyInput());
    expect(snap.patternSignals).toBeUndefined();
    expect(weeklySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('surfaces sample-gated cross-cuts (emotion, hour band, arc, momentum)', () => {
    const input = emptyInput();
    // 6 closed losses entered calm → exited frustrated, all in the Paris morning band.
    input.trades = Array.from({ length: 6 }, (_, i) =>
      closedTrade('loss', -1, {
        id: `l${i}`,
        emotionBefore: ['calm'],
        emotionAfter: ['frustrated'],
      }),
    );
    // Declining emotionalStability over 7 daily points (~ -2/day ≈ -14/week).
    input.scoreHistory = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-0${i + 1}`,
      discipline: 70,
      emotionalStability: 90 - i * 2,
      consistency: null,
      engagement: null,
    }));

    const snap = buildWeeklySnapshot(input);
    const p = snap.patternSignals;
    expect(p).toBeDefined();
    expect(p!.topEntryEmotion).toEqual({ slug: 'calm', trades: 6, winRatePct: 0 });
    expect(p!.topHourBand?.slot).toBe('morning');
    expect(p!.topHourBand?.trades).toBe(6);
    expect(p!.emotionArc).toEqual({ count: 6, considered: 6 });
    expect(p!.momentumDeclines?.[0]?.dimension).toBe('emotionalStability');
    // The whole snapshot must still satisfy the strict schema.
    expect(weeklySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('omits the slice when every sub-signal is below its threshold', () => {
    const input = emptyInput();
    // Only 2 closed losses → below HOURLY_MIN_SAMPLE (5) and EMOTION_ARC_MIN (3),
    // and no score history → no momentum.
    input.trades = [
      closedTrade('loss', -1, { id: 'a', emotionBefore: ['calm'], emotionAfter: ['frustrated'] }),
      closedTrade('loss', -1, { id: 'b', emotionBefore: ['calm'], emotionAfter: ['frustrated'] }),
    ];
    expect(buildWeeklySnapshot(input).patternSignals).toBeUndefined();
  });
});
