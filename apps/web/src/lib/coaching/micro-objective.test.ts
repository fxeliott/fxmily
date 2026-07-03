import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MentalMapEntry } from './mental-map';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  annotationFindFirst: vi.fn(),
  memberProfileFindFirst: vi.fn(),
  getMentalMap: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    mentalMicroObjective: {
      findFirst: m.findFirst,
      create: m.create,
      findUnique: m.findUnique,
      update: m.update,
      updateMany: m.updateMany,
      findMany: m.findMany,
      groupBy: m.groupBy,
    },
    tradeAnnotation: {
      findFirst: m.annotationFindFirst,
    },
    memberProfile: {
      findFirst: m.memberProfileFindFirst,
    },
  },
}));
vi.mock('./service', () => ({ getMentalMap: m.getMentalMap }));

import {
  buildAnnotationExcerpt,
  buildMicroObjectiveCloseEcho,
  closeMicroObjective,
  ensureMicroObjectiveForMember,
  ensureMicroObjectiveFromAnnotation,
  ensureMicroObjectiveFromSignal,
  getAnnotationExcerptForObjective,
  getMemberCoachingRegister,
  getMicroObjectiveProgress,
  getOpenMicroObjective,
  isMicroObjectiveStale,
  listAnnotationObjectivesForMember,
  listRecentMicroObjectives,
  mentalAxisFromDimensionId,
  MICRO_OBJECTIVE_STALE_DAYS,
  MicroObjectiveNotFoundError,
  selectMicroObjectiveSeed,
} from './micro-objective';

beforeEach(() => vi.clearAllMocks());

function alertEntry(over: Partial<MentalMapEntry> = {}): MentalMapEntry {
  return {
    id: 'alert:a1',
    observation: 'obs',
    meaning: 'mean',
    action: 'Remplis ton bilan ce soir.',
    axis: 'discipline',
    tone: 'alert',
    source: { kind: 'alert', alertId: 'a1', triggerType: 'forgot_no_reason_repeat' },
    ...over,
  };
}
function positiveEntry(): MentalMapEntry {
  return {
    id: 'positive:filled',
    observation: 'obs',
    meaning: 'mean',
    action: 'Continue.',
    axis: 'consistency',
    tone: 'positive',
    source: { kind: 'positive', reason: 'filled' },
  };
}

describe('selectMicroObjectiveSeed (pure)', () => {
  it('returns null on an empty map', () => {
    expect(selectMicroObjectiveSeed([])).toBeNull();
  });

  it('returns null when only a positive entry is present (nothing to work on)', () => {
    expect(selectMicroObjectiveSeed([positiveEntry()])).toBeNull();
  });

  it('derives a seed from an alert entry (source traced, intention = action)', () => {
    const seed = selectMicroObjectiveSeed([alertEntry()]);
    expect(seed).toEqual({
      axis: 'discipline',
      sourceKind: 'alert',
      sourceRef: 'a1',
      title: 'Tenir ta routine, un jour à la fois',
      intention: 'Remplis ton bilan ce soir.',
    });
  });

  it('derives a seed from a signal entry (sourceRef = reason)', () => {
    const seed = selectMicroObjectiveSeed([
      alertEntry({
        id: 'signal:reality_gap',
        axis: 'ego',
        tone: 'watch',
        action: 'Compare ta déclaration au réel.',
        source: { kind: 'signal', reason: 'reality_gap' },
      }),
    ]);
    expect(seed).toMatchObject({ axis: 'ego', sourceKind: 'signal', sourceRef: 'reality_gap' });
  });

  it('picks the first actionable entry, skipping a leading positive', () => {
    const seed = selectMicroObjectiveSeed([positiveEntry(), alertEntry({ axis: 'honesty' })]);
    expect(seed?.axis).toBe('honesty');
  });
});

