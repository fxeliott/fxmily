import { describe, expect, it } from 'vitest';

import {
  ALL_METRICS,
  childMetrics,
  getMetric,
  METRIC_KEYS,
  metricsByAxis,
  type MetricAggregation,
  type MetricAxis,
  type MetricDef,
  type MetricType,
  type MetricUnit,
} from './registry';

/**
 * Le registre est un CONTRAT (SSOT). Ce test le verrouille : tout glissement
 * (clé dupliquée, poids qui ne somme plus à 100, règle de méthode perdue, axe de
 * constance déséquilibré, métrique qui parlerait du marché) casse le build. Il
 * ne re-teste PAS les calculs (ils ont leurs propres tests) — il teste que la
 * description centrale reste cohérente et fidèle.
 */

const VALID_TYPES: readonly MetricType[] = [
  'score',
  'rate',
  'ratio',
  'count',
  'currency',
  'duration',
  'correlation',
];
const VALID_AXES: readonly MetricAxis[] = [
  'discipline',
  'emotional_stability',
  'consistency',
  'engagement',
  'method',
  'honesty',
  'track_record',
];
const VALID_UNITS: readonly (MetricUnit | null)[] = [
  'pts',
  '%',
  'R',
  'count',
  'ratio',
  'coefficient',
  'h',
  '€',
  null,
];
const VALID_AGGREGATIONS: readonly MetricAggregation[] = [
  'weighted',
  'rate',
  'avg',
  'median',
  'sum',
  'last',
  'max',
  'min',
];

/** Les 4 dimensions comportementales et la somme de leurs poids de BASE = 100. */
const BEHAVIORAL_DIMENSIONS = [
  'discipline',
  'emotional_stability',
  'consistency',
  'engagement',
] as const;

describe('metrics registry — intégrité structurelle', () => {
  it('ne contient aucune clé dupliquée', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const key of METRIC_KEYS) {
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });

  it("n'expose que des types/axes/unités/agrégations valides", () => {
    for (const m of ALL_METRICS) {
      expect(VALID_TYPES, m.key).toContain(m.type);
      expect(VALID_AXES, m.key).toContain(m.axis);
      expect(VALID_UNITS, m.key).toContain(m.unit);
      expect(VALID_AGGREGATIONS, m.key).toContain(m.aggregation);
      expect(m.label.length, m.key).toBeGreaterThan(0);
      expect(m.hint.length, m.key).toBeGreaterThan(0);
      expect(m.source.length, m.key).toBeGreaterThan(0);
    }
  });

  it('namespace chaque sous-score par sa clé parente existante', () => {
    for (const m of ALL_METRICS) {
      if (m.parent === undefined) continue;
      expect(getMetric(m.parent), `${m.key} → parent ${m.parent}`).toBeDefined();
      // la clé enfant est préfixée par un namespace cohérent
      expect(m.key.includes('.'), m.key).toBe(true);
    }
  });
});

describe('metrics registry — invariant ADDITION PURE (poids)', () => {
  for (const dim of BEHAVIORAL_DIMENSIONS) {
    it(`${dim} : les sous-scores de BASE somment à 100`, () => {
      const base = childMetrics(dim).filter((m) => m.additive !== true);
      const sum = base.reduce((acc, m) => acc + (m.weight ?? 0), 0);
      expect(sum).toBe(100);
    });

    it(`${dim} : tout sous-score additif porte additive:true ET un poids > 0`, () => {
      const additive = childMetrics(dim).filter((m) => m.additive === true);
      for (const m of additive) {
        expect(m.weight ?? 0, m.key).toBeGreaterThan(0);
      }
    });
  }

  it('tout sous-score (parent défini) porte un poids strictement positif', () => {
    for (const m of ALL_METRICS) {
      if (m.parent === undefined) continue;
      expect(m.weight ?? 0, m.key).toBeGreaterThan(0);
    }
  });
});

describe('metrics registry — fidélité à la méthode (7 règles dures)', () => {
  it('contient exactement les 7 règles dures LIVE', () => {
    const liveRules = metricsByAxis('method')
      .filter((m) => m.status === 'live')
      .map((m) => m.key)
      .sort();
    expect(liveRules).toEqual(
      [
        'method.beAtR1',
        'method.cut',
        'method.oneADay',
        'method.partial',
        'method.slRule',
        'method.targetRR',
        'method.window',
      ].sort(),
    );
  });

  it('les axes-méthode non encore matérialisés sont marqués derivable/candidate_v2', () => {
    const nonLive = metricsByAxis('method').filter((m) => m.status !== 'live');
    expect(nonLive.length).toBeGreaterThan(0);
    for (const m of nonLive) {
      expect(['derivable', 'candidate_v2'], m.key).toContain(m.status);
    }
  });
});

describe('metrics registry — constance (honnêteté radicale)', () => {
  it('les 3 axes de constance somment à 1.0', () => {
    const parts = childMetrics('constancy.value');
    const sum = parts.reduce((acc, m) => acc + (m.weight ?? 0), 0);
    expect(sum).toBeCloseTo(1.0, 10);
    expect(parts.map((m) => m.key).sort()).toEqual(
      ['constancy.discipline', 'constancy.honesty', 'constancy.regularity'].sort(),
    );
  });
});

describe('metrics registry — isolation statistique entraînement (§21.5)', () => {
  it("ne flague trainingIsolated que sur l'axe engagement (comptes, jamais P&L)", () => {
    const isolated = ALL_METRICS.filter((m) => m.trainingIsolated === true);
    expect(isolated.length).toBeGreaterThan(0);
    for (const m of isolated) {
      expect(m.axis, m.key).toBe('engagement');
      expect(m.type, m.key).toBe('rate'); // un taux d'activité, pas une devise/un gain
    }
  });
});

describe('metrics registry — garde-fou §2 (aucun appel de marché)', () => {
  // Vocabulaire d'analyse de marché interdit dans une métrique de process.
  const FORBIDDEN = [
    'acheter',
    'vendre',
    'achète',
    'vends',
    'haussier',
    'baissier',
    'résistance',
    'support de prix',
    'niveau d’entrée conseillé',
    'cible de prix',
    'prédiction',
  ];
  it('aucun libellé/hint ne contient de vocabulaire de conseil directionnel', () => {
    for (const m of ALL_METRICS) {
      const haystack = `${m.label} ${m.hint}`.toLowerCase();
      for (const word of FORBIDDEN) {
        expect(haystack.includes(word.toLowerCase()), `${m.key} contient « ${word} »`).toBe(false);
      }
    }
  });
});

describe('metrics registry — helpers', () => {
  it('getMetric résout une clé connue et renvoie undefined sinon', () => {
    const d: MetricDef | undefined = getMetric('discipline');
    expect(d?.axis).toBe('discipline');
    expect(getMetric('inexistant.metric')).toBeUndefined();
  });

  it('metricsByAxis renvoie un sous-ensemble non vide pour chaque axe utilisé', () => {
    for (const axis of VALID_AXES) {
      expect(metricsByAxis(axis).length, axis).toBeGreaterThan(0);
    }
  });

  it('METRIC_KEYS couvre tout le registre', () => {
    expect(METRIC_KEYS.length).toBe(ALL_METRICS.length);
  });
});
