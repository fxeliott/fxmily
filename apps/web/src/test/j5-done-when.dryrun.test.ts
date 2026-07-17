import { describe, expect, it } from 'vitest';

import { monthlyDebriefOutputSchema } from '@/lib/schemas/monthly-debrief';
import { weeklyReportOutputSchema } from '@/lib/schemas/weekly-report';
import { buildMonthlySnapshot } from '@/lib/monthly-debrief/builder';
import { buildMonthlyDebriefUserPrompt } from '@/lib/monthly-debrief/prompt';
import type { MonthlyBuilderInput } from '@/lib/monthly-debrief/types';
import { MockWeeklyReportClient } from '@/lib/weekly-report/claude-client';
import { buildWeeklySnapshot } from '@/lib/weekly-report/builder';
import { buildWeeklyReportUserPrompt } from '@/lib/weekly-report/prompt';
import type { BuilderInput } from '@/lib/weekly-report/types';

// ---------------------------------------------------------------------------
// J5 done-when (handoff item 13) — one integration dry-run proving the AI
// prompts compose ALL wired signals (ABCD + TRACK + objectifs + N-1 + weekly
// review >300 chars) and the offline worker still produces a schema-valid JSON.
// Throwaway (not committed): the per-feature commits already lock each marker;
// this run is the composition proof captured as [tool-output].
// ---------------------------------------------------------------------------

const WEEK_START = new Date('2026-05-04T00:00:00Z'); // Monday
const WEEK_END = new Date('2026-05-10T23:59:59Z'); // Sunday
const LABEL = 'Membre-A';

// A member weekly-review answer well over the old 300-char cap (J5.3 → 2000).
const LONG_WIN =
  'RESPECT_DU_PLAN ' +
  'j ai respecte mon plan de trading sans forcer une seule entree hors zone '.repeat(6);

function weeklyInput(): BuilderInput {
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
    verification: { constancy: null, openDiscrepancyCount: 0, alertCount: 0 },
    // J5.1 ABCD
    reflections: [
      {
        date: '2026-05-06',
        triggerEvent: 'Trade perdant sur EURUSD',
        beliefAuto: 'Je dois me refaire tout de suite',
        consequence: 'Revenge-trade impulsif',
        disputation: 'Une perte suit mon plan ; je respecte mon risque',
      },
    ],
    // J5.2 TRACK (pillars already aggregated by the loader)
    habits: [{ kind: 'sleep', daysLogged: 2, average: 7.5, unit: 'h' }],
    // J5.7 objectives
    objectives: {
      rings: [{ label: 'Discipline', current: 60, target: 80, reached: false }],
      coachingAxis: 'Tenir le plan sur les 3 premieres sessions',
      methodGoal: { label: 'Backtests', hint: '3 par semaine', current: 1, target: 3 },
    },
    // J5.8 favorites
    favorites: [{ title: 'Trading in the Zone — probabilistes', category: 'mindset' }],
    // J5.3 member weekly review >300 chars
    memberWeeklyReview: {
      biggestWin: LONG_WIN,
      biggestMistake: 'Une entree hors zone lundi',
      bestPractice: 'Checklist avant chaque entree',
      lessonLearned: 'La patience paie',
      nextWeekFocus: 'Zero entree hors plan',
    },
  };
}

function monthlyInput(over: Partial<MonthlyBuilderInput> = {}): MonthlyBuilderInput {
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
    coachCorrections: [],
    memberScreenNotes: [],
    latestScore: null,
    scoreHistory: [],
    monthStartLocal: '2026-05-01',
    weeklySummaries: [],
    memberProfile: null,
    training: { backtestCount: 0, daysSinceLastBacktest: null, hasEverPractised: false },
    verification: {
      constancy: null,
      constancyPrevious: null,
      openDiscrepancyCount: 0,
      alertCount: 0,
    },
    ...over,
  };
}

