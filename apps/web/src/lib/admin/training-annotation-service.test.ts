import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trainingAnnotation: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import {
  TrainingAnnotationNotFoundError,
  createTrainingAnnotation,
  deleteTrainingAnnotation,
  getTrainingAnnotationById,
  listTrainingAnnotationsForTrainingTrade,
} from './training-annotation-service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ta-1',
    trainingTradeId: 'tt-1',
    adminId: 'admin-1',
    comment: 'Bonne lecture, mais SL trop serré.',
    mediaKey: null,
    mediaType: null,
    seenByMemberAt: null,
    createdAt: new Date('2026-05-17T10:00:00.000Z'),
    updatedAt: new Date('2026-05-17T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// createTrainingAnnotation
// ---------------------------------------------------------------------------

describe('createTrainingAnnotation', () => {
  it('inserts trainingTrade + admin + comment and serializes dates to ISO', async () => {
    vi.mocked(db.trainingAnnotation.create).mockResolvedValue(makeRow() as never);

    const result = await createTrainingAnnotation({
      trainingTradeId: 'tt-1',
      adminId: 'admin-1',
      comment: 'Bonne lecture, mais SL trop serré.',
      mediaKey: null,
      mediaType: null,
    });

    const call = vi.mocked(db.trainingAnnotation.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as {
      data: {
        trainingTradeId: string;
        adminId: string;
        comment: string;
        mediaKey: string | null;
        mediaType: string | null;
      };
    };
    expect(arg.data).toEqual({
      trainingTradeId: 'tt-1',
      adminId: 'admin-1',
      comment: 'Bonne lecture, mais SL trop serré.',
      mediaKey: null,
      mediaType: null,
    });
    expect(result.id).toBe('ta-1');
    expect(result.createdAt).toBe('2026-05-17T10:00:00.000Z');
    expect(result.isUnseenByMember).toBe(true);
    expect(result.seenByMemberAt).toBe(null);
  });

  it('serializes a seen annotation (seenByMemberAt set → isUnseenByMember false)', async () => {
    vi.mocked(db.trainingAnnotation.create).mockResolvedValue(
      makeRow({ seenByMemberAt: new Date('2026-05-18T08:00:00.000Z') }) as never,
    );

    const result = await createTrainingAnnotation({
      trainingTradeId: 'tt-1',
      adminId: 'admin-1',
      comment: 'x',
      mediaKey: null,
      mediaType: null,
    });

    expect(result.seenByMemberAt).toBe('2026-05-18T08:00:00.000Z');
    expect(result.isUnseenByMember).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listTrainingAnnotationsForTrainingTrade
// ---------------------------------------------------------------------------

describe('listTrainingAnnotationsForTrainingTrade', () => {
  it('queries trade-scoped, newest-first', async () => {
    vi.mocked(db.trainingAnnotation.findMany).mockResolvedValue([makeRow()] as never);

    const result = await listTrainingAnnotationsForTrainingTrade('tt-1');

    const call = vi.mocked(db.trainingAnnotation.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as {
      where: { trainingTradeId: string };
      orderBy: { createdAt: string };
    };
    expect(arg.where).toEqual({ trainingTradeId: 'tt-1' });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(result).toHaveLength(1);
    expect(result[0]?.trainingTradeId).toBe('tt-1');
  });

  it('returns an empty array when the backtest has no corrections', async () => {
    vi.mocked(db.trainingAnnotation.findMany).mockResolvedValue([] as never);
    expect(await listTrainingAnnotationsForTrainingTrade('tt-1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteTrainingAnnotation (scoped by id AND adminId — anti stray-delete)
// ---------------------------------------------------------------------------

describe('deleteTrainingAnnotation', () => {
  it('deletes scoped by id AND adminId', async () => {
    vi.mocked(db.trainingAnnotation.deleteMany).mockResolvedValue({ count: 1 } as never);

    await deleteTrainingAnnotation('ta-1', 'admin-1');

    const call = vi.mocked(db.trainingAnnotation.deleteMany).mock.calls[0];
    if (!call) throw new Error('expected deleteMany to be called');
    const arg = call[0] as { where: { id: string; adminId: string } };
    expect(arg.where).toEqual({ id: 'ta-1', adminId: 'admin-1' });
  });

  it('throws TrainingAnnotationNotFoundError when nothing matched', async () => {
    vi.mocked(db.trainingAnnotation.deleteMany).mockResolvedValue({ count: 0 } as never);
    await expect(deleteTrainingAnnotation('nope', 'admin-1')).rejects.toBeInstanceOf(
      TrainingAnnotationNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// getTrainingAnnotationById
// ---------------------------------------------------------------------------

describe('getTrainingAnnotationById', () => {
  it('returns the serialized annotation when found', async () => {
    vi.mocked(db.trainingAnnotation.findUnique).mockResolvedValue(makeRow() as never);
    const result = await getTrainingAnnotationById('ta-1');
    expect(result?.id).toBe('ta-1');
    expect(result?.trainingTradeId).toBe('tt-1');
  });

  it('returns null when absent', async () => {
    vi.mocked(db.trainingAnnotation.findUnique).mockResolvedValue(null as never);
    expect(await getTrainingAnnotationById('nope')).toBeNull();
  });
});