describe('ensureMicroObjectiveForMember', () => {
  it('is a no-op when an open objective already exists (one at a time)', async () => {
    m.findFirst.mockResolvedValue({ id: 'open1' });
    const res = await ensureMicroObjectiveForMember('member1');
    expect(res).toEqual({ created: false, objectiveId: 'open1' });
    expect(m.getMentalMap).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('creates one from the live mental map when none is open', async () => {
    m.findFirst.mockResolvedValue(null);
    m.getMentalMap.mockResolvedValue([alertEntry({ axis: 'honesty' })]);
    m.create.mockResolvedValue({ id: 'new1' });
    const res = await ensureMicroObjectiveForMember('member1');
    expect(res).toEqual({ created: true, objectiveId: 'new1' });
    const data = m.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      memberId: 'member1',
      axis: 'honesty',
      sourceKind: 'alert',
      sourceRef: 'a1',
      intention: 'Remplis ton bilan ce soir.',
    });
  });

  it('creates nothing when the map has no actionable entry', async () => {
    m.findFirst.mockResolvedValue(null);
    m.getMentalMap.mockResolvedValue([positiveEntry()]);
    const res = await ensureMicroObjectiveForMember('member1');
    expect(res).toEqual({ created: false, objectiveId: null });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('race perdue (re-challenge #3) — un create rejeté P2002 retombe en no-op sur le gagnant', async () => {
    // Deux passages `after()` quasi simultanés lisent TOUS DEUX « aucun ouvert » ; le
    // 2e `create` viole l'index partiel `..._one_open_per_member` → P2002. On NE doit
    // PAS propager : on relit l'ouvert gagnant et on rend {created:false}. C'est l'index
    // DB (pas le findFirst) qui garantit l'invariant « ≤1 ouvert » multi-process.
    m.findFirst
      .mockResolvedValueOnce(null) // notre court-circuit perf : rien d'ouvert
      .mockResolvedValueOnce({ id: 'winner1' }); // relecture post-P2002 : l'autre a gagné
    m.getMentalMap.mockResolvedValue([alertEntry()]);
    m.create.mockRejectedValue({ code: 'P2002' });
    const res = await ensureMicroObjectiveForMember('member1');
    expect(res).toEqual({ created: false, objectiveId: 'winner1' });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.findFirst).toHaveBeenCalledTimes(2);
  });

  it('race perdue P2002 SANS gagnant relisible → objectiveId null (jamais un throw)', async () => {
    // Cas dégénéré (le gagnant a été refermé entre-temps) : on reste défensif, no-op.
    m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    m.getMentalMap.mockResolvedValue([alertEntry()]);
    m.create.mockRejectedValue({ code: 'P2002' });
    const res = await ensureMicroObjectiveForMember('member1');
    expect(res).toEqual({ created: false, objectiveId: null });
  });

  it('une erreur DB NON-P2002 est propagée (jamais avalée en silence)', async () => {
    m.findFirst.mockResolvedValue(null);
    m.getMentalMap.mockResolvedValue([alertEntry()]);
    m.create.mockRejectedValue(new Error('connection reset'));
    await expect(ensureMicroObjectiveForMember('member1')).rejects.toThrow('connection reset');
  });
});

describe('ensureMicroObjectiveFromAnnotation (J-AI corrections echo)', () => {
  it('seeds a micro-objective from a tagged correction, mapping the axis to a MentalAxis', async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: 'obj-anno' });
    // `risk_discipline` (TrackingAxis) → `discipline` (MentalAxis).
    const res = await ensureMicroObjectiveFromAnnotation('member1', 'risk_discipline', 'anno-1');
    expect(res).toEqual({ created: true, objectiveId: 'obj-anno' });
    const data = m.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      memberId: 'member1',
      axis: 'discipline',
      sourceKind: 'annotation',
      sourceRef: 'anno-1',
    });
    // Curated, deterministic copy (never free LLM text, anti-market).
    expect(typeof data.title).toBe('string');
    expect(typeof data.intention).toBe('string');
  });

  it('maps emotions_confidence / self_work to the ego axis', async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: 'obj-ego' });
    await ensureMicroObjectiveFromAnnotation('member1', 'emotions_confidence', 'anno-2');
    expect(m.create.mock.calls[0]?.[0]?.data.axis).toBe('ego');
  });

  it('maps training / formation / meeting_presence to the consistency axis', async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: 'obj-c' });
    await ensureMicroObjectiveFromAnnotation('member1', 'formation', 'anno-3');
    expect(m.create.mock.calls[0]?.[0]?.data.axis).toBe('consistency');
  });

  it('is a no-op when the member already has an open objective (≤1 open invariant)', async () => {
    m.findFirst.mockResolvedValue({ id: 'already-open' });
    const res = await ensureMicroObjectiveFromAnnotation('member1', 'execution', 'anno-4');
    expect(res).toEqual({ created: false, objectiveId: 'already-open' });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('folds a P2002 (concurrent seed) into a no-op on the winner', async () => {
    m.findFirst
      .mockResolvedValueOnce(null) // our perf short-circuit: nothing open
      .mockResolvedValueOnce({ id: 'winner-anno' }); // post-P2002 re-read
    m.create.mockRejectedValue({ code: 'P2002' });
    const res = await ensureMicroObjectiveFromAnnotation('member1', 'execution', 'anno-5');
    expect(res).toEqual({ created: false, objectiveId: 'winner-anno' });
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-P2002 DB error (never swallowed)', async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockRejectedValue(new Error('connection reset'));
    await expect(
      ensureMicroObjectiveFromAnnotation('member1', 'execution', 'anno-6'),
    ).rejects.toThrow('connection reset');
  });
});

