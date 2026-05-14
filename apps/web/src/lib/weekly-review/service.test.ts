import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks must be hoisted BEFORE importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  db: {
    weeklyReview: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import {
  getWeeklyReview,
  getWeeklyReviewById,
  listMyRecentReviews,
  submitWeeklyReview,
} from './service';

// ---------------------------------------------------------------------------
// Helpers — typed mock-call introspection (defeats noUncheckedIndexedAccess)
// ---------------------------------------------------------------------------

interface UpsertArg {
  where: {
    userId_weekStart: { userId: string; weekStart: Date };
  };
  create: {
    bestPractice: string | null;
  };
}

interface FindManyArg {
  where: { userId: string };
  orderBy: { weekStart: 'asc' | 'desc' };
  take: number;
}

function firstUpsertCall(): UpsertArg {
  const call = vi.mocked(db.weeklyReview.upsert).mock.calls[0];
  if (!call) throw new Error('expected db.weeklyReview.upsert to have been called');
  return call[0] as unknown as UpsertArg;
}

function findManyCallAt(index: number): FindManyArg {
  const call = vi.mocked(db.weeklyReview.findMany).mock.calls[index];
  if (!call) throw new Error(`expected db.weeklyReview.findMany call #${index}`);
  return call[0] as unknown as FindManyArg;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validInput = {
  weekStart: '2026-05-04', // Monday
  biggestWin: 'Closed at TP per plan despite tempting trail.',
  biggestMistake: 'Skipped pre-trade checklist on Tuesday London open.',
  bestPractice: 'Held my hedge rule even when down -0.5R on the hour.',
  lessonLearned: 'Trust the plan; the checklist is the plan.',
  nextWeekFocus: 'Run the full checklist before EVERY trade entry.',
};

function makeDbRow(
  overrides: Partial<{
    id: string;
    userId: string;
    weekStart: Date;
    weekEnd: Date;
    bestPractice: string | null;
  }> = {},
) {
  // Note: spread `overrides` LAST so an explicit `bestPractice: null` wins
  // over the default — `??` would coalesce null back to the default.
  return {
    id: 'rev-1',
    userId: 'user-1',
    weekStart: new Date('2026-05-04T00:00:00Z'),
    weekEnd: new Date('2026-05-10T00:00:00Z'),
    biggestWin: validInput.biggestWin,
    biggestMistake: validInput.biggestMistake,
    bestPractice: validInput.bestPractice as string | null,
    lessonLearned: validInput.lessonLearned,
    nextWeekFocus: validInput.nextWeekFocus,
    submittedAt: new Date('2026-05-10T10:00:00Z'),
    createdAt: new Date('2026-05-10T10:00:00Z'),
    updatedAt: new Date('2026-05-10T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('submitWeeklyReview', () => {
  it('upserts on (userId, weekStart) and reports wasNew=true on create', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.weeklyReview.upsert).mockResolvedValue(makeDbRow() as never);

    const result = await submitWeeklyReview('user-1', validInput);

    expect(db.weeklyReview.upsert).toHaveBeenCalledOnce();
    const upsertArg = firstUpsertCall();
    expect(upsertArg.where.userId_weekStart.userId).toBe('user-1');
    expect(upsertArg.where.userId_weekStart.weekStart.toISOString().slice(0, 10)).toBe(
      '2026-05-04',
    );
    expect(result.wasNew).toBe(true);
    expect(result.review.weekStart).toBe('2026-05-04');
    expect(result.review.weekEnd).toBe('2026-05-10'); // Sunday after Monday
  });

  it('reports wasNew=false when row already exists', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue({ id: 'existing-rev' } as never);
    vi.mocked(db.weeklyReview.upsert).mockResolvedValue(makeDbRow() as never);

    const result = await submitWeeklyReview('user-1', validInput);

    expect(result.wasNew).toBe(false);
  });

  it('persists bestPractice=null when omitted', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.weeklyReview.upsert).mockResolvedValue(makeDbRow({ bestPractice: null }) as never);

    const { bestPractice: _bp, ...rest } = validInput;
    void _bp;
    const result = await submitWeeklyReview('user-1', { ...rest, bestPractice: null } as never);

    const upsertArg = firstUpsertCall();
    expect(upsertArg.create.bestPractice).toBeNull();
    expect(result.review.bestPractice).toBeNull();
  });
});

describe('getWeeklyReview', () => {
  it('returns null when row is absent', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue(null as never);
    const result = await getWeeklyReview('user-1', '2026-05-04');
    expect(result).toBeNull();
  });

  it('serializes a found row to YYYY-MM-DD dates', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue(makeDbRow() as never);
    const result = await getWeeklyReview('user-1', '2026-05-04');
    expect(result?.weekStart).toBe('2026-05-04');
    expect(result?.weekEnd).toBe('2026-05-10');
    expect(result?.submittedAt).toMatch(/^2026-05-10T/);
  });
});

describe('getWeeklyReviewById (V1.8 polish — BOLA defence)', () => {
  it('returns null on empty id', async () => {
    expect(await getWeeklyReviewById('user-1', '')).toBeNull();
  });

  it('returns null on oversized id (>64 chars)', async () => {
    const oversized = 'x'.repeat(65);
    expect(await getWeeklyReviewById('user-1', oversized)).toBeNull();
    expect(db.weeklyReview.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when row belongs to a different user', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue(
      makeDbRow({ userId: 'attacker' }) as never,
    );
    const result = await getWeeklyReviewById('user-1', 'rev-stolen');
    expect(result).toBeNull();
  });

  it('returns the serialized row when ownership matches', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue(
      makeDbRow({ userId: 'user-1' }) as never,
    );
    const result = await getWeeklyReviewById('user-1', 'rev-1');
    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-1');
    expect(result?.weekStart).toBe('2026-05-04');
  });

  it('returns null when row absent (P2025 / no match)', async () => {
    vi.mocked(db.weeklyReview.findUnique).mockResolvedValue(null as never);
    expect(await getWeeklyReviewById('user-1', 'rev-absent')).toBeNull();
  });
});

describe('listMyRecentReviews', () => {
  it('queries with weekStart desc and applies limit', async () => {
    vi.mocked(db.weeklyReview.findMany).mockResolvedValue([makeDbRow()] as never);
    await listMyRecentReviews('user-1', 5);

    const callArg = findManyCallAt(0);
    expect(callArg.where).toEqual({ userId: 'user-1' });
    expect(callArg.orderBy).toEqual({ weekStart: 'desc' });
    expect(callArg.take).toBe(5);
  });

  it('clamps limit to the 1..52 window', async () => {
    vi.mocked(db.weeklyReview.findMany).mockResolvedValue([] as never);

    await listMyRecentReviews('user-1', 0);
    expect(findManyCallAt(0).take).toBe(1);

    vi.mocked(db.weeklyReview.findMany).mockResolvedValue([] as never);
    await listMyRecentReviews('user-1', 999);
    expect(findManyCallAt(1).take).toBe(52);
  });
});
