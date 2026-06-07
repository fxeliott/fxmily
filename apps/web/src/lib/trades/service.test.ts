/**
 * Trade journal service tests (Prisma-mocked).
 *
 * SPEC §28/§21 — `processComplete` ("oublis" axis: did the member follow ALL
 * their process at close, without forgetting steps?) end-to-end through the
 * service `closeTrade` path: it is PERSISTED (lands in the `tx.trade.update`
 * data payload) and PROJECTED (surfaces on the returned `SerializedTrade`).
 * Tri-state passthrough: true / false / null. SPEC §2 — a binary ACT only; the
 * service never advises on the trade. Exact carbon-copy of the `emotionDuring`
 * (PR #236) + `formationFollowed` service-test precedents.
 */

import { Prisma } from '@/generated/prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared spy for the storage adapter's `delete` (AX1-F1 sweep). `vi.hoisted`
// lets the `vi.mock` factory reference it despite hoisting.
const { storageDelete } = vi.hoisted(() => ({ storageDelete: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    trade: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/storage', () => ({
  selectStorage: () => ({ delete: storageDelete }),
}));

import { db } from '@/lib/db';

import { closeTrade, deleteTrade, type CloseTradeInput } from './service';

/** A realistic post-Zod close input (the schema already collapsed the form). */
function closeInput(processComplete: boolean | null): CloseTradeInput {
  return {
    exitedAt: new Date('2026-06-05T11:00:00.000Z'),
    exitPrice: 1.105,
    outcome: 'win',
    emotionDuring: ['calm'],
    emotionAfter: ['confident'],
    processComplete,
    tags: [],
    notes: undefined,
    screenshotExitKey: 'trades/clx0abc1234/fedcba9876543210fedcba9876543210.png',
  };
}

/** The open trade row `tx.trade.findUnique` reads back before the update. */
function openExisting() {
  return {
    id: 'trade-1',
    userId: 'user-1',
    direction: 'long' as const,
    entryPrice: new Prisma.Decimal(1.1),
    stopLossPrice: new Prisma.Decimal(1.095),
    plannedRR: new Prisma.Decimal(2),
    closedAt: null,
    notes: null,
  };
}

