/**
 * Vitest for the J8 weekly-report PROMPT rendering (Phase C).
 *
 * The builder is already covered by builder.test.ts (the §28 axes are COMPUTED
 * correctly). This file closes the complementary gap surfaced by the S2
 * challenge-#4 audit (L4-01): the snapshot → user-prompt rendering
 * (`buildWeeklyReportUserPrompt`) was entirely untested, so a typo / omitted
 * `lines.push` / swapped counter in prompt.ts would ship green and silently
 * starve the autonomous Claude analysis of the §28 axis signals — defeating
 * DoD#3 ("données immédiatement consommables par les analyses autonomes de
 * Claude"). These tests prove the §28/§21 named axes actually REACH the prompt
 * text, in both the numeric and the null / 0-scheduled branches.
 */

import { describe, expect, it } from 'vitest';

import type { SerializedCheckin } from '@/lib/checkin/service';
import type { SerializedTrade } from '@/lib/trades/service';

import { buildWeeklySnapshot } from './builder';
import { buildWeeklyReportUserPrompt } from './prompt';
import type { BuilderInput } from './types';

const WEEK_START = new Date('2026-05-04T00:00:00Z'); // Monday
const WEEK_END = new Date('2026-05-10T23:59:59Z'); // Sunday

function emptyInput(): BuilderInput {
  return {
    userId: 'user_prompt_test',
    timezone: 'Europe/Paris',
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
    trades: [],
    checkins: [],
    deliveries: [],
    annotationsReceived: 0,
    annotationsViewed: 0,
    latestScore: null,
  };
}

// D3-01 — the builder reads `trade.tags` (post-outcome bias tags), which the
// shared `SerializedTrade` view does not surface; the loader serializes it
// inline so `BuilderInput['trades']` is `SerializedTrade & { tags: string[] }`.
type TradeFixture = SerializedTrade & { tags: string[] };

function makeTrade(partial: Partial<TradeFixture> = {}): TradeFixture {
  return {
    id: partial.id ?? 'trade_1',
    userId: 'user_prompt_test',
    pair: 'EURUSD',
    direction: 'long',
    session: 'london',
    enteredAt: '2026-05-05T08:00:00.000Z',
    entryPrice: '1.1000',
    lotSize: '0.10',
    stopLossPrice: '1.0950',
    plannedRR: '2',
    tradeQuality: null,
    riskPct: null,
    emotionBefore: ['calm'],
    planRespected: true,
    hedgeRespected: null,
    processComplete: null,
    notes: null,
    screenshotEntryKey: null,
    exitedAt: null,
    exitPrice: null,
    outcome: null,
    realizedR: null,
    realizedRSource: null,
    emotionDuring: [],
    emotionAfter: [],
    screenshotExitKey: null,
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
    ...partial,
  });
}

