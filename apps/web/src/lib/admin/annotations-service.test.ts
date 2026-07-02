import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    tradeAnnotation: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import {
  AnnotationNotFoundError,
  createAnnotation,
  deleteAnnotation,
  getAnnotationById,
  listAnnotationsForTrade,
  serializeAnnotation,
} from './annotations-service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'an-1',
    tradeId: 't-1',
    adminId: 'admin-1',
    comment: 'Bon process, peu importe l’issue.',
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

describe('serializeAnnotation', () => {
  it('maps dates to ISO and derives isUnseenByMember from seenByMemberAt', () => {
    expect(serializeAnnotation(makeRow() as never)).toMatchObject({
      id: 'an-1',
      tradeId: 't-1',
      seenByMemberAt: null,
      isUnseenByMember: true,
      createdAt: '2026-05-17T10:00:00.000Z',
    });
    const seen = serializeAnnotation(
      makeRow({ seenByMemberAt: new Date('2026-05-18T08:00:00.000Z') }) as never,
    );
    expect(seen.seenByMemberAt).toBe('2026-05-18T08:00:00.000Z');
    expect(seen.isUnseenByMember).toBe(false);
  });
});

describe('createAnnotation', () => {
  it('inserts trade + admin + comment and serializes the row', async () => {
    vi.mocked(db.tradeAnnotation.create).mockResolvedValue(makeRow() as never);

    const result = await createAnnotation({
      tradeId: 't-1',
      adminId: 'admin-1',
      comment: 'Bon process, peu importe l’issue.',
      mediaKey: null,
      mediaType: null,
    });

    const call = vi.mocked(db.tradeAnnotation.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({
      tradeId: 't-1',
      adminId: 'admin-1',
      comment: 'Bon process, peu importe l’issue.',
      mediaKey: null,
      mediaType: null,
      axis: null,
    });
    expect(result.id).toBe('an-1');
    expect(result.isUnseenByMember).toBe(true);
  });
});

describe('listAnnotationsForTrade', () => {
  it('queries trade-scoped, newest-first', async () => {
    vi.mocked(db.tradeAnnotation.findMany).mockResolvedValue([makeRow()] as never);

    const result = await listAnnotationsForTrade('t-1');

    const call = vi.mocked(db.tradeAnnotation.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as { where: { tradeId: string }; orderBy: { createdAt: string } };
    expect(arg.where).toEqual({ tradeId: 't-1' });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(result).toHaveLength(1);
    expect(result[0]?.tradeId).toBe('t-1');
  });

  it('returns an empty array when the trade has no annotations', async () => {
    vi.mocked(db.tradeAnnotation.findMany).mockResolvedValue([] as never);
    expect(await listAnnotationsForTrade('t-1')).toEqual([]);
  });
});

describe('deleteAnnotation', () => {
  it('deletes scoped by id AND adminId (anti stray-delete)', async () => {
    vi.mocked(db.tradeAnnotation.deleteMany).mockResolvedValue({ count: 1 } as never);

    await deleteAnnotation('an-1', 'admin-1');

    const call = vi.mocked(db.tradeAnnotation.deleteMany).mock.calls[0];
    if (!call) throw new Error('expected deleteMany to be called');
    const arg = call[0] as { where: { id: string; adminId: string } };
    expect(arg.where).toEqual({ id: 'an-1', adminId: 'admin-1' });
  });

  it('throws AnnotationNotFoundError when nothing matched', async () => {
    vi.mocked(db.tradeAnnotation.deleteMany).mockResolvedValue({ count: 0 } as never);
    await expect(deleteAnnotation('nope', 'admin-1')).rejects.toBeInstanceOf(
      AnnotationNotFoundError,
    );
  });
});

describe('getAnnotationById', () => {
  it('returns the serialized annotation when found', async () => {
    vi.mocked(db.tradeAnnotation.findUnique).mockResolvedValue(makeRow() as never);
    const result = await getAnnotationById('an-1');
    expect(result?.id).toBe('an-1');
    expect(result?.tradeId).toBe('t-1');
  });

  it('returns null when absent', async () => {
    vi.mocked(db.tradeAnnotation.findUnique).mockResolvedValue(null as never);
    expect(await getAnnotationById('nope')).toBeNull();
  });
});
