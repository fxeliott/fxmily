import { describe, expect, it } from 'vitest';

import { monthlySnapshotSchema } from '@/lib/schemas/monthly-debrief';

import { buildMonthlySnapshot } from './builder';
import type { MonthlyBuilderInput } from './types';

/**
 * SPEC §25 — PURE monthly aggregator (J-M1, TDD-first per §25.8). Carbon of
 * `weekly-report/builder.test.ts` posture: pin the REAL counter maths, the
 * §21.5 training passthrough (count/recency only — never a backtest P&L),
 * the ≤4 weekly-summaries context cap + sanitisation, and schema validity.
 */

const LABEL = 'member-A1B2C3D4';

function baseInput(over: Partial<MonthlyBuilderInput> = {}): MonthlyBuilderInput {
  return {
    pseudonymLabel: LABEL,
    timezone: 'Europe/Paris',
    monthStart: new Date('2026-04-30T22:00:00.000Z'), // Paris 2026-05-01 00:00
    monthEnd: new Date('2026-05-31T21:59:59.999Z'),
    accountAgeDaysInWindow: 31,
    trades: [],
    checkins: [],
    deliveries: [],
    annotationsReceived: 0,
    annotationsViewed: 0,
    latestScore: null,
    // DoD#3 / §29 — empty history + the local month-start anchor (Paris 2026-05-01).
    scoreHistory: [],
    monthStartLocal: '2026-05-01',
    weeklySummaries: [],
    // TASK B — onboarding profile defaults to absent (null); tests that exercise
    // it override with a truncated reference.
    memberProfile: null,
    training: { backtestCount: 0, daysSinceLastBacktest: null, hasEverPractised: false },
    // DOD3-01 / DoD#2 S6 — Session-3 counters default to the empty (no-signal)
    // shape; tests that exercise S3 override it.
    verification: {
      constancy: null,
      constancyPrevious: null,
      openDiscrepancyCount: 0,
      alertCount: 0,
    },
    ...over,
  };
}

function trade(over: Record<string, unknown> = {}): MonthlyBuilderInput['trades'][number] {
  return {
    id: 'cuid',
    pair: 'EURUSD',
    direction: 'long',
    session: 'london',
    isClosed: true,
    outcome: 'win',
    realizedR: '1.5',
    realizedRSource: 'computed',
    plannedRR: '2',
    riskPct: '1.0',
    tradeQuality: 'A',
    planRespected: true,
    hedgeRespected: null,
    emotionBefore: [],
    emotionAfter: [],
    // D3-01 — post-outcome bias tags (default empty; the aggregator reads them).
    tags: [],
    enteredAt: '2026-05-10T09:00:00.000Z',
    ...over,
    // Partial fixture: the pure aggregator reads only the subset above.
    // Double-cast via `unknown` is the canonical test-fixture pattern when
    // the real type carries fields the unit under test never touches.
  } as unknown as MonthlyBuilderInput['trades'][number];
}

function checkin(over: Record<string, unknown> = {}): MonthlyBuilderInput['checkins'][number] {
  return {
    date: '2026-05-10',
    slot: 'morning',
    moodScore: 7,
    stressScore: null,
    sleepHours: '7.5',
    // Routine/lifestyle fields — prod-shaped defaults (loader always sets them;
    // `gratitudeItems` is a non-null `String[]`). The aggregator reads these.
    sleepQuality: null,
    meditationMin: null,
    sportType: null,
    sportDurationMin: null,
    intention: null,
    gratitudeItems: [],
    journalNote: null,
    emotionTags: [],
    submittedAt: '2026-05-10T07:00:00.000Z',
    ...over,
  } as unknown as MonthlyBuilderInput['checkins'][number];
}