describe('J5 done-when — weekly prompt composes every wired signal', () => {
  const snapshot = buildWeeklySnapshot(weeklyInput());
  const prompt = buildWeeklyReportUserPrompt(snapshot);

  it('contient la section ABCD (J5.1)', () => {
    expect(prompt).toContain('Réflexions ABCD du membre');
  });
  it('contient la section TRACK / hygiene de vie (J5.2)', () => {
    expect(prompt).toContain('Hygiène de vie du membre (piliers TRACK');
    expect(prompt).toContain('Sommeil : 7.5 h en moyenne sur 2 jour(s) loggé(s)');
  });
  it('contient la section objectifs de process (J5.7)', () => {
    expect(prompt).toContain('Objectifs de process du membre');
  });
  it('contient les favoris Mark Douglas (J5.8)', () => {
    expect(prompt).toContain('Fiches Mark Douglas favorites du membre');
  });
  it('rend la revue hebdo membre au-dela de 300 chars (J5.3)', () => {
    // >300 chars carried in-prompt (old cap 300 truncated mid-sentence).
    expect(LONG_WIN.length).toBeGreaterThan(300);
    expect(prompt).toContain('RESPECT_DU_PLAN');
    // Robust substring (schema .trim() strips LONG_WIN's trailing space).
    expect(prompt).toContain(
      'j ai respecte mon plan de trading sans forcer une seule entree hors zone',
    );
  });
});

describe('J5 done-when — dry-run worker produces a schema-valid JSON ($0, no API)', () => {
  it('MockWeeklyReportClient.generate -> mocked + weeklyReportOutputSchema OK', async () => {
    const snapshot = buildWeeklySnapshot(weeklyInput());
    const gen = await new MockWeeklyReportClient().generate(snapshot);
    expect(gen.mocked).toBe(true); // no Anthropic API call = no quota, no money
    expect(weeklyReportOutputSchema.safeParse(gen.output).success).toBe(true);
  });
});

describe('J5 done-when — monthly prompt composes N-1 + every wired signal', () => {
  const snapshot = buildMonthlySnapshot(
    monthlyInput({
      previousDebrief: {
        monthStart: new Date('2026-03-31T22:00:00.000Z'), // Paris 2026-04-01
        summaryReal: 'Mois N-1 : discipline en hausse, sizing encore irregulier.',
        recommendations: ['Fixer le risque a 1% par trade', 'Journaliser chaque entree'],
      },
      reflections: [
        {
          date: '2026-05-06',
          triggerEvent: 'Trade perdant',
          beliefAuto: 'Je dois me refaire',
          consequence: 'Revenge-trade',
          disputation: 'Je respecte mon risque',
        },
      ],
      habits: [{ kind: 'sleep', daysLogged: 2, average: 7.5, unit: 'h' }],
      objectives: {
        rings: [{ label: 'Discipline', current: 60, target: 80, reached: false }],
        coachingAxis: 'Tenir le plan',
        methodGoal: { label: 'Backtests', hint: '3/sem', current: 1, target: 3 },
      },
      favorites: [{ title: 'Trading in the Zone', category: 'mindset' }],
    }),
  );
  const prompt = buildMonthlyDebriefUserPrompt(snapshot);

  it('contient le contexte N-1 (J5.4)', () => {
    expect(prompt).toContain('Contexte du mois precedent (N-1');
  });
  it('contient ABCD + TRACK + objectifs (J5.1 / J5.2 / J5.7)', () => {
    expect(prompt).toContain('Réflexions ABCD récentes');
    expect(prompt).toContain('Hygiène de vie du membre (piliers TRACK');
    expect(prompt).toContain('Objectifs de process du membre');
  });
});

describe('J5 done-when — retrocompat: no signals => sections omitted (byte-safe)', () => {
  it('weekly sans signaux: aucune section J5', () => {
    const p = buildWeeklyReportUserPrompt(
      buildWeeklySnapshot({
        userId: 'u',
        timezone: 'Europe/Paris',
        weekStart: WEEK_START,
        weekEnd: WEEK_END,
        trades: [],
        checkins: [],
        deliveries: [],
        annotationsReceived: 0,
        annotationsViewed: 0,
        latestScore: null,
        verification: { constancy: null, openDiscrepancyCount: 0, alertCount: 0 },
      }),
    );
    expect(p).not.toContain('Réflexions ABCD du membre');
    expect(p).not.toContain('Hygiène de vie du membre');
    expect(p).not.toContain('Objectifs de process du membre');
  });
  it('monthly sans signaux: pas de contexte N-1', () => {
    const p = buildMonthlyDebriefUserPrompt(buildMonthlySnapshot(monthlyInput()));
    expect(p).not.toContain('Contexte du mois precedent');
  });
  it('monthlyDebriefOutputSchema rejette un objet vide (persist gate)', () => {
    expect(monthlyDebriefOutputSchema.safeParse({}).success).toBe(false);
  });
});