describe('closeMicroObjective', () => {
  it('closes an owned open objective with a status-guarded updateMany (RC#7 TX-2)', async () => {
    m.findUnique.mockResolvedValue({ memberId: 'member1', status: 'open' });
    m.updateMany.mockResolvedValue({ count: 1 });
    await closeMicroObjective('member1', 'obj1', 'kept');
    // The `status: 'open'` predicate in the WHERE is the optimistic lock that
    // makes a concurrent second close a no-op instead of a last-write clobber.
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'obj1', memberId: 'member1', status: 'open' },
      data: { status: 'kept', closedAt: expect.any(Date) },
    });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('BOLA — another member or absent collapses to the same error, no write', async () => {
    m.findUnique.mockResolvedValue({ memberId: 'memberX', status: 'open' });
    await expect(closeMicroObjective('member1', 'obj1', 'kept')).rejects.toBeInstanceOf(
      MicroObjectiveNotFoundError,
    );
    m.findUnique.mockResolvedValue(null);
    await expect(closeMicroObjective('member1', 'obj1', 'kept')).rejects.toBeInstanceOf(
      MicroObjectiveNotFoundError,
    );
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent — an already-closed loop is not rewritten', async () => {
    m.findUnique.mockResolvedValue({ memberId: 'member1', status: 'kept' });
    await closeMicroObjective('member1', 'obj1', 'missed');
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('🚨 RACE (RC#7 TX-2) — a concurrent close already flipped the row → updateMany matches 0 rows → no-op, never throws', async () => {
    // findUnique still reads 'open' (stale plain read), but by the time the
    // write lands a concurrent close has flipped it: the WHERE predicate makes
    // it match 0 rows. The function must settle as a clean no-op so « le 1er
    // suivi fait foi » holds without a last-write-wins clobber.
    m.findUnique.mockResolvedValue({ memberId: 'member1', status: 'open' });
    m.updateMany.mockResolvedValue({ count: 0 });
    await expect(closeMicroObjective('member1', 'obj1', 'missed')).resolves.toBeUndefined();
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'obj1', memberId: 'member1', status: 'open' },
      data: { status: 'missed', closedAt: expect.any(Date) },
    });
  });
});

describe('getOpenMicroObjective', () => {
  it('maps the open row to a view', async () => {
    m.findFirst.mockResolvedValue({
      id: 'o1',
      axis: 'discipline',
      title: 'T',
      intention: 'I',
      status: 'open',
      sourceKind: 'alert',
      sourceRef: 'a1',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      closedAt: null,
    });
    const view = await getOpenMicroObjective('member1');
    expect(view).toMatchObject({ id: 'o1', status: 'open', closedAt: null });
  });

  it('returns null when none is open', async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await getOpenMicroObjective('member1')).toBeNull();
  });
});

describe('listRecentMicroObjectives', () => {
  it('maps rows to views', async () => {
    m.findMany.mockResolvedValue([
      {
        id: 'o2',
        axis: 'ego',
        title: 'T',
        intention: 'I',
        status: 'kept',
        sourceKind: 'signal',
        sourceRef: 'reality_gap',
        createdAt: new Date('2026-06-02T00:00:00Z'),
        closedAt: new Date('2026-06-03T00:00:00Z'),
      },
    ]);
    const views = await listRecentMicroObjectives('member1');
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ id: 'o2', status: 'kept' });
  });
});

