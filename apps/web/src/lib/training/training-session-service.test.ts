import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    trainingSession: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { Prisma } from '@/generated/prisma/client';

import { db } from '@/lib/db';

import {
  createTrainingSession,
  endTrainingSession,
  getTrainingSessionMeta,
  getTrainingSessionWithTradesById,
  listTrainingSessionsForUser,
  serializeTrainingSession,
} from './training-session-service';

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts-1',
    memberId: 'user-1',
    label: 'Range GBPUSD janvier',
    symbol: 'GBPUSD',
    timeframe: 'H1',
    notes: 'Replay du range de janvier.',
    startedAt: new Date('2026-06-01T09:00:00.000Z'),
    endedAt: null,
    createdAt: new Date('2026-06-01T09:00:00.000Z'),
    updatedAt: new Date('2026-06-01T09:00:00.000Z'),
    ...overrides,
  };
}

function makeTradeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tt-1',
    userId: 'user-1',
    sessionId: 'ts-1',
    pair: 'GBPUSD',
    entryScreenshotKey: 'training/abcdefgh12345678/abcdefghijkl1234.jpg',
    plannedRR: new Prisma.Decimal('2.0'),
    outcome: 'win',
    resultR: new Prisma.Decimal('1.8'),
    systemRespected: true,
    lessonLearned: 'Entrée patiente.',
    enteredAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// serializeTrainingSession
// ---------------------------------------------------------------------------