describe('buildMonthlySnapshot — passthrough + shape', () => {
  it('relays label/timezone/window/accountAge and yields a schema-valid snapshot', () => {
    const snap = buildMonthlySnapshot(baseInput());
    expect(snap.pseudonymLabel).toBe(LABEL);
    expect(snap.timezone).toBe('Europe/Paris');
    expect(snap.accountAgeDaysInWindow).toBe(31);
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('empty month → zeroed real counters, nulls where no sample', () => {
    const r = buildMonthlySnapshot(baseInput()).real;
    expect(r.tradesTotal).toBe(0);
    expect(r.realizedRSum).toBe(0);
    expect(r.realizedRMean).toBeNull();
    expect(r.planRespectRate).toBeNull();
    expect(r.hedgeRespectRate).toBeNull();
    expect(r.sleepHoursMedian).toBeNull();
    expect(r.moodMedian).toBeNull();
    expect(r.distinctCheckinDays).toBe(0);
    // SPEC §28/§21 — Session-2 process/habit axes: empty month → null rates
    // (no fake 0 %), meeting attendance 0/0 with null rate.
    expect(r.processCompleteRate).toBeNull();
    expect(r.formationFollowedRate).toBeNull();
    expect(r.marketAnalysisDoneRate).toBeNull();
    expect(r.morningRoutineCompletedRate).toBeNull();
    expect(r.meetingAttendance).toEqual({ scheduled: 0, completed: 0, rate: null });
  });
});

describe('buildMonthlySnapshot — Session-2 axis counters (§28 — count-only, by name)', () => {
  it('process/formation/marketAnalysis/morningRoutine rates = true / answered (null when unanswered)', () => {
    const r = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({ processComplete: true }),
          trade({ processComplete: false }),
          trade({ processComplete: null }), // unanswered — excluded
          trade({ isClosed: false, outcome: null, processComplete: true }), // open — excluded
        ],
        checkins: [
          checkin({ slot: 'morning', marketAnalysisDone: true, morningRoutineCompleted: true }),
          checkin({ slot: 'morning', marketAnalysisDone: false, morningRoutineCompleted: null }),
          checkin({ slot: 'evening', formationFollowed: true }),
          checkin({ slot: 'evening', formationFollowed: false }),
          checkin({ slot: 'evening', formationFollowed: null }), // unanswered — excluded
        ],
      }),
    ).real;
    expect(r.processCompleteRate).toBe(0.5); // 1 true / 2 answered closed
    expect(r.marketAnalysisDoneRate).toBe(0.5); // 1 true / 2 answered mornings
    expect(r.morningRoutineCompletedRate).toBe(1); // 1 true / 1 answered morning
    expect(r.formationFollowedRate).toBe(0.5); // 1 true / 2 answered evenings
  });

  it('meetingAttendance reflects scheduled/completed + rate, null rate when none scheduled', () => {
    const withMeetings = buildMonthlySnapshot(
      baseInput({ meetingScheduledCount: 5, meetingCompletedCount: 4 }),
    ).real;
    expect(withMeetings.meetingAttendance).toEqual({ scheduled: 5, completed: 4, rate: 0.8 });

    const none = buildMonthlySnapshot(baseInput()).real;
    expect(none.meetingAttendance).toEqual({ scheduled: 0, completed: 0, rate: null });
  });

  it('the new axes keep the snapshot schema-valid (.strict() preserved)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [trade({ processComplete: true })],
        checkins: [checkin({ slot: 'evening', formationFollowed: true })],
        meetingScheduledCount: 2,
        meetingCompletedCount: 1,
      }),
    );
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

