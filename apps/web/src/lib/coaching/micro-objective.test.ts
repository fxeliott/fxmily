import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MentalMapEntry } from './mental-map';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
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
      findMany: m.findMany,
      groupBy: m.groupBy,
    },
  },
}));
vi.mock('./service', () => ({ getMentalMap: m.getMentalMap }));

import {
  closeMicroObjective,
  ensureMicroObjectiveForMember,
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
});

describe('closeMicroObjective', () => {
  it('closes an owned open objective with the given outcome', async () => {
    m.findUnique.mockResolvedValue({ memberId: 'member1', status: 'open' });
    m.update.mockResolvedValue({});
    await closeMicroObjective('member1', 'obj1', 'kept');
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 'obj1' },
      data: { status: 'kept', closedAt: expect.any(Date) },
    });
  });

  it('BOLA — another member or absent collapses to the same error, no update', async () => {
    m.findUnique.mockResolvedValue({ memberId: 'memberX', status: 'open' });
    await expect(closeMicroObjective('member1', 'obj1', 'kept')).rejects.toBeInstanceOf(
      MicroObjectiveNotFoundError,
    );
    m.findUnique.mockResolvedValue(null);
    await expect(closeMicroObjective('member1', 'obj1', 'kept')).rejects.toBeInstanceOf(
      MicroObjectiveNotFoundError,
    );
    expect(m.update).not.toHaveBeenCalled();
  });

  it('is idempotent — an already-closed loop is not rewritten', async () => {
    m.findUnique.mockResolvedValue({ memberId: 'member1', status: 'kept' });
    await closeMicroObjective('member1', 'obj1', 'missed');
    expect(m.update).not.toHaveBeenCalled();
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
