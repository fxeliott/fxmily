import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MemberProfileCoachingTone,
  MemberProfileLearningStage,
} from '@/lib/schemas/onboarding-interview';

import type { PriorityAxisHints } from './priority-axis';

/**
 * D5 §J-D — tests du seam SERVEUR du moteur de coaching (`service.ts`).
 *
 * On prouve que `getMentalMap` / `getCoachingInsight` :
 *   (b) DÉRIVENT les indices de tie-break `register`/`stage` depuis le profil S2
 *       profond (`coachingTone` / `learningStage`) et les passent à
 *       `classifyPriorityAxes` — via un `safeParse` des schemas Zod du write-time.
 *   (c) NE LISENT JAMAIS `weakSignals` (admin-only) : la frontière membre reste
 *       étanche. Prouvé par un GETTER PIÉGÉ qui jette si le champ est touché.
 *
 * Pattern carbone `onboarding-interview/service.test.ts` : on mocke le singleton
 * `db` + chaque dépendance server-only AVANT d'importer le SUT (pas de connexion
 * Postgres, Prisma est lazy). Les modules PURS (priority-axis, engine, mental-map,
 * dominant-signals, momentum, coaching-axis, schemas) restent RÉELS : le tie-break
 * s'exécute donc réellement de bout en bout. On enveloppe `classifyPriorityAxes`
 * d'un spy qui conserve l'implémentation d'origine pour inspecter ses arguments.
 */

const classifyPriorityAxesSpy = vi.fn();

vi.mock('./priority-axis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./priority-axis')>();
  return {
    ...actual,
    classifyPriorityAxes: (axes: readonly string[], hints?: PriorityAxisHints) => {
      classifyPriorityAxesSpy(axes, hints);
      return actual.classifyPriorityAxes(axes, hints);
    },
  };
});

const getProfileForUserMock = vi.fn();

vi.mock('@/lib/onboarding-interview/service', () => ({
  getProfileForUser: getProfileForUserMock,
}));

vi.mock('@/lib/verification/alerts', () => ({
  listRecentAlertsForMember: vi.fn(async () => []),
}));

vi.mock('@/lib/verification/constancy', () => ({
  listRecentScoreEvents: vi.fn(async () => []),
  getLatestConstancyScore: vi.fn(async () => null),
}));

vi.mock('@/lib/scoring/service', () => ({
  getBehavioralScoreHistory: vi.fn(async () => []),
}));

vi.mock('./micro-objective', () => ({
  getMicroObjectiveProgress: vi.fn(async () => ({
    open: 0,
    kept: 0,
    missed: 0,
    dismissed: 0,
    resolved: 0,
    keptRate: null,
  })),
  getOpenMicroObjective: vi.fn(async () => null),
}));

const { getMentalMap, getCoachingInsight } = await import('./service');

afterEach(() => {
  classifyPriorityAxesSpy.mockClear();
  getProfileForUserMock.mockReset();
});

/**
 * Profil membre minimal (forme `SerializedMemberProfile`) avec un GETTER PIÉGÉ sur
 * `weakSignals` : toute lecture jette immédiatement. Si un chemin du moteur touchait
 * `weakSignals`, le test échouerait bruyamment (invariant admin-only prouvé, pas
 * seulement asserté par un mock non-appelé).
 */
function poisonedProfile(over: {
  coachingTone?: unknown;
  learningStage?: unknown;
  axesPrioritaires?: unknown;
}): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    id: 'p1',
    userId: 'u1',
    interviewId: 'i1',
    summary: 'x',
    highlights: [],
    axesPrioritaires: over.axesPrioritaires ?? [],
    claudeModelVersion: 'v',
    instrumentVersion: 'v1',
    analyzedAt: new Date().toISOString(),
    coachingTone: over.coachingTone ?? null,
    learningStage: over.learningStage ?? null,
    axesStructured: null,
  };
  Object.defineProperty(profile, 'weakSignals', {
    enumerable: true,
    get() {
      throw new Error('FIREWALL VIOLATION §21.5 : weakSignals lu côté membre');
    },
  });
  return profile;
}

