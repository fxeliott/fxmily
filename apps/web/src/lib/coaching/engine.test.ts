import { describe, expect, it } from 'vitest';

import type { DimensionMomentum } from '@/lib/scoring/momentum';
import type { ConstancyScoreView } from '@/lib/verification/constancy';
import type { DominantSignal } from '@/lib/verification/dominant-signals';

import {
  buildCoachingInsight,
  buildCoachingReportContext,
  renderCoachingContextSection,
  type CoachingInsight,
  type CoachingInsightInput,
} from './engine';
import type { MentalMapEntry } from './mental-map';
import type { MicroObjectiveProgress } from './micro-objective';

/** Aucun terme d'analyse de marché ne doit jamais traverser le moteur (§2/§33.2). */
const MARKET_TERMS =
  /\b(setup|achat|vente|buy|sell|long|short|pip|lots?|support|résistance|tendance|bougie|chandelier|take[- ]?profit|stop[- ]?loss|entr[ée]e|sortie|P&L|pnl)\b/i;

function entry(over: Partial<MentalMapEntry> = {}): MentalMapEntry {
  return {
    id: 'alert:a1',
    observation: 'Plusieurs journées sans suivi, sans motif (×3).',
    meaning: 'Ne pas regarder son propre travail, c’est souvent éviter une vérité inconfortable.',
    action: 'Ce soir, remplis ton bilan — même en une seule ligne.',
    axis: 'discipline',
    tone: 'alert',
    source: { kind: 'alert', alertId: 'a1', triggerType: 'forgot_no_reason_repeat' },
    ...over,
  };
}

function progress(over: Partial<MicroObjectiveProgress> = {}): MicroObjectiveProgress {
  return { open: 0, kept: 0, missed: 0, dismissed: 0, resolved: 0, keptRate: null, ...over };
}

function constancy(over: Partial<ConstancyScoreView> = {}): ConstancyScoreView {
  return {
    value: 72,
    breakdown: { honesty: 80, regularity: 65, discipline: 70 },
    periodStart: new Date('2026-06-01T00:00:00Z'),
    computedAt: new Date('2026-06-20T00:00:00Z'),
    ...over,
  };
}

function momentum(over: Partial<DimensionMomentum> = {}): DimensionMomentum {
  return { dimension: 'discipline', label: 'Discipline', weeklySlope: -1.2, points: 8, ...over };
}

function signal(over: Partial<DominantSignal> = {}): DominantSignal {
  return { reason: 'filled', direction: 'up', count: 5, ...over };
}

function input(over: Partial<CoachingInsightInput> = {}): CoachingInsightInput {
  return {
    mentalMap: [entry()],
    microProgress: progress(),
    constancy: null,
    dominantSignals: [],
    momentum: [],
    ...over,
  };
}

