import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    reflectionEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import { createReflectionEntry, getReflectionById, listRecentReflections } from './service';

// ---------------------------------------------------------------------------
// Typed mock-call introspection helpers
// ---------------------------------------------------------------------------

interface CreateArg {
  data: {
    userId: string;
    date: Date;
    triggerEvent: string;
  };
}

interface FindManyArg {
  where: {
    userId: string;
    date: { gte: Date };
  };
  orderBy: Array<{ date?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' }>;
}

function firstCreateCall(): CreateArg {
  const call = vi.mocked(db.reflectionEntry.create).mock.calls[0];
  if (!call) throw new Error('expected db.reflectionEntry.create to have been called');
  return call[0] as unknown as CreateArg;
}

function findManyCallAt(index: number): FindManyArg {
  const call = vi.mocked(db.reflectionEntry.findMany).mock.calls[index];
  if (!call) throw new Error(`expected db.reflectionEntry.findMany call #${index}`);
  return call[0] as unknown as FindManyArg;
}

const validInput = {
  date: '2026-05-13',
  triggerEvent: 'Saw the NFP miss expectations by 50k jobs at 13:30 GMT.',
  beliefAuto: 'I have to chase this move now or miss everything.',
  consequence: 'Felt FOMO, broke my "no NFP first 5 min" rule, entered.',
  disputation:
    'The plan exists for high-volatility moments precisely. Skipping NFP costs me one trade; chasing it can cost me my week.',
};

function makeDbRow(overrides: Partial<{ id: string; date: Date }> = {}) {
  return {
    id: 'ref-1',
    userId: 'user-1',
    date: new Date('2026-05-13T00:00:00Z'),
    triggerEvent: validInput.triggerEvent,
    beliefAuto: validInput.beliefAuto,
    consequence: validInput.consequence,
    disputation: validInput.disputation,
    createdAt: new Date('2026-05-13T14:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createReflectionEntry', () => {
  it('persists the ABCD fields and serializes back', async () => {
    vi.mocked(db.reflectionEntry.create).mockResolvedValue(makeDbRow() as never);

    const result = await createReflectionEntry('user-1', validInput);

    expect(db.reflectionEntry.create).toHaveBeenCalledOnce();
    const createArg = firstCreateCall();
    expect(createArg.data.userId).toBe('user-1');
    expect(createArg.data.triggerEvent).toBe(validInput.triggerEvent);
    expect(createArg.data.date.toISOString().slice(0, 10)).toBe('2026-05-13');

    expect(result.date).toBe('2026-05-13');
    expect(result.disputation).toContain('plan exists');
  });
});

describe('getReflectionById (V1.8 BOLA defence, V1.9 TIER B atomic findFirst)', () => {
  it('returns null on empty id', async () => {
    expect(await getReflectionById('user-1', '')).toBeNull();
  });

  it('returns null on oversized id', async () => {
    expect(await getReflectionById('user-1', 'x'.repeat(65))).toBeNull();
    expect(db.reflectionEntry.findFirst).not.toHaveBeenCalled();
  });

  it('queries findFirst with both id AND userId in the WHERE clause (anti-BOLA at DB layer)', async () => {
    vi.mocked(db.reflectionEntry.findFirst).mockResolvedValue(null as never);
    await getReflectionById('user-1', 'ref-1');
    const call = vi.mocked(db.reflectionEntry.findFirst).mock.calls[0];
    if (!call) throw new Error('expected findFirst to be called');
    const arg = call[0] as { where: { id: string; userId: string } };
    expect(arg.where).toEqual({ id: 'ref-1', userId: 'user-1' });
  });

  it('returns null when DB filters out a row belonging to another user (findFirst returns null)', async () => {
    vi.mocked(db.reflectionEntry.findFirst).mockResolvedValue(null as never);
    expect(await getReflectionById('user-1', 'ref-stolen')).toBeNull();
  });

  it('serializes the row when ownership matches', async () => {
    vi.mocked(db.reflectionEntry.findFirst).mockResolvedValue(makeDbRow() as never);
    const result = await getReflectionById('user-1', 'ref-1');
    expect(result?.userId).toBe('user-1');
    expect(result?.date).toBe('2026-05-13');
  });

  it('returns null when row absent', async () => {
    vi.mocked(db.reflectionEntry.findFirst).mockResolvedValue(null as never);
    expect(await getReflectionById('user-1', 'ref-absent')).toBeNull();
  });
});

describe('listRecentReflections', () => {
  it('queries the rolling window with date+createdAt desc', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([makeDbRow()] as never);
    await listRecentReflections('user-1', 14);

    const callArg = findManyCallAt(0);
    expect(callArg.where.userId).toBe('user-1');
    expect(callArg.where.date).toHaveProperty('gte');
    expect(callArg.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
  });

  it('clamps the window to [1, 365] days', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);

    await listRecentReflections('user-1', 0);
    await listRecentReflections('user-1', 9999);

    const firstGte = findManyCallAt(0).where.date.gte;
    const secondGte = findManyCallAt(1).where.date.gte;
    expect(firstGte).toBeInstanceOf(Date);
    expect(secondGte).toBeInstanceOf(Date);
    // 365-day window must be older than 1-day window.
    expect(secondGte.getTime()).toBeLessThan(firstGte.getTime());
  });
});
