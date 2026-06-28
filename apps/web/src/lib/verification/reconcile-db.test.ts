import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3 §32-e — DB orchestration of the reconciliation engine (`reconcileOneMember`
 * via the exported `reconcileAllMembers`). The PURE core is covered by
 * `reconcile.test.ts`; this file proves the subtlest DB branches that nothing
 * else exercises deterministically — and that a regression there would silently
 * re-introduce a false accusation (exactly what §33.6 forbids):
 *   - MISMATCH      → Discrepancy(mismatch, sev1) + ScoreEvent(reality_gap) + trade flag
 *   - RETRACTION    → reality confirms a trade → stale accusations auto-resolved
 *   - UNCOVERED     → state reset (unmatched / verifiedAt null / self_declared), NO gap
 *   - DEDUP re-run  → an already-materialised gap is never duplicated
 *
 * Mock strategy mirrors `service.test.ts`: `@/lib/db` is mocked so the branching
 * logic is exercised without Postgres (the real-DB path is proven end-to-end by
 * `session10-anti-mensonge-chain.spec.ts`).
 */

const m = vi.hoisted(() => ({
  brokerAccountFindMany: vi.fn(),
  tradeFindMany: vi.fn(),
  tradeUpdate: vi.fn(),
  positionFindMany: vi.fn(),
  discrepancyFindMany: vi.fn(),
  discrepancyCreate: vi.fn(),
  discrepancyUpdateMany: vi.fn(),
  scoreEventCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    brokerAccount: { findMany: m.brokerAccountFindMany },
    trade: { findMany: m.tradeFindMany, update: m.tradeUpdate },
    extractedPosition: { findMany: m.positionFindMany },
    discrepancy: {
      findMany: m.discrepancyFindMany,
      create: m.discrepancyCreate,
      updateMany: m.discrepancyUpdateMany,
    },
    scoreEvent: { create: m.scoreEventCreate },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));

import { reconcileAllMembers } from './reconcile';

const T0 = new Date('2026-06-02T09:15:00.000Z');
const NOW = new Date('2026-06-03T11:30:00.000Z');
const H = 3_600_000;

function trade(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    pair: 'EURUSD',
    direction: 'long',
    enteredAt: T0,
    exitedAt: new Date(T0.getTime() + H), // closed
    lotSize: 0.5,
    matchStatus: null,
    ...over,
  };
}
function position(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    symbol: 'EURUSD',
    side: 'long',
    openTime: new Date(T0.getTime() + 5 * 60_000),
    volume: 0.5,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.brokerAccountFindMany.mockResolvedValue([{ memberId: 'mem1' }]);
  m.discrepancyFindMany.mockResolvedValue([]);
  m.discrepancyCreate.mockResolvedValue({ id: 'disc-new' });
  m.discrepancyUpdateMany.mockResolvedValue({ count: 0 });
  m.tradeUpdate.mockResolvedValue({});
  m.scoreEventCreate.mockResolvedValue({});
});

