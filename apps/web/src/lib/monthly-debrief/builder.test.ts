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
    weeklySummaries: [],
    training: { backtestCount: 0, daysSinceLastBacktest: null, hasEverPractised: false },
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
