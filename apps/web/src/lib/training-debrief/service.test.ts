import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.3 / S8 verif-layer — `lib/training-debrief/service.ts` tests.
 *
 * 🚨 §21.5 (BLOCKING) — `loadTrainingDebriefStats` is the ONLY §21.5-sensitive
 * read outside the count-only primitive: it `findMany`s `db.trainingTrade`
 * directly. Block F only greps the SOURCE for the safe `select`; this suite
 * pins it at RUNTIME (twin of `countRecentTrainingActivity`'s runtime test) so
 * a dynamically-built select or a future regression that leaks resultR/outcome
 * is caught by an executing assertion, not just a string match.
 *
 * `parseLocalDate` + `./stats` are kept REAL (pure, no IO); only `@/lib/db` is
 * mocked.
 */

vi.mock('@/lib/db', () => ({
  db: {
    trainingTrade: { findMany: vi.fn() },
    trainingAnnotation: { count: vi.fn() },
    trainingDebrief: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';

import { loadTrainingDebriefStats, submitTrainingDebrief } from './service';

const WEEK_START = '2026-05-04'; // a Monday; loadTrainingDebriefStats doesn't re-validate

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadTrainingDebriefStats (§21.5 safe projection, runtime-pinned)', () => {
  it('selects ONLY the 5 safe columns — never resultR/outcome/plannedRR', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);

    await loadTrainingDebriefStats('user-1', WEEK_START);

    const call = vi.mocked(db.trainingTrade.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as {
      where: { userId: string; enteredAt: { gte: Date; lte: Date } };
      select: Record<string, unknown>;
    };

    expect(arg.where.userId).toBe('user-1');
    // 🚨 §21.5 — the projection is EXACTLY these 5 keys, none of them a P&L col.
    expect(Object.keys(arg.select).sort()).toEqual(
      ['enteredAt', 'id', 'lessonLearned', 'pair', 'systemRespected'].sort(),
    );
    expect(arg.select).not.toHaveProperty('resultR');
    expect(arg.select).not.toHaveProperty('outcome');
    expect(arg.select).not.toHaveProperty('plannedRR');
  });

  it('fetches the asymmetric [weekStart-1d, weekStart+8d] UTC window', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);

    await loadTrainingDebriefStats('user-1', WEEK_START);

    const arg = vi.mocked(db.trainingTrade.findMany).mock.calls[0]![0] as {
      where: { enteredAt: { gte: Date; lte: Date } };
    };
    const base = parseLocalDate(WEEK_START);
    const expectFrom = new Date(base);
    expectFrom.setUTCDate(expectFrom.getUTCDate() - 1);
    const expectTo = new Date(base);
    expectTo.setUTCDate(expectTo.getUTCDate() + 8);
    expect(arg.where.enteredAt.gte).toEqual(expectFrom);
    expect(arg.where.enteredAt.lte).toEqual(expectTo);
  });

  it('rolls up annotations with a BARE count (never findMany of comments/P&L)', async () => {
    // One in-week backtest → the annotation rollup must be a count on its id.
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([
      {
        id: 'tt-1',
        enteredAt: new Date('2026-05-06T12:00:00.000Z'), // Wednesday, inside the Paris week
        pair: 'EURUSD',
        systemRespected: true,
        lessonLearned: 'ok',
      },
    ] as never);
    vi.mocked(db.trainingAnnotation.count).mockResolvedValue(2 as never);

    await loadTrainingDebriefStats('user-1', WEEK_START);

    expect(db.trainingAnnotation.count).toHaveBeenCalledTimes(1);
    const countArg = vi.mocked(db.trainingAnnotation.count).mock.calls[0]![0] as {
      where: { trainingTradeId: { in: string[] } };
    };
    expect(countArg.where.trainingTradeId.in).toContain('tt-1');
  });

  it('skips the annotation query entirely when no backtest is in-week', async () => {
    vi.mocked(db.trainingTrade.findMany).mockResolvedValue([] as never);
    await loadTrainingDebriefStats('user-1', WEEK_START);
    expect(db.trainingAnnotation.count).not.toHaveBeenCalled();
  });
});

describe('submitTrainingDebrief (upsert + wasNew)', () => {
  const INPUT = {
    weekStart: WEEK_START,
    processStrengthOne: 'a'.repeat(12),
    processStrengthTwo: 'b'.repeat(12),
    microAdjustment: 'c'.repeat(12),
    transversalLesson: 'd'.repeat(12),
  };

  function upsertRow() {
    return {
      id: 'td-1',
      userId: 'user-1',
      weekStart: parseLocalDate(WEEK_START),
      processStrengthOne: INPUT.processStrengthOne,
      processStrengthTwo: INPUT.processStrengthTwo,
      microAdjustment: INPUT.microAdjustment,
      transversalLesson: INPUT.transversalLesson,
      submittedAt: new Date('2026-05-11T10:00:00.000Z'),
      createdAt: new Date('2026-05-11T10:00:00.000Z'),
      updatedAt: new Date('2026-05-11T10:00:00.000Z'),
    };
  }

  it('wasNew=true when the row did not exist (create branch)', async () => {
    vi.mocked(db.trainingDebrief.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.trainingDebrief.upsert).mockResolvedValue(upsertRow() as never);

    const res = await submitTrainingDebrief('user-1', INPUT);

    expect(res.wasNew).toBe(true);
    expect(res.debrief.weekStart).toBe(WEEK_START);
    const upsertArg = vi.mocked(db.trainingDebrief.upsert).mock.calls[0]![0] as {
      where: { userId_weekStart: { userId: string } };
    };
    expect(upsertArg.where.userId_weekStart.userId).toBe('user-1');
  });

  it('wasNew=false when the row already existed (update branch)', async () => {
    vi.mocked(db.trainingDebrief.findUnique).mockResolvedValue({ id: 'td-1' } as never);
    vi.mocked(db.trainingDebrief.upsert).mockResolvedValue(upsertRow() as never);

    const res = await submitTrainingDebrief('user-1', INPUT);
    expect(res.wasNew).toBe(false);
  });
});