describe('buildMonthlySnapshot — REAL counter maths (carbon weekly)', () => {
  it('classifies win/loss/BE/open + realizedR sum & mean', () => {
    const r = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({ outcome: 'win', realizedR: '2' }),
          trade({ outcome: 'loss', realizedR: '-1' }),
          trade({ outcome: 'break_even', realizedR: '0' }),
          trade({ isClosed: false, outcome: null, realizedR: null }),
        ],
      }),
    ).real;
    expect(r.tradesTotal).toBe(4);
    expect(r.tradesWin).toBe(1);
    expect(r.tradesLoss).toBe(1);
    expect(r.tradesBreakEven).toBe(1);
    expect(r.tradesOpen).toBe(1);
    expect(r.realizedRSum).toBe(1); // 2 + (-1) + 0
    expect(r.realizedRMean).toBeCloseTo(1 / 3, 4);
  });

  it('plan respect rate over closed trades; hedge rate excludes N/A', () => {
    const r = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({ planRespected: true, hedgeRespected: true }),
          trade({ planRespected: false, hedgeRespected: false }),
          trade({ planRespected: true, hedgeRespected: null }),
        ],
      }),
    ).real;
    expect(r.planRespectRate).toBeCloseTo(2 / 3, 4);
    expect(r.hedgeRespectRate).toBeCloseTo(1 / 2, 4); // null excluded
  });

  it('medians + distinct checkin days + slot split + tradeQuality + riskPct', () => {
    const r = buildMonthlySnapshot(
      baseInput({
        checkins: [
          checkin({ date: '2026-05-01', slot: 'morning', sleepHours: '6', moodScore: 5 }),
          checkin({ date: '2026-05-01', slot: 'evening', stressScore: 4, moodScore: 7 }),
          checkin({ date: '2026-05-02', slot: 'morning', sleepHours: '8', moodScore: 9 }),
        ],
        trades: [
          trade({ tradeQuality: 'A', riskPct: '1' }),
          trade({ tradeQuality: 'C', riskPct: '3' }),
          trade({ tradeQuality: null, riskPct: null }),
        ],
      }),
    ).real;
    expect(r.morningCheckinsCount).toBe(2);
    expect(r.eveningCheckinsCount).toBe(1);
    expect(r.distinctCheckinDays).toBe(2);
    expect(r.sleepHoursMedian).toBe(7); // median(6,8)
    expect(r.moodMedian).toBe(7); // median(5,7,9)
    expect(r.stressMedian).toBe(4);
    expect(r.tradesQualityA).toBe(1);
    expect(r.tradesQualityC).toBe(1);
    expect(r.tradesQualityCaptured).toBe(2);
    expect(r.riskPctMedian).toBe(2); // median(1,3)
    expect(r.riskPctOverTwoCount).toBe(1); // 3 > 2
  });

  it('SPEC §7.10/§30 — routine & lifestyle counters (count-only, honest)', () => {
    const r = buildMonthlySnapshot(
      baseInput({
        checkins: [
          checkin({
            date: '2026-05-01',
            slot: 'morning',
            sleepQuality: 8,
            meditationMin: 10,
            sportType: 'course',
            sportDurationMin: 30,
          }),
          checkin({
            date: '2026-05-02',
            slot: 'morning',
            sleepQuality: 6,
            meditationMin: 0, // logged 0 → NOT a meditation day
            sportType: null,
            sportDurationMin: null,
          }),
          checkin({
            date: '2026-05-03',
            slot: 'morning',
            sleepQuality: null, // unanswered → excluded from the median
            meditationMin: 20,
          }),
          checkin({ date: '2026-05-01', slot: 'evening', gratitudeItems: ['ma famille'] }),
          checkin({ date: '2026-05-02', slot: 'evening', gratitudeItems: [] }), // empty → no day
        ],
      }),
    ).real;
    expect(r.sleepQualityMedian).toBe(7); // median(8,6) — null excluded
    expect(r.meditationDaysCount).toBe(2); // 10 & 20 (the 0 is excluded)
    expect(r.meditationMinMedian).toBe(15); // median(10,20)
    expect(r.sportDaysCount).toBe(1); // only 2026-05-01 logged sport
    expect(r.gratitudeDaysCount).toBe(1); // only 2026-05-01 has a non-empty list
  });

  it('SPEC §7.10/§30 — empty month → routine counters null/0 (no fake 0)', () => {
    const r = buildMonthlySnapshot(baseInput()).real;
    expect(r.sleepQualityMedian).toBeNull();
    expect(r.meditationMinMedian).toBeNull();
    expect(r.meditationDaysCount).toBe(0);
    expect(r.sportDaysCount).toBe(0);
    expect(r.gratitudeDaysCount).toBe(0);
  });
});