describe('getMicroObjectiveProgress', () => {
  it('counts per status and computes keptRate (dismissed excluded)', async () => {
    m.groupBy.mockResolvedValue([
      { status: 'kept', _count: { _all: 3 } },
      { status: 'missed', _count: { _all: 1 } },
      { status: 'dismissed', _count: { _all: 2 } },
      { status: 'open', _count: { _all: 1 } },
    ]);
    const p = await getMicroObjectiveProgress('member1');
    expect(p).toEqual({
      open: 1,
      kept: 3,
      missed: 1,
      dismissed: 2,
      resolved: 4,
      keptRate: 75,
    });
  });

  it('returns a null keptRate when no loop has been kept or missed', async () => {
    m.groupBy.mockResolvedValue([{ status: 'open', _count: { _all: 2 } }]);
    const p = await getMicroObjectiveProgress('member1');
    expect(p.keptRate).toBeNull();
    expect(p.resolved).toBe(0);
  });

  it('passes the createdAt range filter through when provided', async () => {
    m.groupBy.mockResolvedValue([]);
    const start = new Date('2026-06-01T00:00:00Z');
    const end = new Date('2026-06-30T00:00:00Z');
    await getMicroObjectiveProgress('member1', { start, end });
    const arg = m.groupBy.mock.calls[0]?.[0];
    expect(arg?.where).toMatchObject({ memberId: 'member1', createdAt: { gte: start, lte: end } });
  });
});

describe('buildAnnotationExcerpt (pure) — C3', () => {
  it('returns null on an empty / whitespace-only comment (no ghost excerpt)', () => {
    expect(buildAnnotationExcerpt('')).toBeNull();
    expect(buildAnnotationExcerpt('   \n  \t ')).toBeNull();
  });

  it('flattens whitespace/newlines and passes a short comment through unchanged', () => {
    expect(buildAnnotationExcerpt('Bien joué  sur\nla  gestion du risque.')).toBe(
      'Bien joué sur la gestion du risque.',
    );
  });

  it('truncates a long comment on a word boundary with an ellipsis', () => {
    const long = 'mot '.repeat(80).trim(); // 320 chars, spaces every 4
    const out = buildAnnotationExcerpt(long)!;
    expect(out.length).toBeLessThanOrEqual(181); // 180 + ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/ …$/); // trailing space trimmed before the ellipsis
  });

  it('hard-cuts a single very long word (no space before the limit)', () => {
    const out = buildAnnotationExcerpt('a'.repeat(300))!;
    expect(out).toBe(`${'a'.repeat(180)}…`);
  });
});

describe('getAnnotationExcerptForObjective — C3 (BOLA + fallback)', () => {
  it('returns null without a query when the loop is not annotation-sourced', async () => {
    const out = await getAnnotationExcerptForObjective('member1', {
      sourceKind: 'alert',
      sourceRef: 'a1',
    });
    expect(out).toBeNull();
    expect(m.annotationFindFirst).not.toHaveBeenCalled();
  });

  it('scopes the read by trade.userId (BOLA) and returns the trimmed excerpt', async () => {
    m.annotationFindFirst.mockResolvedValue({ comment: 'Tu as bougé ton stop en cours de trade.' });
    const out = await getAnnotationExcerptForObjective('member1', {
      sourceKind: 'annotation',
      sourceRef: 'anno-1',
    });
    expect(out).toBe('Tu as bougé ton stop en cours de trade.');
    expect(m.annotationFindFirst).toHaveBeenCalledWith({
      where: { id: 'anno-1', trade: { is: { userId: 'member1' } } },
      select: { comment: true },
    });
  });

  it('falls back to null when the annotation no longer exists / is another member’s', async () => {
    m.annotationFindFirst.mockResolvedValue(null);
    const out = await getAnnotationExcerptForObjective('member1', {
      sourceKind: 'annotation',
      sourceRef: 'anno-x',
    });
    expect(out).toBeNull();
  });
});