describe('buildCoachingInsight — moteur PUR (S5 §32-C)', () => {
  it('renvoie null sur une carte mentale vide (jamais un insight fabriqué)', () => {
    expect(buildCoachingInsight(input({ mentalMap: [] }))).toBeNull();
  });

  it('dérive cause → effet → prochain pas de l’entrée PRIORITAIRE (tête de carte)', () => {
    const result = buildCoachingInsight(
      input({
        mentalMap: [
          entry({ id: 'alert:a1', observation: 'OBS-PRIORITAIRE', action: 'GESTE-PRIORITAIRE' }),
          entry({ id: 'signal:x', observation: 'OBS-SECONDAIRE', tone: 'watch' }),
        ],
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.observation).toBe('OBS-PRIORITAIRE');
    expect(result?.nextStep).toBe('GESTE-PRIORITAIRE');
    expect(result?.axis).toBe('discipline');
    expect(result?.tone).toBe('alert');
    expect(result?.headline).toContain('discipline');
  });

  it('la headline suit l’axe de l’entrée dominante', () => {
    const honesty = buildCoachingInsight(input({ mentalMap: [entry({ axis: 'honesty' })] }));
    expect(honesty?.headline).toMatch(/honnêteté/i);
  });

  it('progression #1 — taux de micro-objectifs tenus quand des boucles sont refermées', () => {
    const result = buildCoachingInsight(
      input({ microProgress: progress({ kept: 3, missed: 1, resolved: 4, keptRate: 75 }) }),
    );
    expect(result?.progression).not.toBeNull();
    expect(result?.progression?.label).toBe('Micro-objectifs tenus');
    expect(result?.progression?.value).toBe(75);
    expect(result?.progression?.unit).toBe('%');
    expect(result?.progression?.detail).toBe('3 tenus sur 4 refermés');
  });

  it('progression #2 — retombe sur la constance quand aucune boucle refermée', () => {
    const result = buildCoachingInsight(input({ constancy: constancy({ value: 68 }) }));
    expect(result?.progression?.label).toBe('Constance');
    expect(result?.progression?.value).toBe(68);
    expect(result?.progression?.unit).toBe('/100');
    expect(result?.progression?.detail).toContain('honnêteté 80');
  });

  it('progression null quand il n’y a ni boucle refermée ni constance', () => {
    expect(buildCoachingInsight(input())?.progression).toBeNull();
  });

  it('tendance « down » quand un déclin comportemental soutenu touche l’axe', () => {
    const result = buildCoachingInsight(
      input({
        constancy: constancy(),
        momentum: [momentum({ dimension: 'discipline' })],
      }),
    );
    expect(result?.progression?.trend).toBe('down');
  });

  it('tendance « up » quand la présence au suivi monte ET aucun déclin', () => {
    const result = buildCoachingInsight(
      input({
        constancy: constancy(),
        dominantSignals: [signal({ reason: 'filled', direction: 'up' })],
        momentum: [],
      }),
    );
    expect(result?.progression?.trend).toBe('up');
  });

  it('tendance null quand un déclin existe mais sur une AUTRE dimension', () => {
    const result = buildCoachingInsight(
      input({
        mentalMap: [entry({ axis: 'discipline' })],
        constancy: constancy(),
        momentum: [momentum({ dimension: 'consistency', label: 'Régularité' })],
      }),
    );
    expect(result?.progression?.trend).toBeNull();
  });

  it('basis trace les signaux RÉELS (origine + constance + boucles), plafonné à 3', () => {
    const result = buildCoachingInsight(
      input({
        mentalMap: [entry()],
        constancy: constancy({ value: 72 }),
        microProgress: progress({ kept: 2, missed: 0, resolved: 2 }),
        momentum: [momentum({ label: 'Discipline' })],
      }),
    );
    expect(result?.basis.length).toBeLessThanOrEqual(3);
    expect(result?.basis[0]).toContain('Alerte');
    expect(result?.basis).toContain('Constance 72/100');
    expect(result?.basis.some((b) => b.includes('boucle'))).toBe(true);
  });

  it('GARDE-FOU §2 — aucun terme de marché dans l’insight produit', () => {
    const result = buildCoachingInsight(
      input({
        constancy: constancy(),
        microProgress: progress({ kept: 1, missed: 1, resolved: 2, keptRate: 50 }),
        momentum: [momentum()],
        dominantSignals: [signal()],
      }),
    ) as CoachingInsight;
    const blob = [
      result.headline,
      result.observation,
      result.meaning,
      result.nextStep,
      result.progression?.label ?? '',
      result.progression?.detail ?? '',
      ...result.basis,
    ].join(' · ');
    expect(blob).not.toMatch(MARKET_TERMS);
  });
});

describe('buildCoachingInsight — alignement profil S2 (S5 §32-C)', () => {
  it('trace l’alignement quand l’axe dominant ∈ priorités du membre', () => {
    const result = buildCoachingInsight(
      input({ mentalMap: [entry({ axis: 'discipline' })], priorityAxes: ['discipline'] }),
    );
    expect(result?.basis).toContain('En lien avec une priorité que tu t’es fixée');
    // L'origine (traçabilité E2/B) reste en tête, jamais sacrifiée par l'alignement.
    expect(result?.basis[0]).toContain('Alerte');
  });

  it('n’ajoute aucune trace quand l’axe dominant n’est pas une priorité', () => {
    const result = buildCoachingInsight(
      input({ mentalMap: [entry({ axis: 'discipline' })], priorityAxes: ['honesty'] }),
    );
    expect(result?.basis.some((b) => b.includes('priorité que tu t’es fixée'))).toBe(false);
  });

  it('reste rétro-compatible sans priorityAxes (aucune trace ajoutée)', () => {
    const result = buildCoachingInsight(input({ mentalMap: [entry()] }));
    expect(result?.basis.some((b) => b.includes('priorité que tu t’es fixée'))).toBe(false);
  });

  it('§50/§2 — la trace est une copie FIGÉE, jamais le texte libre de l’axe du membre', () => {
    const result = buildCoachingInsight(
      input({
        mentalMap: [entry({ axis: 'discipline' })],
        // Le texte libre du profil n'arrive JAMAIS jusqu'ici : seul l'enum d'axe.
        priorityAxes: ['discipline'],
      }),
    ) as CoachingInsight;
    const align = result.basis.filter((b) => b.includes('priorité'));
    expect(align).toEqual(['En lien avec une priorité que tu t’es fixée']);
    expect(result.basis.join(' · ')).not.toMatch(MARKET_TERMS);
  });
});

describe('buildCoachingReportContext — contexte rapport S6 (S5 §32-D)', () => {
  it('renvoie null sans insight (rien à transmettre)', () => {
    expect(
      buildCoachingReportContext({ insight: null, openObjective: null, microProgress: progress() }),
    ).toBeNull();
  });

  it('compose l’insight + l’objectif ouvert + les issues refermées de la période', () => {
    const insight = buildCoachingInsight(input({ constancy: constancy() })) as CoachingInsight;
    const ctx = buildCoachingReportContext({
      insight,
      openObjective: { axis: 'discipline', title: 'Tenir ta routine, un jour à la fois' },
      microProgress: progress({ kept: 2, missed: 1, dismissed: 1 }),
    });
    expect(ctx?.insight).toBe(insight);
    expect(ctx?.openObjective?.title).toContain('routine');
    expect(ctx?.closedOutcomes).toEqual({ kept: 2, missed: 1, dismissed: 1 });
  });
});

describe('renderCoachingContextSection — bloc Markdown injecté dans S6', () => {
  function ctx() {
    const insight = buildCoachingInsight(
      input({
        constancy: constancy(),
        microProgress: progress({ kept: 3, missed: 1, resolved: 4, keptRate: 75 }),
      }),
    ) as CoachingInsight;
    return buildCoachingReportContext({
      insight,
      openObjective: { axis: 'discipline', title: 'Tenir ta routine, un jour à la fois' },
      microProgress: progress({ kept: 3, missed: 1, dismissed: 0 }),
    })!;
  }

  it('structure le signal en process/mental avec axe, observé, sens, prochain pas', () => {
    const md = renderCoachingContextSection(ctx());
    expect(md).toContain('## Signal de coaching psychologique');
    expect(md).toContain('process / mental UNIQUEMENT');
    expect(md).toMatch(/- Axe dominant : discipline/);
    expect(md).toContain('- Observé :');
    expect(md).toContain('- Sens (lecture Mark Douglas) :');
    expect(md).toContain('- Prochain pas proposé :');
  });

  it('inclut la progression mesurée, l’objectif en cours et les boucles refermées', () => {
    const md = renderCoachingContextSection(ctx());
    expect(md).toContain(
      '- Progression mesurée : Micro-objectifs tenus — 75% (3 tenus sur 4 refermés)',
    );
    expect(md).toContain('- Micro-objectif mental en cours : Tenir ta routine');
    expect(md).toMatch(/3 tenue\(s\), 1 manquée\(s\), 0 écartée\(s\)/);
  });

  it('verrouille la posture (intègre calmement, jamais conseil marché ni reproche)', () => {
    const md = renderCoachingContextSection(ctx());
    expect(md).toContain('Rappel posture');
    expect(md).toMatch(/jamais un conseil de marché/i);
    expect(md).toMatch(/jamais un reproche/i);
    expect(md).not.toMatch(MARKET_TERMS);
  });
});