describe('buildMonthlySnapshot — §21.5 training firewall (count/recency only)', () => {
  it('relays the training effort slice verbatim — no P&L channel exists', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        training: { backtestCount: 12, daysSinceLastBacktest: 3, hasEverPractised: true },
      }),
    );
    expect(snap.training).toEqual({
      backtestCount: 12,
      daysSinceLastBacktest: 3,
      hasEverPractised: true,
    });
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('the .strict() training slice rejects a smuggled backtest P&L key', () => {
    const snap = buildMonthlySnapshot(baseInput());
    const tampered = {
      ...snap,
      training: { ...snap.training, resultR: 1.8 },
    };
    const parsed = monthlySnapshotSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain('resultR');
    }
  });

  it('never-practised member → honest hasEverPractised=false, null recency', () => {
    const snap = buildMonthlySnapshot(baseInput());
    expect(snap.training.hasEverPractised).toBe(false);
    expect(snap.training.daysSinceLastBacktest).toBeNull();
    expect(snap.training.backtestCount).toBe(0);
  });
});

// =============================================================================
// FIX C S5 — emotion tags (trade before/during/after + checkin emotionTags)
// =============================================================================

describe('buildMonthlySnapshot — emotionTags (FIX C S5 hardening)', () => {
  it('empty month → empty emotionTags array', () => {
    const snap = buildMonthlySnapshot(baseInput());
    expect(snap.emotionTags).toEqual([]);
  });

  it('collects tags from trade.emotionBefore, emotionDuring, emotionAfter + checkin.emotionTags', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({
            emotionBefore: ['fomo', 'fear-loss'],
            emotionDuring: ['fomo'] as never,
            emotionAfter: ['calm'] as never,
          }),
          trade({
            emotionBefore: ['fomo'],
            emotionDuring: ['fear-loss'] as never,
            emotionAfter: [] as never,
          }),
        ],
        checkins: [checkin({ emotionTags: ['fomo', 'calm'] })],
      }),
    );
    // fomo: 3 (before×2 + during×1 + checkin×1 = 4), fear-loss: 2, calm: 2
    const tags = snap.emotionTags;
    const fomoEntry = tags.find((e) => e.tag === 'fomo');
    expect(fomoEntry).toBeDefined();
    expect(fomoEntry!.count).toBe(4); // 2 from before, 1 from during, 1 from checkin
    const fearLossEntry = tags.find((e) => e.tag === 'fear-loss');
    expect(fearLossEntry).toBeDefined();
    expect(fearLossEntry!.count).toBe(2); // 1 from before, 1 from during
    // Result is sorted by frequency desc
    expect(tags[0]!.tag).toBe('fomo');
  });

  it('emotionTags snapshot validates against monthlySnapshotSchema', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({
            emotionBefore: ['fomo'] as never,
            emotionDuring: ['fear-loss'] as never,
            emotionAfter: ['calm'] as never,
          }),
        ],
        checkins: [checkin({ emotionTags: ['fomo'] })],
      }),
    );
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

// =============================================================================
// D3-01 — behaviour bias tags (trade.tags — LESSOR/Steenbarger)
// =============================================================================

describe('buildMonthlySnapshot — behaviorTags (D3-01)', () => {
  it('empty month → empty behaviorTags array', () => {
    const snap = buildMonthlySnapshot(baseInput());
    expect(snap.behaviorTags).toEqual([]);
  });

  it('collects trade.tags, counts occurrences, sorts by frequency desc', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({ tags: ['revenge-trade', 'loss-aversion'] }),
          trade({ tags: ['revenge-trade'] }),
          trade({ tags: ['overconfidence', 'revenge-trade'] }),
        ],
      }),
    );
    const tags = snap.behaviorTags;
    expect(tags[0]).toEqual({ tag: 'revenge-trade', count: 3 });
    const lossAversion = tags.find((b) => b.tag === 'loss-aversion');
    expect(lossAversion).toEqual({ tag: 'loss-aversion', count: 1 });
    const overconfidence = tags.find((b) => b.tag === 'overconfidence');
    expect(overconfidence).toEqual({ tag: 'overconfidence', count: 1 });
  });

  it('caps distinct behaviour tags at BEHAVIOR_TAGS_MAX (12)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: Array.from({ length: 15 }, (_, i) => trade({ id: `t${i}`, tags: [`bias-${i}`] })),
      }),
    );
    expect(snap.behaviorTags).toHaveLength(12);
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