describe('listAnnotationObjectivesForMember — C3 (admin follow-up)', () => {
  it('queries annotation-sourced objectives only, newest-first, bounded, ciblé select', async () => {
    m.findMany.mockResolvedValue([
      {
        id: 'o-anno',
        axis: 'discipline',
        title: 'T',
        intention: 'I',
        status: 'missed',
        createdAt: new Date('2026-06-02T00:00:00Z'),
        closedAt: new Date('2026-06-05T00:00:00Z'),
      },
    ]);
    const rows = await listAnnotationObjectivesForMember('member1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'o-anno', status: 'missed' });
    const arg = m.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ memberId: 'member1', sourceKind: 'annotation' });
    expect(arg?.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg?.take).toBe(20);
    // Single ciblé select — no sourceRef/sourceKind pulled (anti over-fetch, N+1-safe).
    expect(arg?.select).toMatchObject({ id: true, title: true, status: true });
  });
});

describe('buildMicroObjectiveCloseEcho (pure) — Tour 11 FINDING 1', () => {
  it('kept → renforcement, tone ok, phrase de constance en tête', () => {
    const echo = buildMicroObjectiveCloseEcho('kept', 'direct');
    expect(echo.tone).toBe('ok');
    expect(echo.lines[0]).toContain("Tu l'as tenu");
    expect(echo.lines[0]).toContain('constance');
  });

  it('missed direct → cadre-donnée non punitif, tone neutral (le mot échec est NIÉ)', () => {
    const echo = buildMicroObjectiveCloseEcho('missed', 'direct');
    expect(echo.tone).toBe('neutral');
    expect(echo.lines[0]?.toLowerCase()).toContain('donnée');
    // Posture §31.2 : « échec » n'est jamais un verdict — la copie le NIE explicitement.
    expect(echo.lines[0]).toContain('pas un échec');
  });

  it('missed pédagogique → recadrage non punitif (ni faute ni échec), tone neutral', () => {
    const echo = buildMicroObjectiveCloseEcho('missed', 'pedagogique');
    expect(echo.tone).toBe('neutral');
    expect(echo.lines.join(' ').toLowerCase()).toContain('donnée');
    expect(echo.lines.join(' ')).toContain('pas une faute');
  });

  it('dismissed → neutre, une seule ligne, tone neutral', () => {
    const echo = buildMicroObjectiveCloseEcho('dismissed', 'socratique');
    expect(echo.tone).toBe('neutral');
    expect(echo.lines).toHaveLength(1);
  });

  it('register null → fallback pédagogique (jamais un crash)', () => {
    const echo = buildMicroObjectiveCloseEcho('kept', null);
    expect(echo).toEqual(buildMicroObjectiveCloseEcho('kept', 'pedagogique'));
  });

  it('aucune copie ne contient de tiret cadratin (règle typo Eliott)', () => {
    for (const outcome of ['kept', 'missed', 'dismissed'] as const) {
      for (const register of ['direct', 'pedagogique', 'socratique'] as const) {
        const echo = buildMicroObjectiveCloseEcho(outcome, register);
        for (const line of echo.lines) {
          expect(line).not.toContain('—'); // em-dash interdit
        }
      }
    }
  });

  it('chaque (outcome × register) rend 1 à 2 lignes non vides, tone jamais bad', () => {
    for (const outcome of ['kept', 'missed', 'dismissed'] as const) {
      for (const register of ['direct', 'pedagogique', 'socratique'] as const) {
        const echo = buildMicroObjectiveCloseEcho(outcome, register);
        expect(echo.lines.length).toBeGreaterThanOrEqual(1);
        expect(echo.lines.length).toBeLessThanOrEqual(2);
        expect(echo.lines.every((l) => l.trim().length > 0)).toBe(true);
        expect(['ok', 'neutral']).toContain(echo.tone);
      }
    }
  });
});

describe('getMemberCoachingRegister — Tour 11 FINDING 1 (firewall §21.5)', () => {
  it('dérive le register depuis coachingTone (safeParse), ne lit que tone/stage', async () => {
    m.memberProfileFindFirst.mockResolvedValue({
      coachingTone: {
        register: 'direct',
        rationale: 'assez de matière pour trancher net',
        evidence: ['je préfère qu’on me dise les choses'],
      },
      learningStage: null,
    });
    const register = await getMemberCoachingRegister('member1');
    expect(register).toBe('direct');
    // Firewall : le select ne demande QUE coachingTone/learningStage, jamais weakSignals.
    const arg = m.memberProfileFindFirst.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ userId: 'member1' });
    expect(arg?.select).toEqual({ coachingTone: true, learningStage: true });
  });

  it('profil absent → null (fallback pédagogique en aval)', async () => {
    m.memberProfileFindFirst.mockResolvedValue(null);
    expect(await getMemberCoachingRegister('member1')).toBeNull();
  });

  it('coachingTone illisible → null (garbage ne fabrique jamais un register)', async () => {
    m.memberProfileFindFirst.mockResolvedValue({ coachingTone: 42, learningStage: 'nope' });
    expect(await getMemberCoachingRegister('member1')).toBeNull();
  });
});