const VALID_TONE: MemberProfileCoachingTone = {
  register: 'direct',
  rationale: 'Registre direct inféré des réponses du membre (test).',
  evidence: ['je préfère qu on aille droit au but'],
};

const VALID_STAGE: MemberProfileLearningStage = {
  stage: 'mechanical',
  rationale: 'Stade mécanique inféré des réponses du membre (test).',
  evidence: ['je suis encore mes règles à la lettre'],
};

describe('coaching/service — dérivation des indices de tie-break §J-D', () => {
  it('(b) getMentalMap dérive register/stage du profil et les passe à classifyPriorityAxes', async () => {
    getProfileForUserMock.mockResolvedValue(
      poisonedProfile({ coachingTone: VALID_TONE, learningStage: VALID_STAGE }),
    );

    await getMentalMap('u1');

    expect(classifyPriorityAxesSpy).toHaveBeenCalledTimes(1);
    const [, hints] = classifyPriorityAxesSpy.mock.calls[0] as [
      readonly string[],
      PriorityAxisHints,
    ];
    expect(hints).toEqual({ register: 'direct', stage: 'mechanical' });
  });

  it('(b) getCoachingInsight dérive register/stage du profil et les passe au tie-break', async () => {
    getProfileForUserMock.mockResolvedValue(
      poisonedProfile({
        coachingTone: { ...VALID_TONE, register: 'socratique' },
        learningStage: { ...VALID_STAGE, stage: 'intuitive' },
      }),
    );

    await getCoachingInsight('u1');

    expect(classifyPriorityAxesSpy).toHaveBeenCalled();
    const [, hints] = classifyPriorityAxesSpy.mock.calls[0] as [
      readonly string[],
      PriorityAxisHints,
    ];
    expect(hints).toEqual({ register: 'socratique', stage: 'intuitive' });
  });

  it('champ absent/legacy → enum omis (safeParse échoue silencieusement, pas de throw)', async () => {
    // coachingTone présent mais malformé (register hors enum) ; learningStage null.
    getProfileForUserMock.mockResolvedValue(
      poisonedProfile({ coachingTone: { register: 'not-an-enum' }, learningStage: null }),
    );

    await getMentalMap('u1');

    const [, hints] = classifyPriorityAxesSpy.mock.calls[0] as [
      readonly string[],
      PriorityAxisHints,
    ];
    expect(hints).toEqual({});
  });

  it('profil absent (null) → hints {} et aucun crash', async () => {
    getProfileForUserMock.mockResolvedValue(null);

    await expect(getMentalMap('u1')).resolves.toEqual([]);
    const [, hints] = classifyPriorityAxesSpy.mock.calls[0] as [
      readonly string[],
      PriorityAxisHints,
    ];
    expect(hints).toEqual({});
  });
});

describe('coaching/service — firewall §21.5 : weakSignals JAMAIS lu (frontière membre)', () => {
  it('(c) getMentalMap ne touche jamais weakSignals (getter piégé ⇒ pas de throw)', async () => {
    getProfileForUserMock.mockResolvedValue(
      poisonedProfile({ coachingTone: VALID_TONE, learningStage: VALID_STAGE }),
    );
    await expect(getMentalMap('u1')).resolves.toBeDefined();
  });

  it('(c) getCoachingInsight ne touche jamais weakSignals (getter piégé ⇒ pas de throw)', async () => {
    getProfileForUserMock.mockResolvedValue(
      poisonedProfile({ coachingTone: VALID_TONE, learningStage: VALID_STAGE }),
    );
    // Carte mentale vide (aucun signal mocké) ⇒ insight null, mais AUCUN accès weakSignals.
    await expect(getCoachingInsight('u1')).resolves.toBeNull();
  });
});