// =============================================================================
// D3-04 — realizedR reliability split (computed vs estimated)
// =============================================================================

describe('buildMonthlySnapshot — realizedRReliability (D3-04)', () => {
  it('empty month → 0 computed / 0 estimated', () => {
    const r = buildMonthlySnapshot(baseInput()).real;
    expect(r.realizedRReliability).toEqual({ computed: 0, estimated: 0 });
  });

  it('counts computed vs estimated only among closed trades with a realizedR', () => {
    const r = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({ realizedR: '1.5', realizedRSource: 'computed' }),
          trade({ realizedR: '2', realizedRSource: 'computed' }),
          trade({ realizedR: '-1', realizedRSource: 'estimated' }),
          // realizedR null → excluded from both buckets even if source set.
          trade({ realizedR: null, realizedRSource: 'estimated' }),
          // open trade with no realizedR → excluded.
          trade({ isClosed: false, outcome: null, realizedR: null, realizedRSource: null }),
        ],
      }),
    ).real;
    expect(r.realizedRReliability).toEqual({ computed: 2, estimated: 1 });
  });

  it('keeps the snapshot schema-valid', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [trade({ realizedR: '1', realizedRSource: 'computed' })],
      }),
    );
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

// =============================================================================
// DoD#3 / §29 — scoreProgression (N-1 vs N delta, real numbers)
// =============================================================================

function point(
  date: string,
  over: Partial<{
    discipline: number | null;
    emotionalStability: number | null;
    consistency: number | null;
    engagement: number | null;
  }> = {},
): MonthlyBuilderInput['scoreHistory'][number] {
  return {
    date,
    discipline: 50,
    emotionalStability: 50,
    consistency: 50,
    engagement: 50,
    ...over,
  };
}

