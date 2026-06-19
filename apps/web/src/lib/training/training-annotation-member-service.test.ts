import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J-T3 / S8 verif-layer — member-facing training-correction service tests.
 *
 * This service is the member half of DoD §32(b) ("le membre VOIT la
 * correction"). Its ONLY BOLA guard is the inner relation filter
 * `trainingTrade: { is: { userId } }`, repeated across all 3 functions and —
 * before this suite — untested. A silent drop of that filter (e.g. a refactor
 * that flips another member's badges via updateMany, or lists/counts a foreign
 * backtest's corrections) was caught by NO test. These tests pin the `where`
 * shape at runtime (twin of the admin `training-annotation-service.test.ts`).
 *
 * Only `@/lib/db` and the pure serializer are mocked.
 */

vi.mock('@/lib/db', () => ({
  db: {
    trainingAnnotation: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));
vi.mock('@/lib/admin/training-annotation-service', () => ({
  serializeTrainingAnnotation: (row: unknown) => row,
}));

import { db } from '@/lib/db';

import {
  countUnseenTrainingAnnotationsByTrainingTrade,
  listTrainingAnnotationsForTrainingTradeAsMember,
  markTrainingAnnotationsSeenForTrainingTrade,
} from './training-annotation-member-service';

const USER = 'clx0member01';
const TT = 'clx0trainingtrade01';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('markTrainingAnnotationsSeenForTrainingTrade (BOLA on updateMany)', () => {
  it('scopes the update by trainingTradeId + unread + OWNER relation, stamps a Date', async () => {
    vi.mocked(db.trainingAnnotation.updateMany).mockResolvedValue({ count: 3 } as never);

    const res = await markTrainingAnnotationsSeenForTrainingTrade(USER, TT);

    expect(res).toEqual({ count: 3 });
    const arg = vi.mocked(db.trainingAnnotation.updateMany).mock.calls[0]![0] as {
      where: {
        trainingTradeId: string;
        seenByMemberAt: null;
        trainingTrade: { is: { userId: string } };
      };
      data: { seenByMemberAt: unknown };
    };
    expect(arg.where.trainingTradeId).toBe(TT);
    expect(arg.where.seenByMemberAt).toBeNull();
    // 🚨 BOLA — the ownership filter MUST be present so a member never flips
    // another member's "unread" badges.
    expect(arg.where.trainingTrade).toEqual({ is: { userId: USER } });
    expect(arg.data.seenByMemberAt).toBeInstanceOf(Date);
  });

  it('a foreign / absent backtest yields count:0 and never throws', async () => {
    vi.mocked(db.trainingAnnotation.updateMany).mockResolvedValue({ count: 0 } as never);
    await expect(markTrainingAnnotationsSeenForTrainingTrade(USER, 'foreign')).resolves.toEqual({
      count: 0,
    });
  });
});

describe('listTrainingAnnotationsForTrainingTradeAsMember (BOLA on findMany)', () => {
  it('filters by the owner relation, newest-first, and returns [] on empty (no existence leak)', async () => {
    vi.mocked(db.trainingAnnotation.findMany).mockResolvedValue([] as never);

    const res = await listTrainingAnnotationsForTrainingTradeAsMember(USER, TT);

    expect(res).toEqual([]);
    const arg = vi.mocked(db.trainingAnnotation.findMany).mock.calls[0]![0] as {
      where: { trainingTradeId: string; trainingTrade: { is: { userId: string } } };
      orderBy: { createdAt: string };
    };
    expect(arg.where.trainingTradeId).toBe(TT);
    expect(arg.where.trainingTrade).toEqual({ is: { userId: USER } });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('maps each owned row through the serializer', async () => {
    vi.mocked(db.trainingAnnotation.findMany).mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ] as never);
    const res = await listTrainingAnnotationsForTrainingTradeAsMember(USER, TT);
    expect(res.map((r) => (r as { id: string }).id)).toEqual(['a', 'b']);
  });
});

describe('countUnseenTrainingAnnotationsByTrainingTrade (BOLA on groupBy)', () => {
  it('groups unread corrections by backtest, scoped to the owner, into a Map', async () => {
    vi.mocked(db.trainingAnnotation.groupBy).mockResolvedValue([
      { trainingTradeId: 'tt-1', _count: { _all: 2 } },
      { trainingTradeId: 'tt-2', _count: { _all: 1 } },
    ] as never);

    const res = await countUnseenTrainingAnnotationsByTrainingTrade(USER);

    expect(res).toBeInstanceOf(Map);
    expect(res.get('tt-1')).toBe(2);
    expect(res.get('tt-2')).toBe(1);
    const arg = vi.mocked(db.trainingAnnotation.groupBy).mock.calls[0]![0] as {
      by: string[];
      where: { seenByMemberAt: null; trainingTrade: { is: { userId: string } } };
    };
    expect(arg.by).toEqual(['trainingTradeId']);
    expect(arg.where.seenByMemberAt).toBeNull();
    expect(arg.where.trainingTrade).toEqual({ is: { userId: USER } });
  });

  it('returns an empty Map when nothing is unread', async () => {
    vi.mocked(db.trainingAnnotation.groupBy).mockResolvedValue([] as never);
    const res = await countUnseenTrainingAnnotationsByTrainingTrade(USER);
    expect(res.size).toBe(0);
  });
});