describe('reconcileAllMembers — DB orchestration (§32-e)', () => {
  it('🚨 MISMATCH — volume diverge → Discrepancy(mismatch,sev1) + ScoreEvent(reality_gap) + flag', async () => {
    m.tradeFindMany.mockResolvedValue([trade({ lotSize: 0.5 })]);
    m.positionFindMany.mockResolvedValue([position({ volume: 1.0 })]); // +100% → mismatch

    const r = await reconcileAllMembers({ now: NOW });

    expect(r.tradesMismatched).toBe(1);
    expect(r.discrepanciesCreated).toBe(1);
    expect(m.discrepancyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'mismatch',
          declaredTradeId: 't1',
          extractedPositionId: 'p1',
          severity: 1,
        }),
      }),
    );
    expect(m.scoreEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'reality_gap' }) }),
    );
    expect(m.tradeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ matchStatus: 'mismatch' }),
      }),
    );
  });

  it('🚨 RETRACTION — reality confirms the trade → stale accusations auto-resolved', async () => {
    // The proof arrived late and matches: a previous run had flagged this trade.
    m.tradeFindMany.mockResolvedValue([trade({ matchStatus: 'unmatched' })]);
    m.positionFindMany.mockResolvedValue([position({ volume: 0.5 })]); // exact → matched
    m.discrepancyUpdateMany.mockResolvedValue({ count: 1 }); // a stale gap existed

    await reconcileAllMembers({ now: NOW });

    expect(m.tradeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchStatus: 'matched', source: 'mt5_verified' }),
      }),
    );
    expect(m.discrepancyUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'resolved' } }),
    );
    // A confirmed trade NEVER creates a new gap.
    expect(m.discrepancyCreate).not.toHaveBeenCalled();
  });

  it('🚨 UNCOVERED — no proof window → state reset, NEVER a false accusation', async () => {
    m.tradeFindMany.mockResolvedValue([trade({ matchStatus: 'matched' })]);
    m.positionFindMany.mockResolvedValue([]); // nothing to confront against

    await reconcileAllMembers({ now: NOW });

    expect(m.tradeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({
          matchStatus: 'unmatched',
          verifiedAt: null,
          source: 'self_declared',
        }),
      }),
    );
    expect(m.discrepancyCreate).not.toHaveBeenCalled();
    expect(m.scoreEventCreate).not.toHaveBeenCalled();
  });

  it('🚨 DEDUP re-run — an already-materialised gap is never duplicated', async () => {
    m.tradeFindMany.mockResolvedValue([trade({ matchStatus: 'mismatch' })]);
    m.positionFindMany.mockResolvedValue([position({ volume: 1.0 })]); // mismatch again
    // The gap already exists from a prior run.
    m.discrepancyFindMany.mockResolvedValue([
      { type: 'mismatch', declaredTradeId: 't1', extractedPositionId: 'p1' },
    ]);

    const r = await reconcileAllMembers({ now: NOW });

    expect(r.discrepanciesCreated).toBe(0);
    expect(m.discrepancyCreate).not.toHaveBeenCalled();
    expect(m.scoreEventCreate).not.toHaveBeenCalled();
    // matchStatus already 'mismatch' → no churning update either.
    expect(m.tradeUpdate).not.toHaveBeenCalled();
  });

  it('🚨 RACE — concurrent pass already created the gap (P2002) → no-op, never a double penalty', async () => {
    // The in-memory `existingKeys` guard sees nothing (both passes read « none »
    // before either commits), so the create IS attempted — but the partial
    // unique index `discrepancies_reconcile_key_uniq` makes the loser's insert
    // raise P2002. `createIfNew` must fold that into a clean no-op: no second
    // accusation, and crucially NO second penalising ScoreEvent.
    m.tradeFindMany.mockResolvedValue([trade({ lotSize: 0.5 })]);
    m.positionFindMany.mockResolvedValue([position({ volume: 1.0 })]); // mismatch
    m.discrepancyFindMany.mockResolvedValue([]); // guard empty → create attempted
    m.discrepancyCreate.mockRejectedValue({ code: 'P2002' }); // lost the race

    const r = await reconcileAllMembers({ now: NOW });

    expect(r.errors).toBe(0); // P2002 is a clean dedup, not a member-level failure
    expect(r.discrepanciesCreated).toBe(0); // the loser counts nothing
    expect(m.scoreEventCreate).not.toHaveBeenCalled(); // ← the fix: no double penalty
  });

  it('🚨 a NON-P2002 create failure is surfaced, never silently swallowed', async () => {
    // The P2002 fold must NOT hide a genuine DB failure: a real error has to
    // propagate to the per-member error handler (errors += 1), not vanish.
    m.tradeFindMany.mockResolvedValue([trade({ lotSize: 0.5 })]);
    m.positionFindMany.mockResolvedValue([position({ volume: 1.0 })]); // mismatch
    m.discrepancyFindMany.mockResolvedValue([]);
    m.discrepancyCreate.mockRejectedValue({ code: 'P2010', message: 'real db failure' });

    const r = await reconcileAllMembers({ now: NOW });

    expect(r.errors).toBe(1); // surfaced
    expect(r.discrepanciesCreated).toBe(0);
    expect(m.scoreEventCreate).not.toHaveBeenCalled();
  });
});
