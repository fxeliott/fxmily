import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trainingTrade: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { Prisma } from '@/generated/prisma/client';

import { db } from '@/lib/db';

import {
  type CreateTrainingTradeInput,
  createTrainingTrade,
  getTrainingTradeById,
  listTrainingTradesForUser,
} from './training-trade-service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tt-1',
    userId: 'user-1',
    pair: 'EURUSD',
    entryScreenshotKey: 'training/abcdefgh12345678/abcdefghijkl1234.jpg',
    plannedRR: new Prisma.Decimal('2.5'),
    outcome: 'win',
    resultR: new Prisma.Decimal('1.8'),
    systemRespected: true,
    lessonLearned: 'Entrée patiente sur retest.',
    enteredAt: new Date('2026-05-10T10:00:00.000Z'),
    createdAt: new Date('2026-05-17T09:00:00.000Z'),
    updatedAt: new Date('2026-05-17T09:00:00.000Z'),
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateTrainingTradeInput> = {}): CreateTrainingTradeInput {
  return {
    userId: 'user-1',
    pair: 'EURUSD',
    entryScreenshotKey: 'training/abcdefgh12345678/abcdefghijkl1234.jpg',
    plannedRR: 2.5,
    outcome: 'win',
    resultR: 1.8,
    systemRespected: true,
    lessonLearned: 'Entrée patiente sur retest.',
    enteredAt: new Date('2026-05-10T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// createTrainingTrade
// ---------------------------------------------------------------------------

describe('createTrainingTrade', () => {
  it('inserts the mapped data and serializes Decimal→string + Date→ISO', async () => {
    vi.mocked(db.trainingTrade.create).mockResolvedValue(makeRow() as never);

    const result = await createTrainingTrade(makeInput());

    const call = vi.mocked(db.trainingTrade.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as {
      data: {
        userId: string;
        pair: string;
        entryScreenshotKey: string;
        plannedRR: { toString(): string };
        outcome: string | null;
        resultR: { toString(): string } | null;
        systemRespected: boolean | null;
        lessonLearned: string;
        enteredAt: Date;
      };
    };
    expect(arg.data.userId).toBe('user-1');
    expect(arg.data.pair).toBe('EURUSD');
    expect(arg.data.entryScreenshotKey).toBe('training/abcdefgh12345678/abcdefghijkl1234.jpg');
    expect(arg.data.plannedRR.toString()).toBe('2.5');
    expect(arg.data.outcome).toBe('win');
    expect(arg.data.resultR?.toString()).toBe('1.8');
    expect(arg.data.systemRespected).toBe(true);
    expect(arg.data.lessonLearned).toBe('Entrée patiente sur retest.');
    expect(arg.data.enteredAt).toEqual(new Date('2026-05-10T10:00:00.000Z'));

    expect(result.id).toBe('tt-1');
    expect(result.plannedRR).toBe('2.5');
    expect(result.resultR).toBe('1.8');
    expect(result.enteredAt).toBe('2026-05-10T10:00:00.000Z');
    expect(result.createdAt).toBe('2026-05-17T09:00:00.000Z');
  });

  it('persists a null outcome / resultR and serializes them to null', async () => {
    vi.mocked(db.trainingTrade.create).mockResolvedValue(
      makeRow({ outcome: null, resultR: null }) as never,
    );

    const result = await createTrainingTrade(makeInput({ outcome: null, resultR: null }));

    const call = vi.mocked(db.trainingTrade.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as { data: { outcome: string | null; resultR: unknown } };
    expect(arg.data.outcome).toBe(null);
    expect(arg.data.resultR).toBe(null);
    expect(result.outcome).toBe(null);
    expect(result.resultR).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// listTrainingTradesForUser
// ---------------------------------------------------------------------------

describe('listTrainingTradesForUser', () => {
  it('queries user-scoped, newest-first by enteredAt', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([makeRow()] as never);

    const result = await listTrainingTradesForUser('user-1');

    const call = vi.mocked(db.trainingTrade.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as { where: { userId: string }; orderBy: { enteredAt: string } };
    expect(arg.where).toEqual({ userId: 'user-1' });
    expect(arg.orderBy).toEqual({ enteredAt: 'desc' });
    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe('user-1');
    expect(result[0]?.plannedRR).toBe('2.5');
  });

  it('returns an empty array when the user has no backtests', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
    expect(await listTrainingTradesForUser('user-1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTrainingTradeById (member-scoped ownership via a single findFirst)
// ---------------------------------------------------------------------------

describe('getTrainingTradeById', () => {
  it('scopes the query by id AND userId in a single query', async () => {
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue(makeRow() as never);

    const result = await getTrainingTradeById('tt-1', 'user-1');

    const call = vi.mocked(db.trainingTrade.findFirst).mock.calls[0];
    if (!call) throw new Error('expected findFirst to be called');
    const arg = call[0] as { where: { id: string; userId: string } };
    expect(arg.where).toEqual({ id: 'tt-1', userId: 'user-1' });
    expect(result?.id).toBe('tt-1');
  });

  it('returns null when absent or not owned', async () => {
    vi.mocked(db.trainingTrade.findFirst).mockResolvedValue(null as never);
    expect(await getTrainingTradeById('nope', 'user-1')).toBeNull();
  });
});
