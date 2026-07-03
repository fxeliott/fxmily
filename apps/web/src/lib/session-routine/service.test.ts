import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * S24 + pré-trade branch — `getSessionRoutine` unit test. The pure phase math is
 * covered in `phase.test.ts`; here we mock the DB singleton and the read-only
 * pre-trade helper to assert the DAY-STATUS derivation: trade counts / window /
 * SL / open position, AND that the member's own-day pre-trade prep is threaded
 * onto `day.preTradeToday` via `getTodayPreTradeStatus` (F2 timezone honoured).
 *
 * Mock BOTH before importing the SUT (Prisma is lazy; the pre-trade helper is a
 * read-only reuse we stub to keep this test a pure unit). Pattern carbone
 * `lib/pre-trade/service.test.ts`.
 */
const tradeFindManyMock = vi.fn();
const tradeCountMock = vi.fn();
const getTodayPreTradeStatusMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    trade: {
      findMany: tradeFindManyMock,
      count: tradeCountMock,
    },
  },
}));

vi.mock('@/lib/pre-trade/service', () => ({
  getTodayPreTradeStatus: getTodayPreTradeStatusMock,
}));

const { getSessionRoutine } = await import('./service');

afterEach(() => {
  tradeFindManyMock.mockReset();
  tradeCountMock.mockReset();
  getTodayPreTradeStatusMock.mockReset();
});

/** Paris 14:30 (summer, UTC+2) → phase = execution, inside the 13h–16h window. */
const NOW_EXEC = new Date('2026-06-15T12:30:00.000Z');

function primeTradesEmpty(): void {
  tradeFindManyMock.mockResolvedValueOnce([]);
  tradeCountMock.mockResolvedValueOnce(0);
}

describe('getSessionRoutine — pre-trade branch', () => {
  it('threads getTodayPreTradeStatus onto day.preTradeToday (done + at)', async () => {
    primeTradesEmpty();
    getTodayPreTradeStatusMock.mockResolvedValueOnce({
      done: true,
      at: '2026-06-15T11:05:00.000Z',
    });

    const routine = await getSessionRoutine('user_1', NOW_EXEC, 'Europe/Paris');

    expect(routine.day.preTradeToday).toEqual({
      done: true,
      at: '2026-06-15T11:05:00.000Z',
    });
  });

  it('reflects a NOT-done pre-trade as { done:false, at:null }', async () => {
    primeTradesEmpty();
    getTodayPreTradeStatusMock.mockResolvedValueOnce({ done: false, at: null });

    const routine = await getSessionRoutine('user_1', NOW_EXEC, 'Europe/Paris');

    expect(routine.day.preTradeToday).toEqual({ done: false, at: null });
  });

  it('passes the member timezone (F2) to the pre-trade helper, not Paris', async () => {
    primeTradesEmpty();
    getTodayPreTradeStatusMock.mockResolvedValueOnce({ done: false, at: null });

    await getSessionRoutine('user_1', NOW_EXEC, 'Pacific/Kiritimati');

    expect(getTodayPreTradeStatusMock).toHaveBeenCalledWith(
      'user_1',
      'Pacific/Kiritimati',
      NOW_EXEC,
    );
  });

  it('defaults the pre-trade timezone to Europe/Paris when the caller omits it', async () => {
    primeTradesEmpty();
    getTodayPreTradeStatusMock.mockResolvedValueOnce({ done: false, at: null });

    await getSessionRoutine('user_1', NOW_EXEC);

    expect(getTodayPreTradeStatusMock).toHaveBeenCalledWith('user_1', 'Europe/Paris', NOW_EXEC);
  });

  it('scopes the pre-trade read to the SAME user (no cross-user leak)', async () => {
    primeTradesEmpty();
    getTodayPreTradeStatusMock.mockResolvedValueOnce({ done: false, at: null });

    await getSessionRoutine('user_OWNER', NOW_EXEC, 'Europe/Paris');

    expect(getTodayPreTradeStatusMock.mock.calls[0]?.[0]).toBe('user_OWNER');
  });
});

describe('getSessionRoutine — trade day facts (unchanged, regression guard)', () => {
  it('counts a today trade entered inside the window, no SL, no open position', async () => {
    // Paris 14:30 entry (inside 13h–16h), closed as a win → not counted as SL.
    tradeFindManyMock.mockResolvedValueOnce([
      {
        enteredAt: new Date('2026-06-15T12:30:00.000Z'),
        outcome: 'win',
        closedAt: new Date('2026-06-15T13:00:00.000Z'),
      },
    ]);
    tradeCountMock.mockResolvedValueOnce(0);
    getTodayPreTradeStatusMock.mockResolvedValueOnce({ done: false, at: null });

    const routine = await getSessionRoutine('user_1', NOW_EXEC, 'Europe/Paris');

    expect(routine.phase).toBe('execution');
    expect(routine.day.tradesEnteredToday).toBe(1);
    expect(routine.day.enteredOutsideWindow).toBe(0);
    expect(routine.day.lossToday).toBe(false);
    expect(routine.day.hasOpenPosition).toBe(false);
  });

  it('flags a loss taken today (the method SL) and an open position', async () => {
    tradeFindManyMock.mockResolvedValueOnce([
      {
        // Paris 09:30 → OUTSIDE the 13h–16h window.
        enteredAt: new Date('2026-06-15T07:30:00.000Z'),
        outcome: 'loss',
        closedAt: new Date('2026-06-15T08:00:00.000Z'),
      },
    ]);
    tradeCountMock.mockResolvedValueOnce(2);
    getTodayPreTradeStatusMock.mockResolvedValueOnce({ done: false, at: null });

    const routine = await getSessionRoutine('user_1', NOW_EXEC, 'Europe/Paris');

    expect(routine.day.tradesEnteredToday).toBe(1);
    expect(routine.day.enteredOutsideWindow).toBe(1);
    expect(routine.day.lossToday).toBe(true);
    expect(routine.day.hasOpenPosition).toBe(true);
  });

  it('ignores trades entered on a PREVIOUS Paris civil day', async () => {
    tradeFindManyMock.mockResolvedValueOnce([
      {
        // 2026-06-14 22:00 Paris → yesterday, must not count.
        enteredAt: new Date('2026-06-14T20:00:00.000Z'),
        outcome: 'win',
        closedAt: new Date('2026-06-14T21:00:00.000Z'),
      },
    ]);
    tradeCountMock.mockResolvedValueOnce(0);
    getTodayPreTradeStatusMock.mockResolvedValueOnce({ done: false, at: null });

    const routine = await getSessionRoutine('user_1', NOW_EXEC, 'Europe/Paris');

    expect(routine.day.tradesEnteredToday).toBe(0);
    expect(routine.day.lossToday).toBe(false);
  });
});