describe('buildMonthlySnapshot — scoreProgression (DoD#3 / §29 measurable progression)', () => {
  it('empty history → null (no fabrication)', () => {
    expect(buildMonthlySnapshot(baseInput()).scoreProgression).toBeNull();
  });

  it('single point → null (<2 points, nothing to compare)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({ scoreHistory: [point('2026-05-15', { discipline: 70 })] }),
    );
    expect(snap.scoreProgression).toBeNull();
  });

  it('no point at/before monthStart → null (no entry-of-month baseline)', () => {
    // Both points are strictly AFTER the 2026-05-01 anchor.
    const snap = buildMonthlySnapshot(
      baseInput({
        scoreHistory: [point('2026-05-10'), point('2026-05-31')],
      }),
    );
    expect(snap.scoreProgression).toBeNull();
  });

  it('baseline = latest point at/before monthStart; current = last point; delta = current − previous', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        scoreHistory: [
          point('2026-04-15', {
            discipline: 40,
            emotionalStability: 50,
            consistency: 60,
            engagement: 70,
          }),
          // entry-of-month baseline (latest ≤ 2026-05-01)
          point('2026-05-01', {
            discipline: 60,
            emotionalStability: 55,
            consistency: 50,
            engagement: 45,
          }),
          point('2026-05-20', {
            discipline: 65,
            emotionalStability: 58,
            consistency: 52,
            engagement: 48,
          }),
          // current (last point)
          point('2026-05-31', {
            discipline: 72,
            emotionalStability: 50,
            consistency: 61,
            engagement: 40,
          }),
        ],
      }),
    );
    const prog = snap.scoreProgression;
    expect(prog).not.toBeNull();
    expect(prog!.previousDate).toBe('2026-05-01');
    expect(prog!.currentDate).toBe('2026-05-31');
    expect(prog!.previous).toEqual({
      discipline: 60,
      emotionalStability: 55,
      consistency: 50,
      engagement: 45,
    });
    expect(prog!.current).toEqual({
      discipline: 72,
      emotionalStability: 50,
      consistency: 61,
      engagement: 40,
    });
    // delta = current − previous per dimension (72−60, 50−55, 61−50, 40−45).
    expect(prog!.delta).toEqual({
      discipline: 12,
      emotionalStability: -5,
      consistency: 11,
      engagement: -5,
    });
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('a null dimension on either bound → null delta (never a fabricated number)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        scoreHistory: [
          // baseline: consistency insufficient_data that day
          point('2026-05-01', { discipline: 60, consistency: null }),
          // current: emotionalStability insufficient_data that day
          point('2026-05-31', { discipline: 70, emotionalStability: null, consistency: 55 }),
        ],
      }),
    );
    const prog = snap.scoreProgression;
    expect(prog).not.toBeNull();
    expect(prog!.delta.discipline).toBe(10); // both non-null → 70 − 60
    expect(prog!.delta.emotionalStability).toBeNull(); // current null
    expect(prog!.delta.consistency).toBeNull(); // previous null
    expect(prog!.delta.engagement).toBe(0); // 50 − 50
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('baseline point and current point identical date → null (single in-window point)', () => {
    // Two points, but only ONE is at/before monthStart AND it is the last one
    // too (e.g. history flattened to a single anchor). Guard: previous===current.
    const snap = buildMonthlySnapshot(
      baseInput({
        scoreHistory: [point('2026-04-20'), point('2026-04-20')],
        monthStartLocal: '2026-05-01',
      }),
    );
    // Both ≤ monthStart; last point is 2026-04-20, baseline is also 2026-04-20
    // (same date) → null.
    expect(snap.scoreProgression).toBeNull();
  });
});

describe('buildMonthlySnapshot — weekly summaries context + scores', () => {
  it('caps weekly summaries to 4 and strips bidi/zero-width (Trojan Source)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        weeklySummaries: [
          'Semaine 1 calme.',
          'Semaine 2 disciplinée.',
          'Semaine 3‮stable.', // RLO bidi override
          'Semaine 4 ok.',
          'Semaine 5 (overflow, dropped).',
        ],
      }),
    );
    expect(snap.weeklySummaries).toHaveLength(4);
    expect(snap.weeklySummaries.join('')).not.toContain('‮');
    expect(snap.weeklySummaries[4]).toBeUndefined();
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('scores: null pass-through and numeric pass-through', () => {
    expect(buildMonthlySnapshot(baseInput()).scores).toEqual({
      discipline: null,
      emotionalStability: null,
      consistency: null,
      engagement: null,
    });
    const withScore = buildMonthlySnapshot(
      baseInput({
        latestScore: { discipline: 80, emotionalStability: 70, consistency: null, engagement: 65 },
      }),
    ).scores;
    expect(withScore).toEqual({
      discipline: 80,
      emotionalStability: 70,
      consistency: null,
      engagement: 65,
    });
  });
});

// =============================================================================
// TASK D — journal excerpts (recency-sorted, safeFreeText + truncate ~200)
// =============================================================================