describe('isMicroObjectiveStale (pure) — Tour 11 FINDING 2', () => {
  const now = new Date('2026-07-03T12:00:00Z');

  it('false sous le seuil de 14 jours', () => {
    const createdAt = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
    expect(isMicroObjectiveStale(createdAt, now)).toBe(false);
  });

  it('true à exactement 14 jours (seuil inclusif)', () => {
    const createdAt = new Date(now.getTime() - MICRO_OBJECTIVE_STALE_DAYS * 24 * 60 * 60 * 1000);
    expect(isMicroObjectiveStale(createdAt, now)).toBe(true);
  });

  it('true bien au-delà (boucle oubliée depuis des semaines)', () => {
    const createdAt = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    expect(isMicroObjectiveStale(createdAt, now)).toBe(true);
  });
});

describe('mentalAxisFromDimensionId (pure) — Tour 11 FINDING 3 (firewall)', () => {
  it('mappe le préfixe de slug vers l’axe mental (jamais le texte du signal)', () => {
    expect(mentalAxisFromDimensionId('discipline_plan_adherence')).toBe('discipline');
    expect(mentalAxisFromDimensionId('risk_sizing_consistency')).toBe('discipline');
    expect(mentalAxisFromDimensionId('review_honesty_bias')).toBe('honesty');
    expect(mentalAxisFromDimensionId('emotion_regulation')).toBe('ego');
    expect(mentalAxisFromDimensionId('consistency_routine')).toBe('consistency');
  });

  it('slug inconnu → fallback discipline (jamais un crash, jamais un axe fabriqué)', () => {
    expect(mentalAxisFromDimensionId('xyz_unknown_dimension')).toBe('discipline');
    expect(mentalAxisFromDimensionId('')).toBe('discipline');
  });

  it('insensible à la casse et au séparateur', () => {
    expect(mentalAxisFromDimensionId('Emotion-Confidence')).toBe('ego');
  });
});

describe('ensureMicroObjectiveFromSignal — Tour 11 FINDING 3', () => {
  it('sème un objectif signal avec copie curée par axe (jamais le texte du signal)', async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: 'obj-sig' });
    const res = await ensureMicroObjectiveFromSignal('member1', 'ego', 'emotion_regulation');
    expect(res).toEqual({ created: true, objectiveId: 'obj-sig' });
    const data = m.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      memberId: 'member1',
      axis: 'ego',
      sourceKind: 'signal',
      sourceRef: 'emotion_regulation', // ref OPAQUE (slug), jamais le contenu
    });
    // Copie curée déterministe (jamais de texte libre du signal).
    expect(typeof data.title).toBe('string');
    expect(typeof data.intention).toBe('string');
  });

  it('no-op quand une boucle est déjà ouverte (invariant ≤1 ouvert)', async () => {
    m.findFirst.mockResolvedValue({ id: 'already-open' });
    const res = await ensureMicroObjectiveFromSignal('member1', 'discipline', 'discipline_plan');
    expect(res).toEqual({ created: false, objectiveId: 'already-open' });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('replie un P2002 (semis concurrent) en no-op sur le gagnant', async () => {
    m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner-sig' });
    m.create.mockRejectedValue({ code: 'P2002' });
    const res = await ensureMicroObjectiveFromSignal('member1', 'honesty', 'review_bias');
    expect(res).toEqual({ created: false, objectiveId: 'winner-sig' });
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it('propage une erreur DB non-P2002 (jamais avalée)', async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockRejectedValue(new Error('connection reset'));
    await expect(
      ensureMicroObjectiveFromSignal('member1', 'discipline', 'discipline_plan'),
    ).rejects.toThrow('connection reset');
  });
});