/** The closed trade row `tx.trade.update` resolves to (mirror DB read-back). */
function closedRow(processComplete: boolean | null) {
  const now = new Date('2026-06-05T11:00:00.000Z');
  return {
    id: 'trade-1',
    userId: 'user-1',
    pair: 'EURUSD',
    direction: 'long' as const,
    session: 'london' as const,
    enteredAt: new Date('2026-06-05T08:00:00.000Z'),
    entryPrice: new Prisma.Decimal(1.1),
    lotSize: new Prisma.Decimal(0.5),
    stopLossPrice: new Prisma.Decimal(1.095),
    plannedRR: new Prisma.Decimal(2),
    tradeQuality: null,
    riskPct: null,
    emotionBefore: ['focused'] as string[],
    planRespected: true,
    hedgeRespected: null,
    processComplete,
    notes: null,
    screenshotEntryKey: 'trades/clx0abc1234/abcdef0123456789abcdef0123456789.jpg',
    exitedAt: now,
    exitPrice: new Prisma.Decimal(1.105),
    outcome: 'win' as const,
    realizedR: new Prisma.Decimal(1),
    realizedRSource: 'computed' as const,
    emotionDuring: ['calm'] as string[],
    emotionAfter: ['confident'] as string[],
    tags: [] as string[],
    screenshotExitKey: 'trades/clx0abc1234/fedcba9876543210fedcba9876543210.png',
    closedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Wire the mocked `$transaction` to run the callback against a fake `tx` whose
 * `trade.findUnique` returns an open trade and `trade.update` returns the
 * closed row, capturing the `update` arg for assertions.
 */
function wireTransaction(processComplete: boolean | null) {
  const updateMock = vi.fn().mockResolvedValue(closedRow(processComplete));
  vi.mocked(db.$transaction).mockImplementation(async (cb: unknown) => {
    const tx = {
      trade: {
        findUnique: vi.fn().mockResolvedValue(openExisting()),
        update: updateMock,
      },
    };
    return (cb as (t: typeof tx) => Promise<unknown>)(tx);
  });
  return updateMock;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('closeTrade — processComplete ("oublis" axis, SPEC §28/§21)', () => {
  it('PERSISTS processComplete=true in the update payload', async () => {
    const updateMock = wireTransaction(true);

    await closeTrade('user-1', 'trade-1', closeInput(true));

    const call = updateMock.mock.calls[0];
    if (!call) throw new Error('expected tx.trade.update to be called');
    const arg = call[0] as { data: { processComplete: boolean | null } };
    expect(arg.data.processComplete).toBe(true);
  });

  it('PERSISTS processComplete=false (forgot/missed steps) in the update payload', async () => {
    const updateMock = wireTransaction(false);

    await closeTrade('user-1', 'trade-1', closeInput(false));

    const call = updateMock.mock.calls[0];
    if (!call) throw new Error('expected tx.trade.update to be called');
    const arg = call[0] as { data: { processComplete: boolean | null } };
    expect(arg.data.processComplete).toBe(false);
  });

  it('passes null through unchanged (not answered — never coerced to false)', async () => {
    const updateMock = wireTransaction(null);

    await closeTrade('user-1', 'trade-1', closeInput(null));

    const call = updateMock.mock.calls[0];
    if (!call) throw new Error('expected tx.trade.update to be called');
    const arg = call[0] as { data: { processComplete: boolean | null } };
    // Explicit null — never coerced to false (which would fabricate a "forgot"
    // signal the member never gave). Mirrors hedgeRespected / marketAnalysisDone.
    expect(arg.data.processComplete).toBeNull();
  });

  it('PROJECTS processComplete onto the SerializedTrade (true / false / null)', async () => {
    for (const value of [true, false, null] as const) {
      wireTransaction(value);
      const serialized = await closeTrade('user-1', 'trade-1', closeInput(value));
      expect(serialized.processComplete).toBe(value);
    }
  });
});

describe('deleteTrade — storage sweep (AX1-F1, RGPD §17)', () => {
  it('best-effort deletes the trade row + every attached media key (entry, exit, annotations), skipping nulls', async () => {
    storageDelete.mockResolvedValue(undefined);
    vi.mocked(db.trade.findFirst).mockResolvedValue({
      screenshotEntryKey: 'trades/user-1/entry.png',
      screenshotExitKey: 'trades/user-1/exit.png',
      annotations: [{ mediaKey: 'annotations/trade-1/a.png' }, { mediaKey: null }],
    } as never);
    vi.mocked(db.trade.deleteMany).mockResolvedValue({ count: 1 } as never);

    await deleteTrade('user-1', 'trade-1');

    // Ownership-scoped read + delete (defense in depth).
    expect(db.trade.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trade-1', userId: 'user-1' } }),
    );
    expect(db.trade.deleteMany).toHaveBeenCalledWith({
      where: { id: 'trade-1', userId: 'user-1' },
    });
    // Entry + exit + the non-null annotation media = 3 ; the null mediaKey is skipped.
    expect(storageDelete).toHaveBeenCalledTimes(3);
    expect(storageDelete).toHaveBeenCalledWith('trades/user-1/entry.png');
    expect(storageDelete).toHaveBeenCalledWith('trades/user-1/exit.png');
    expect(storageDelete).toHaveBeenCalledWith('annotations/trade-1/a.png');
  });

  it('throws TradeNotFoundError and never touches storage when the trade is absent / not owned', async () => {
    storageDelete.mockResolvedValue(undefined);
    vi.mocked(db.trade.findFirst).mockResolvedValue(null as never);

    await expect(deleteTrade('user-1', 'missing')).rejects.toThrow();
    expect(db.trade.deleteMany).not.toHaveBeenCalled();
    expect(storageDelete).not.toHaveBeenCalled();
  });
});
