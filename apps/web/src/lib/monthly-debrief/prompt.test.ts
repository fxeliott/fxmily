/**
 * Vitest for the monthly-debrief PROMPT rendering (SPEC §25 Phase C).
 *
 * Carbon of weekly-report/prompt.test.ts. Closes the S2 challenge-#4 audit
 * finding L4-01 for the monthly path: `buildMonthlyDebriefUserPrompt` injects
 * the §28/§21 process/habit axes into the autonomous Claude monthly debrief,
 * but no test proved they reach the prompt text. A typo / omitted line in
 * monthly-debrief/prompt.ts would ship green and silently starve DoD#3
 * ("données exploitables par les analyses autonomes de Claude").
 */

import { describe, expect, it } from 'vitest';

import { buildMonthlySnapshot } from './builder';
import { buildMonthlyDebriefUserPrompt } from './prompt';
import type { MonthlyBuilderInput } from './types';

const LABEL = 'member-A1B2C3D4';

function baseInput(over: Partial<MonthlyBuilderInput> = {}): MonthlyBuilderInput {
  return {
    pseudonymLabel: LABEL,
    timezone: 'Europe/Paris',
    monthStart: new Date('2026-04-30T22:00:00.000Z'),
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

function populatedSnapshot() {
  return buildMonthlySnapshot(
    baseInput({
      // processCompleteRate 1 true / 2 answered = 50 %.
      trades: [trade({ processComplete: true }), trade({ processComplete: false })],
      checkins: [
        checkin({ slot: 'morning', marketAnalysisDone: true, morningRoutineCompleted: true }),
        checkin({ slot: 'morning', marketAnalysisDone: false, morningRoutineCompleted: null }),
        checkin({ slot: 'evening', formationFollowed: true }),
        checkin({ slot: 'evening', formationFollowed: false }),
      ],
      meetingScheduledCount: 5,
      meetingCompletedCount: 4,
    }),
  );
}

describe('buildMonthlyDebriefUserPrompt — §28 process/habit axes reach the prompt (DoD#3)', () => {
  it('renders the axis section header (count-only, l’acte jamais le P&L)', () => {
    const prompt = buildMonthlyDebriefUserPrompt(populatedSnapshot());
    expect(prompt).toContain(
      "- Axes process & habitudes (Session-2 — discipline/engagement, l'acte jamais le P&L) :",
    );
  });

  it('renders the four rate axes with computed percentages on one line', () => {
    const prompt = buildMonthlyDebriefUserPrompt(populatedSnapshot());
    // marketAnalysisDone 1/2=50%, morningRoutineCompleted 1/1=100%, formation 1/2=50%, process 1/2=50%.
    expect(prompt).toMatch(/Process complété \("oublis"\) : 50% des trades clôturés renseignés/);
    expect(prompt).toMatch(/Analyse marché faite : 50% des matins renseignés/);
    expect(prompt).toMatch(/Routine matinale : 100% des matins renseignés/);
    expect(prompt).toMatch(/Formation suivie : 50% des soirs renseignés/);
  });

  it('renders meeting attendance completed/scheduled + rate when meetings exist', () => {
    const prompt = buildMonthlyDebriefUserPrompt(populatedSnapshot());
    expect(prompt).toContain('Assiduité réunions : 4/5 validées (80%)');
  });

  it('renders "n/a" + the no-meeting branch when the month has no data (no fake 0 %)', () => {
    const prompt = buildMonthlyDebriefUserPrompt(buildMonthlySnapshot(baseInput()));
    expect(prompt).toMatch(/Process complété \("oublis"\) : n\/a des trades clôturés renseignés/);
    expect(prompt).toContain('aucune réunion programmée ce mois');
    expect(prompt).not.toMatch(/Assiduité réunions : 0\/0/);
  });

  it('distinguishes a real 0 % (all answered false) from null (unanswered)', () => {
    const prompt = buildMonthlyDebriefUserPrompt(
      buildMonthlySnapshot(
        baseInput({
          trades: [trade({ processComplete: false }), trade({ processComplete: false })],
        }),
      ),
    );
    expect(prompt).toMatch(/Process complété \("oublis"\) : 0% des trades clôturés renseignés/);
  });
});
