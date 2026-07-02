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
  },
}));
vi.mock('./service', () => ({ getMentalMap: m.getMentalMap }));

import {
  closeMicroObjective,
  ensureMicroObjectiveForMember,
  ensureMicroObjectiveFromAnnotation,
  getMicroObjectiveProgress,
  getOpenMicroObjective,
  listRecentMicroObjectives,
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
