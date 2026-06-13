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
    // DoD#3 / §29 — empty history + the local month-start anchor (Paris 2026-05-01).
    scoreHistory: [],
    monthStartLocal: '2026-05-01',
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
    // D3-01 — post-outcome bias tags (default empty; the aggregator reads them).
    tags: [],
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

// =============================================================================
// FIX C S5 — emotion tags reach the snapshot AND the prompt text
// =============================================================================

describe('buildMonthlyDebriefUserPrompt — emotionTags (FIX C S5 hardening)', () => {
  it('emotion tags (fomo×3, fear-loss×2) appear in the prompt text', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({
            emotionBefore: ['fomo', 'fear-loss'] as never,
            emotionDuring: ['fomo'] as never,
            emotionAfter: [] as never,
          }),
          trade({
            emotionBefore: ['fomo'],
            emotionDuring: ['fear-loss'] as never,
            emotionAfter: [] as never,
          }),
        ],
        checkins: [],
      }),
    );
    const prompt = buildMonthlyDebriefUserPrompt(snap);
    // fomo appears 3 times (before×2 + during×1)
    expect(prompt).toContain('fomo×3');
    // fear-loss: 1 from before + 1 from during = 2
    expect(prompt).toContain('fear-loss×2');
    // The line prefix must be present
    expect(prompt).toContain('Émotions dominantes (fréquence)');
  });

  it('no emotion tags → the emotion line is absent from the prompt', () => {
    const prompt = buildMonthlyDebriefUserPrompt(buildMonthlySnapshot(baseInput()));
    expect(prompt).not.toContain('Émotions dominantes (fréquence)');
  });
});

// =============================================================================
// DoD#3 / §29 — scoreProgression reaches the prompt (measurable progression)
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

describe('buildMonthlyDebriefUserPrompt — scoreProgression (DoD#3 / §29)', () => {
  it('renders the progression line with X→Y (Δ±Z) deltas when data is present', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        scoreHistory: [
          point('2026-05-01', {
            discipline: 60,
            emotionalStability: 55,
            consistency: 50,
            engagement: 45,
          }),
          point('2026-05-31', {
            discipline: 72,
            emotionalStability: 50,
            consistency: 61,
            engagement: 45,
          }),
        ],
      }),
    );
    const prompt = buildMonthlyDebriefUserPrompt(snap);
    expect(prompt).toContain('Progression du score (vs début de mois, base 2026-05-01)');
    expect(prompt).toContain('discipline 60→72 (Δ+12)');
    expect(prompt).toContain('stabilité émotionnelle 55→50 (Δ-5)');
    expect(prompt).toContain('constance 50→61 (Δ+11)');
    expect(prompt).toContain('engagement 45→45 (Δ+0)');
    expect(prompt).toContain('APPUIE le récit de progression sur ces deltas réels');
  });

  it('renders n/a for a dimension that was insufficient_data on an anchor (no fake Δ)', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        scoreHistory: [
          point('2026-05-01', { discipline: 60, consistency: null }),
          point('2026-05-31', { discipline: 70, emotionalStability: null, consistency: 55 }),
        ],
      }),
    );
    const prompt = buildMonthlyDebriefUserPrompt(snap);
    expect(prompt).toContain('discipline 60→70 (Δ+10)');
    // current emotionalStability n/a → no Δ
    expect(prompt).toContain('stabilité émotionnelle 50→n/a');
    // baseline consistency n/a → no Δ
    expect(prompt).toContain('constance n/a→55');
  });

  it('no baseline / empty history → the progression line is ABSENT (keeps the hedge)', () => {
    const prompt = buildMonthlyDebriefUserPrompt(buildMonthlySnapshot(baseInput()));
    expect(prompt).not.toContain('Progression du score');
    // the existing weekly hedge stays the fallback narrative cue.
    expect(prompt).toContain('base-toi sur les agrégats bruts ci-dessus');
  });
});

describe('buildMonthlyDebriefUserPrompt — behaviorTags + R reliability reach Claude (S5 Jalon C)', () => {
  it('declared bias tags (revenge-trade×2, loss-aversion×1) appear in the prompt', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({ tags: ['revenge-trade', 'loss-aversion'] }),
          trade({ tags: ['revenge-trade'] }),
        ],
        checkins: [],
      }),
    );
    const prompt = buildMonthlyDebriefUserPrompt(snap);
    expect(prompt).toContain('Biais comportementaux déclarés');
    expect(prompt).toContain('revenge-trade×2');
    expect(prompt).toContain('loss-aversion×1');
  });

  it('no bias tags → the bias line renders "aucun" (never fabricates)', () => {
    const snap = buildMonthlySnapshot(baseInput({ trades: [trade({ tags: [] })], checkins: [] }));
    const prompt = buildMonthlyDebriefUserPrompt(snap);
    expect(prompt).toContain('Biais comportementaux déclarés (auto-déclaration LESSOR) : aucun');
  });

  it('R reliability split (computed vs estimated) reaches the prompt', () => {
    const snap = buildMonthlySnapshot(
      baseInput({
        trades: [
          trade({ realizedR: '1.5', realizedRSource: 'computed' }),
          trade({ realizedR: '2.0', realizedRSource: 'computed' }),
          trade({ realizedR: '0.8', realizedRSource: 'estimated' }),
        ],
        checkins: [],
      }),
    );
    const prompt = buildMonthlyDebriefUserPrompt(snap);
    expect(prompt).toContain('Fiabilité du R agrégé : 2 calculé(s) / 1 estimé(s)');
  });
});
