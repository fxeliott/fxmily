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

import {
  closeTrade,
  deleteTrade,
  TradeAlreadyClosedError,
  TradeExitBeforeEntryError,
  type CloseTradeInput,
} from './service';

/** A realistic post-Zod close input (the schema already collapsed the form). */
function closeInput(
  processComplete: boolean | null,
  management: Partial<Pick<CloseTradeInput, 'slPerRule' | 'movedToBe' | 'partialAtTarget'>> = {},
): CloseTradeInput {
  return {
    exitedAt: new Date('2026-06-05T11:00:00.000Z'),
    exitPrice: 1.105,
    outcome: 'win',
    // Tour 10 — factual exit nature (default: not answered).
    exitReason: null,
    emotionDuring: ['calm'],
    emotionAfter: ['confident'],
    processComplete,
    // S26 — management-fidelity acts (default: not answered).
    slPerRule: management.slPerRule ?? null,
    movedToBe: management.movedToBe ?? null,
    partialAtTarget: management.partialAtTarget ?? null,
    tags: [],
    notes: undefined,
    // J1 — mandatory TradingView exit link (replaces the exit screenshot).
    tradingViewExitUrl: 'https://www.tradingview.com/x/exit9876/',
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
    enteredAt: new Date('2026-06-05T08:00:00.000Z'),
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
    slPerRule: null,
    movedToBe: null,
    partialAtTarget: null,
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

describe('closeTrade — exit-after-entry invariant (S2 audit 2026-06-11)', () => {
  it('throws TradeExitBeforeEntryError when exitedAt precedes enteredAt', async () => {
    wireTransaction(null);
    const input = {
      ...closeInput(null),
      // entry mock is 2026-06-05T08:00Z — one hour BEFORE.
      exitedAt: new Date('2026-06-05T07:00:00.000Z'),
    };
    await expect(closeTrade('user-1', 'trade-1', input)).rejects.toBeInstanceOf(
      TradeExitBeforeEntryError,
    );
  });

  it('accepts an exit at exactly the entry instant (0-duration edge)', async () => {
    const updateMock = wireTransaction(null);
    const input = {
      ...closeInput(null),
      exitedAt: new Date('2026-06-05T08:00:00.000Z'),
    };
    await closeTrade('user-1', 'trade-1', input);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});

describe('closeTrade — double-close optimistic guard (RC#7 TX-1)', () => {
  it('scopes the UPDATE with `closedAt: null` so a concurrent close cannot clobber it', async () => {
    const updateMock = wireTransaction(null);
    await closeTrade('user-1', 'trade-1', closeInput(null));
    const call = updateMock.mock.calls[0];
    if (!call) throw new Error('expected tx.trade.update to be called');
    const arg = call[0] as { where: Record<string, unknown> };
    // The `closedAt: null` predicate is the optimistic lock: under READ
    // COMMITTED the findUnique took no row lock, so only this WHERE stops a
    // duplicate submit from overwriting the authoritative close.
    expect(arg.where).toEqual({ id: 'trade-1', closedAt: null });
  });

  it('🚨 RACE — the UPDATE matches 0 rows (P2025) because a concurrent close won → TradeAlreadyClosedError, not a silent clobber', async () => {
    // A duplicate submit: both transactions read closedAt=null, the first
    // commits, the second's guarded UPDATE finds 0 rows → Prisma P2025. The
    // service must fold it to the same already-closed error, never overwrite.
    vi.mocked(db.$transaction).mockImplementation(async (cb: unknown) => {
      const tx = {
        trade: {
          findUnique: vi.fn().mockResolvedValue(openExisting()),
          update: vi.fn().mockRejectedValue({ code: 'P2025' }),
        },
      };
      return (cb as (t: typeof tx) => Promise<unknown>)(tx);
    });
    await expect(closeTrade('user-1', 'trade-1', closeInput(null))).rejects.toBeInstanceOf(
      TradeAlreadyClosedError,
    );
  });

  it('a non-P2025 DB error during the close UPDATE still bubbles up (never swallowed)', async () => {
    vi.mocked(db.$transaction).mockImplementation(async (cb: unknown) => {
      const tx = {
        trade: {
          findUnique: vi.fn().mockResolvedValue(openExisting()),
          update: vi.fn().mockRejectedValue(new Error('connection reset')),
        },
      };
      return (cb as (t: typeof tx) => Promise<unknown>)(tx);
    });
    await expect(closeTrade('user-1', 'trade-1', closeInput(null))).rejects.toThrow(
      'connection reset',
    );
  });
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

describe('closeTrade — S26 management-fidelity acts (SPEC §2: the ACT only)', () => {
  it('PERSISTS the 3 management acts verbatim in the update payload', async () => {
    const updateMock = wireTransaction(null);

    await closeTrade(
      'user-1',
      'trade-1',
      closeInput(null, { slPerRule: true, movedToBe: false, partialAtTarget: true }),
    );

    const call = updateMock.mock.calls[0];
    if (!call) throw new Error('expected tx.trade.update to be called');
    const arg = call[0] as {
      data: {
        slPerRule: boolean | null;
        movedToBe: boolean | null;
        partialAtTarget: boolean | null;
      };
    };
    expect(arg.data.slPerRule).toBe(true);
    expect(arg.data.movedToBe).toBe(false);
    expect(arg.data.partialAtTarget).toBe(true);
  });

  it('passes null through unchanged (not answered — never coerced to false)', async () => {
    const updateMock = wireTransaction(null);

    await closeTrade('user-1', 'trade-1', closeInput(null));

    const call = updateMock.mock.calls[0];
    if (!call) throw new Error('expected tx.trade.update to be called');
    const arg = call[0] as {
      data: {
        slPerRule: boolean | null;
        movedToBe: boolean | null;
        partialAtTarget: boolean | null;
      };
    };
    // Identical null-passthrough to processComplete: an unanswered act is never
    // fabricated into a "rule broken" signal the member never gave.
    expect(arg.data.slPerRule).toBeNull();
    expect(arg.data.movedToBe).toBeNull();
    expect(arg.data.partialAtTarget).toBeNull();
  });
});

describe('deleteTrade — storage sweep (AX1-F1, RGPD §17)', () => {
  it('best-effort deletes the trade row + every attached media key (entry, exit, annotations, §31 photos), skipping nulls', async () => {
    storageDelete.mockResolvedValue(undefined);
    vi.mocked(db.trade.findFirst).mockResolvedValue({
      screenshotEntryKey: 'trades/user-1/entry.png',
      screenshotExitKey: 'trades/user-1/exit.png',
      annotations: [{ mediaKey: 'annotations/trade-1/a.png' }, { mediaKey: null }],
      // §31 — additional entry photos must sweep too (RGPD §17).
      media: [{ fileKey: 'trades/user-1/extra1.png' }, { fileKey: 'trades/user-1/extra2.png' }],
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
    // Entry + exit + 1 annotation + 2 §31 photos = 5 ; the null mediaKey is skipped.
    expect(storageDelete).toHaveBeenCalledTimes(5);
    expect(storageDelete).toHaveBeenCalledWith('trades/user-1/entry.png');
    expect(storageDelete).toHaveBeenCalledWith('trades/user-1/exit.png');
    expect(storageDelete).toHaveBeenCalledWith('annotations/trade-1/a.png');
    expect(storageDelete).toHaveBeenCalledWith('trades/user-1/extra1.png');
    expect(storageDelete).toHaveBeenCalledWith('trades/user-1/extra2.png');
  });

  it('throws TradeNotFoundError and never touches storage when the trade is absent / not owned', async () => {
    storageDelete.mockResolvedValue(undefined);
    vi.mocked(db.trade.findFirst).mockResolvedValue(null as never);

    await expect(deleteTrade('user-1', 'missing')).rejects.toThrow();
    expect(db.trade.deleteMany).not.toHaveBeenCalled();
    expect(storageDelete).not.toHaveBeenCalled();
  });
});