describe('buildMonthlySnapshot — journalExcerpts (TASK D)', () => {
  it('empty month → empty journalExcerpts array', () => {
    expect(buildMonthlySnapshot(baseInput()).journalExcerpts).toEqual([]);
  });

  it('collects non-empty journalNote, most-recent first, skipping null/blank', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        checkins: [
          checkin({ submittedAt: '2026-05-01T07:00:00.000Z', journalNote: 'Premier jour calme.' }),
          checkin({ submittedAt: '2026-05-03T07:00:00.000Z', journalNote: 'Trois jours après.' }),
          checkin({ submittedAt: '2026-05-02T07:00:00.000Z', journalNote: null }), // skipped
          checkin({ submittedAt: '2026-05-04T07:00:00.000Z', journalNote: '   ' }), // blank → skipped
        ],
      }),
    );
    expect(snap.journalExcerpts).toEqual(['Trois jours après.', 'Premier jour calme.']);
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('truncates a long note to ~200 chars + ellipsis and strips bidi (Trojan Source)', () => {
    const long = 'a'.repeat(250);
    const snap = buildMonthlySnapshot(
      baseInput({
        checkins: [checkin({ journalNote: `${long}‮` })],
      }),
    );
    const first = snap.journalExcerpts[0]!;
    expect(first.startsWith('a'.repeat(200))).toBe(true);
    expect(first.endsWith('…')).toBe(true);
    expect(first).not.toContain('‮');
  });

  it('caps the journal excerpts at JOURNAL_EXCERPTS_MAX (10)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        checkins: Array.from({ length: 14 }, (_, i) =>
          checkin({
            date: `2026-05-${String(i + 1).padStart(2, '0')}`,
            submittedAt: `2026-05-${String(i + 1).padStart(2, '0')}T07:00:00.000Z`,
            journalNote: `note ${i}`,
          }),
        ),
      }),
    );
    expect(snap.journalExcerpts).toHaveLength(10);
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

// =============================================================================
// TASK A — morning intentions (MATIN twin of journalExcerpts)
// =============================================================================

describe('buildMonthlySnapshot — morningIntentions (TASK A)', () => {
  it('empty month → empty morningIntentions array (section absent)', () => {
    expect(buildMonthlySnapshot(baseInput()).morningIntentions).toEqual([]);
  });

  it('collects 2 distinct morning intentions, most-recent first (morning slot + non-empty only)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        checkins: [
          checkin({
            slot: 'morning',
            submittedAt: '2026-05-01T07:00:00.000Z',
            intention: 'Respecter mon plan aujourd’hui.',
          }),
          checkin({
            slot: 'morning',
            submittedAt: '2026-05-03T07:00:00.000Z',
            intention: 'Rester patient, ne pas forcer.',
          }),
          // evening slot carries an intention → excluded (MATIN-only path).
          checkin({
            slot: 'evening',
            submittedAt: '2026-05-04T20:00:00.000Z',
            intention: 'Intention du soir ignorée.',
          }),
          // morning but blank → skipped.
          checkin({ slot: 'morning', submittedAt: '2026-05-02T07:00:00.000Z', intention: '   ' }),
          // morning but null → skipped.
          checkin({ slot: 'morning', submittedAt: '2026-05-05T07:00:00.000Z', intention: null }),
        ],
      }),
    );
    expect(snap.morningIntentions).toEqual([
      'Rester patient, ne pas forcer.',
      'Respecter mon plan aujourd’hui.',
    ]);
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

// =============================================================================
// TASK E — Douglas-card usefulness breakdown by category (count-only)
// =============================================================================

function delivery(over: Record<string, unknown> = {}): MonthlyBuilderInput['deliveries'][number] {
  return {
    id: 'd-cuid',
    userId: 'u',
    cardId: 'c',
    cardSlug: 'slug',
    cardTitle: 'Title',
    cardCategory: 'discipline',
    triggeredBy: 'system',
    triggeredOn: '2026-05-10',
    seenAt: '2026-05-10T08:00:00.000Z',
    dismissedAt: null,
    helpful: null,
    createdAt: '2026-05-10T08:00:00.000Z',
    ...over,
  } as unknown as MonthlyBuilderInput['deliveries'][number];
}