describe('serializeTrainingSession', () => {
  it('maps Date→ISO, keeps nullable fields, defaults tradeCount to 0 without _count', () => {
    const s = serializeTrainingSession(makeSessionRow() as never);
    expect(s.startedAt).toBe('2026-06-01T09:00:00.000Z');
    expect(s.endedAt).toBeNull();
    expect(s.symbol).toBe('GBPUSD');
    expect(s.tradeCount).toBe(0);
  });

  it('reads tradeCount from _count when present', () => {
    const s = serializeTrainingSession({ ...makeSessionRow(), _count: { trades: 4 } } as never);
    expect(s.tradeCount).toBe(4);
  });

  it('serializes endedAt when the session is closed', () => {
    const s = serializeTrainingSession(
      makeSessionRow({ endedAt: new Date('2026-06-02T18:00:00.000Z') }) as never,
    );
    expect(s.endedAt).toBe('2026-06-02T18:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// createTrainingSession
// ---------------------------------------------------------------------------

describe('createTrainingSession', () => {
  it('maps userId→memberId and persists the optional context fields', async () => {
    vi.mocked(db.trainingSession.create).mockResolvedValue(makeSessionRow() as never);

    const result = await createTrainingSession({
      userId: 'user-1',
      label: 'Range GBPUSD janvier',
      symbol: 'GBPUSD',
      timeframe: 'H1',
      notes: 'Replay du range de janvier.',
    });

    const call = vi.mocked(db.trainingSession.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as { data: Record<string, unknown> };
    expect(arg.data.memberId).toBe('user-1');
    expect(arg.data.label).toBe('Range GBPUSD janvier');
    expect(arg.data.symbol).toBe('GBPUSD');
    expect(arg.data.timeframe).toBe('H1');
    expect(result.id).toBe('ts-1');
  });

  it('persists null context fields (a session can be just a label)', async () => {
    vi.mocked(db.trainingSession.create).mockResolvedValue(
      makeSessionRow({ symbol: null, timeframe: null, notes: null }) as never,
    );
    const result = await createTrainingSession({
      userId: 'user-1',
      label: null,
      symbol: null,
      timeframe: null,
      notes: null,
    });
    const arg = vi.mocked(db.trainingSession.create).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.symbol).toBeNull();
    expect(result.symbol).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listTrainingSessionsForUser
// ---------------------------------------------------------------------------

describe('listTrainingSessionsForUser', () => {
  it('queries memberId-scoped, newest-first by startedAt, includes the trade count', async () => {
    vi.mocked(db.trainingSession.findMany).mockResolvedValue([
      { ...makeSessionRow(), _count: { trades: 2 } },
    ] as never);

    const result = await listTrainingSessionsForUser('user-1');

    const arg = vi.mocked(db.trainingSession.findMany).mock.calls[0]![0] as {
      where: { memberId: string };
      orderBy: { startedAt: string };
      include: { _count: { select: { trades: boolean } } };
    };
    expect(arg.where).toEqual({ memberId: 'user-1' });
    expect(arg.orderBy).toEqual({ startedAt: 'desc' });
    expect(arg.include._count.select.trades).toBe(true);
    expect(result[0]?.tradeCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getTrainingSessionWithTradesById (owner-scoped, with trades)
// ---------------------------------------------------------------------------

describe('getTrainingSessionWithTradesById', () => {
  it('scopes by id AND memberId in a single query and serializes the trades', async () => {
    vi.mocked(db.trainingSession.findFirst).mockResolvedValue({
      ...makeSessionRow(),
      _count: { trades: 1 },
      trades: [makeTradeRow()],
    } as never);

    const result = await getTrainingSessionWithTradesById('ts-1', 'user-1');

    const arg = vi.mocked(db.trainingSession.findFirst).mock.calls[0]![0] as {
      where: { id: string; memberId: string };
      include: { trades: { orderBy: { enteredAt: string } } };
    };
    expect(arg.where).toEqual({ id: 'ts-1', memberId: 'user-1' });
    expect(arg.include.trades.orderBy).toEqual({ enteredAt: 'desc' });
    expect(result?.tradeCount).toBe(1);
    expect(result?.trades).toHaveLength(1);
    // trades are serialized (Decimal→string)
    expect(result?.trades[0]?.plannedRR).toBe('2');
    expect(result?.trades[0]?.resultR).toBe('1.8');
  });

  it('returns null when absent or not owned', async () => {
    vi.mocked(db.trainingSession.findFirst).mockResolvedValue(null as never);
    expect(await getTrainingSessionWithTradesById('nope', 'user-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getTrainingSessionMeta (light owner-scoped identity read)
// ---------------------------------------------------------------------------

describe('getTrainingSessionMeta', () => {
  it('selects id/label/endedAt/symbol/timeframe and derives isEnded', async () => {
    vi.mocked(db.trainingSession.findFirst).mockResolvedValue({
      id: 'ts-1',
      label: 'X',
      endedAt: null,
      symbol: 'EURUSD',
      timeframe: 'H1',
    } as never);

    const meta = await getTrainingSessionMeta('ts-1', 'user-1');

    const arg = vi.mocked(db.trainingSession.findFirst).mock.calls[0]![0] as {
      where: { id: string; memberId: string };
      select: Record<string, boolean>;
    };
    expect(arg.where).toEqual({ id: 'ts-1', memberId: 'user-1' });
    expect(Object.keys(arg.select).sort()).toEqual([
      'endedAt',
      'id',
      'label',
      'symbol',
      'timeframe',
    ]);
    expect(meta).toEqual({
      id: 'ts-1',
      label: 'X',
      isEnded: false,
      symbol: 'EURUSD',
      timeframe: 'H1',
    });
  });

  it('marks isEnded true when endedAt is set, null when not found', async () => {
    vi.mocked(db.trainingSession.findFirst).mockResolvedValueOnce({
      id: 'ts-1',
      label: null,
      endedAt: new Date('2026-06-02T00:00:00.000Z'),
      symbol: null,
      timeframe: null,
    } as never);
    expect((await getTrainingSessionMeta('ts-1', 'user-1'))?.isEnded).toBe(true);

    vi.mocked(db.trainingSession.findFirst).mockResolvedValueOnce(null as never);
    expect(await getTrainingSessionMeta('nope', 'user-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// endTrainingSession (owner-scoped updateMany, no throw on stale id)
// ---------------------------------------------------------------------------

describe('endTrainingSession', () => {
  it('updates (id, memberId) with endedAt and returns true when a row matched', async () => {
    vi.mocked(db.trainingSession.updateMany).mockResolvedValue({ count: 1 } as never);
    const now = new Date('2026-06-02T18:00:00.000Z');

    const ok = await endTrainingSession('ts-1', 'user-1', now);

    const arg = vi.mocked(db.trainingSession.updateMany).mock.calls[0]![0] as {
      where: { id: string; memberId: string };
      data: { endedAt: Date };
    };
    expect(arg.where).toEqual({ id: 'ts-1', memberId: 'user-1' });
    expect(arg.data.endedAt).toEqual(now);
    expect(ok).toBe(true);
  });

  it('returns false (not a throw) when the session is absent or not owned', async () => {
    vi.mocked(db.trainingSession.updateMany).mockResolvedValue({ count: 0 } as never);
    expect(await endTrainingSession('nope', 'user-1', new Date())).toBe(false);
  });
});