function makeCheckin(
  slot: 'morning' | 'evening',
  partial: Partial<SerializedCheckin> = {},
): SerializedCheckin {
  const base: SerializedCheckin = {
    id: partial.id ?? `c_${slot}`,
    userId: 'user_prompt_test',
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

/** Build a snapshot whose §28 axes are all populated with deterministic values. */
function populatedSnapshot() {
  const input = emptyInput();
  // processCompleteRate → 2 true / 3 answered closed trades = 67 %.
  input.trades = [
    closedTrade('win', 1, { id: 'p1', processComplete: true }),
    closedTrade('loss', -1, { id: 'p2', processComplete: true }),
    closedTrade('win', 1, { id: 'p3', processComplete: false }),
    closedTrade('break_even', 0, { id: 'p4', processComplete: null }),
  ];
  // mornings: marketAnalysisDone 2/3 = 67 %, morningRoutineCompleted 1/2 = 50 %.
  // evenings: formationFollowed 1/2 = 50 %.
  input.checkins = [
    makeCheckin('morning', {
      id: 'm1',
      date: '2026-05-04',
      marketAnalysisDone: true,
      morningRoutineCompleted: true,
    }),
    makeCheckin('morning', {
      id: 'm2',
      date: '2026-05-05',
      marketAnalysisDone: true,
      morningRoutineCompleted: false,
    }),
    makeCheckin('morning', {
      id: 'm3',
      date: '2026-05-06',
      marketAnalysisDone: false,
      morningRoutineCompleted: null,
    }),
    makeCheckin('evening', { id: 'e1', date: '2026-05-04', formationFollowed: true }),
    makeCheckin('evening', { id: 'e2', date: '2026-05-05', formationFollowed: false }),
  ];
  input.meetingScheduledCount = 4;
  input.meetingCompletedCount = 3;
  return buildWeeklySnapshot(input);
}

describe('buildWeeklyReportUserPrompt — §28 process/habit axes reach the prompt (DoD#3)', () => {
  it('renders the dedicated axis section heading', () => {
    const prompt = buildWeeklyReportUserPrompt(populatedSnapshot());
    expect(prompt).toContain(
      '## Axes process & habitudes (Session-2 — signaux discipline/engagement)',
    );
  });

  it('renders each of the four rate axes with its computed percentage', () => {
    const prompt = buildWeeklyReportUserPrompt(populatedSnapshot());
    // processCompleteRate 2/3 → 67 % ; marketAnalysisDoneRate 2/3 → 67 %.
    expect(prompt).toMatch(/Process complété \("oublis"\) : 67% des trades clôturés/);
    expect(prompt).toMatch(/Analyse de marché faite : 67% des matins renseignés/);
    expect(prompt).toMatch(/Routine matinale complétée : 50% des matins renseignés/);
    expect(prompt).toMatch(/Formation suivie : 50% des soirs renseignés/);
  });

  it('renders meeting attendance with completed/scheduled + rate when meetings were scheduled', () => {
    const prompt = buildWeeklyReportUserPrompt(populatedSnapshot());
    expect(prompt).toContain('Assiduité réunions : 3/4 réunions validées (75%)');
  });

  it('renders "n/a" for unanswered axes and the no-meeting branch (no fake 0 %)', () => {
    // Empty window → all rates null, 0 meetings scheduled.
    const prompt = buildWeeklyReportUserPrompt(buildWeeklySnapshot(emptyInput()));
    expect(prompt).toContain('Process complété ("oublis") : n/a');
    expect(prompt).toContain('Formation suivie : n/a');
    expect(prompt).toContain('aucune réunion programmée dans la fenêtre');
    // The honesty doctrine: never a fabricated "0 %" when there is no data.
    expect(prompt).not.toMatch(/Assiduité réunions : 0\/0/);
  });

  it('distinguishes a real 0 % (all answered false) from null (unanswered)', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('loss', -1, { id: 'z1', processComplete: false }),
      closedTrade('loss', -1, { id: 'z2', processComplete: false }),
    ];
    const prompt = buildWeeklyReportUserPrompt(buildWeeklySnapshot(input));
    // 0 true / 2 answered → a genuine 0 %, NOT "n/a".
    expect(prompt).toMatch(/Process complété \("oublis"\) : 0% des trades clôturés/);
  });
});

describe('buildWeeklyReportUserPrompt — behaviorTags + R reliability reach Claude (S5 Jalon C)', () => {
  it('declared bias tags (revenge-trade×2, loss-aversion×1) appear in the prompt', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1.5, { id: 'b1', tags: ['revenge-trade', 'loss-aversion'] }),
      closedTrade('loss', -1, { id: 'b2', tags: ['revenge-trade'] }),
    ];
    const prompt = buildWeeklyReportUserPrompt(buildWeeklySnapshot(input));
    expect(prompt).toContain('Biais comportementaux déclarés');
    expect(prompt).toContain('revenge-trade×2');
    expect(prompt).toContain('loss-aversion×1');
  });

  it('no bias tags → the bias line renders "aucun" (never fabricates)', () => {
    const input = emptyInput();
    input.trades = [closedTrade('win', 1.5, { id: 'b3', tags: [] })];
    const prompt = buildWeeklyReportUserPrompt(buildWeeklySnapshot(input));
    expect(prompt).toContain('Biais comportementaux déclarés (auto-déclaration LESSOR) : aucun');
  });

  it('R reliability split (computed vs estimated) reaches the prompt', () => {
    const input = emptyInput();
    input.trades = [
      closedTrade('win', 1.5, { id: 'r1', realizedRSource: 'computed' }),
      closedTrade('win', 2.0, { id: 'r2', realizedRSource: 'computed' }),
      closedTrade('loss', -0.8, { id: 'r3', realizedRSource: 'estimated' }),
    ];
    const prompt = buildWeeklyReportUserPrompt(buildWeeklySnapshot(input));
    expect(prompt).toContain('Fiabilité du R agrégé : 2 calculé(s) / 1 estimé(s)');
  });
});