describe('buildMonthlySnapshot — helpfulByCategory (TASK E, count-only)', () => {
  it('empty month → empty breakdown', () => {
    expect(buildMonthlySnapshot(baseInput()).helpfulByCategory).toEqual([]);
  });

  it('folds helpful/seen per category over SEEN cards only, sorted by seen desc', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        deliveries: [
          delivery({ cardCategory: 'discipline', helpful: true }),
          delivery({ cardCategory: 'discipline', helpful: true }),
          delivery({ cardCategory: 'discipline', helpful: false }),
          delivery({ cardCategory: 'ego', helpful: false }),
          delivery({ cardCategory: 'ego', helpful: null }),
          // NOT seen → excluded from the breakdown entirely.
          delivery({ cardCategory: 'fear', seenAt: null, helpful: true }),
        ],
      }),
    );
    expect(snap.helpfulByCategory).toEqual([
      { category: 'discipline', helpful: 2, seen: 3 },
      { category: 'ego', helpful: 0, seen: 2 },
    ]);
    expect(snap.helpfulByCategory.find((c) => c.category === 'fear')).toBeUndefined();
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

// =============================================================================
// TASK B — onboarding profile reference (relay + re-harden, never edge)
// =============================================================================

describe('buildMonthlySnapshot — memberProfile (TASK B reference, never scoring)', () => {
  it('null profile → null memberProfile (prompt omits the section)', () => {
    expect(buildMonthlySnapshot(baseInput()).memberProfile).toBeNull();
  });

  it('relays the truncated profile + re-hardens free-text via safeFreeText', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        memberProfile: {
          summary: 'Trader rigoureux, sujet au FOMO en fin de session.',
          axesPrioritaires: ['Tenir mon plan', 'Réduire le FOMO'],
          highlightLabels: ['Discipline matinale', 'Tendance au revenge-trade'],
        },
      }),
    );
    expect(snap.memberProfile).toEqual({
      summary: 'Trader rigoureux, sujet au FOMO en fin de session.',
      axesPrioritaires: ['Tenir mon plan', 'Réduire le FOMO'],
      highlightLabels: ['Discipline matinale', 'Tendance au revenge-trade'],
      // D1 — the tone enums default to null when the profile carries none.
      coachingRegister: null,
      learningStage: null,
    });
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('D1 — relays the coaching register + learning stage enums verbatim (never scoring)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        memberProfile: {
          summary: 'Trader introspectif.',
          axesPrioritaires: ['Tenir mon plan'],
          highlightLabels: [],
          coachingRegister: 'socratique',
          learningStage: 'intuitive',
        },
      }),
    );
    expect(snap.memberProfile!.coachingRegister).toBe('socratique');
    expect(snap.memberProfile!.learningStage).toBe('intuitive');
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('strips bidi/zero-width from profile free-text (Trojan Source defense-in-depth)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        memberProfile: {
          summary: 'Profil‮ inversé.',
          axesPrioritaires: ['axe​ caché'],
          highlightLabels: [],
        },
      }),
    );
    expect(snap.memberProfile!.summary).not.toContain('‮');
    expect(snap.memberProfile!.axesPrioritaires[0]).not.toContain('​');
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

describe('DOD3-01 / DoD#2 S6 — Session-3 verification counters', () => {
  it('relays the verification slice verbatim into the snapshot (schema-valid)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        verification: {
          constancy: { value: 78.5, honesty: 85, regularity: 90, discipline: 60 },
          constancyPrevious: { value: 70, honesty: 75, regularity: 88, discipline: 55 },
          openDiscrepancyCount: 2,
          alertCount: 1,
        },
      }),
    );
    expect(snap.verification).toEqual({
      constancy: { value: 78.5, honesty: 85, regularity: 90, discipline: 60 },
      constancyPrevious: { value: 70, honesty: 75, regularity: 88, discipline: 55 },
      openDiscrepancyCount: 2,
      alertCount: 1,
    });
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('accepts a null constancy (no signal — never a fake neutral score, §33.6)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        verification: {
          constancy: null,
          constancyPrevious: null,
          openDiscrepancyCount: 0,
          alertCount: 0,
        },
      }),
    );
    expect(snap.verification.constancy).toBeNull();
    expect(monthlySnapshotSchema.safeParse(snap).success).toBe(true);
  });
});
