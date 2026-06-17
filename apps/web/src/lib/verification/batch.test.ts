import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3 §33.4 — unit tests for the vision batch persist gates + account
 * resolution + position dedup. `@/lib/db` mocked (branching logic, not
 * Postgres — the end-to-end is proven by the real runtime run + e2e).
 * Safety gates (crisis/AMF) and Zod run REAL (pure functions).
 */

const m = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  userUpdate: vi.fn(),
  proofFindMany: vi.fn(),
  proofUpdate: vi.fn(),
  accountFindUnique: vi.fn(),
  accountCreate: vi.fn(),
  accountUpdate: vi.fn(),
  accountCount: vi.fn(),
  positionFindMany: vi.fn(),
  positionCreateMany: vi.fn(),
  logAudit: vi.fn(),
  scanAlertsForMember: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: m.userFindMany, update: m.userUpdate },
    mt5AccountProof: { findMany: m.proofFindMany, update: m.proofUpdate },
    brokerAccount: {
      findUnique: m.accountFindUnique,
      create: m.accountCreate,
      update: m.accountUpdate,
      count: m.accountCount,
    },
    extractedPosition: { findMany: m.positionFindMany, createMany: m.positionCreateMany },
  },
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: m.logAudit,
}));

vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

vi.mock('@/lib/weekly-report/builder', () => ({
  pseudonymizeMember: (id: string) => `member-${id.slice(0, 8).toUpperCase()}`,
}));

// S4 §30 — the event-driven alert scan fired after a successful persist. Mocked
// so these unit tests stay on the persist branching logic (the scan's own
// behavior is covered by alerts/reconcile tests + the e2e).
vi.mock('./alerts', () => ({
  scanAlertsForMember: m.scanAlertsForMember,
  ALERT_WINDOW_DAYS: 14,
}));

import { persistVisionResults } from './batch';
import type { VerificationVisionOutput } from '@/lib/schemas/verification';

const MEMBER = 'clxmember0001';
const PROOF = 'clxproof00001';

/** Probe-shaped happy output (mirror of the 2026-06-11 runtime probe A). */
function probeOutput(overrides: Partial<VerificationVisionOutput> = {}): VerificationVisionOutput {
  return {
    account: {
      login: '520012345',
      broker: 'FTMO S.R.O.',
      currency: 'USD',
      label: 'FTMO Challenge 100k',
      accountTypeGuess: 'prop_firm',
    },
    positions: [
      {
        ticket: '74410221',
        symbol: 'EURUSD',
        side: 'buy',
        openTime: '2026-06-02T09:15:12+02:00',
        closeTime: '2026-06-02T14:48:03+02:00',
        volume: 0.5,
        entryPrice: 1.08542,
        exitPrice: 1.08911,
        pnl: 184.5,
      },
      {
        ticket: null,
        symbol: 'GBPUSD',
        side: 'sell',
        openTime: '2026-06-03T08:02:44+02:00',
        closeTime: '2026-06-03T11:30:19+02:00',
        volume: 0.3,
        entryPrice: 1.27305,
        exitPrice: 1.27642,
        pnl: -101.1,
      },
    ],
    confidence: 0.97,
    ...overrides,
  };
}

function seedHappyMocks() {
  m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
  m.proofFindMany.mockResolvedValue([
    {
      id: PROOF,
      memberId: MEMBER,
      ocrStatus: 'pending',
      brokerAccountId: null,
      accountType: null,
    },
  ]);
  m.accountFindUnique.mockResolvedValue(null);
  m.accountCreate.mockResolvedValue({ id: 'accNew1' });
  m.accountCount.mockResolvedValue(1);
  m.positionFindMany.mockResolvedValue([]);
  m.positionCreateMany.mockResolvedValue({ count: 2 });
  m.proofUpdate.mockResolvedValue({});
  m.userUpdate.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persistVisionResults — event-driven alert scan (S4 §30 «sans délai»)', () => {
  it('scans the member for alerts once after a successful persist', async () => {
    seedHappyMocks();
    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: probeOutput() }],
    });
    expect(r.persisted).toBe(1);
    expect(m.scanAlertsForMember).toHaveBeenCalledTimes(1);
    expect(m.scanAlertsForMember).toHaveBeenCalledWith(
      MEMBER,
      expect.any(String),
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('a scan failure leaves the persisted proof intact (isolated, never rolls back)', async () => {
    seedHappyMocks();
    m.scanAlertsForMember.mockRejectedValue(new Error('scan_fail'));
    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: probeOutput() }],
    });
    expect(r.persisted).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('does not scan when nothing persisted (all skipped)', async () => {
    m.userFindMany.mockResolvedValue([]);
    m.proofFindMany.mockResolvedValue([]);
    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: 'forged0001', output: probeOutput() }],
    });
    expect(r.persisted).toBe(0);
    expect(m.scanAlertsForMember).not.toHaveBeenCalled();
  });
});

describe('persistVisionResults — gates', () => {
  it('🚨 Gate 1 — forged/inactive userId is skipped, nothing written', async () => {
    m.userFindMany.mockResolvedValue([]);
    m.proofFindMany.mockResolvedValue([]);

    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: 'forged0001', output: probeOutput() }],
    });

    expect(r).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(m.positionCreateMany).not.toHaveBeenCalled();
    expect(m.proofUpdate).not.toHaveBeenCalled();
  });

  it('🚨 Gate 2 — proof owner mismatch is skipped (compromised-laptop defense)', async () => {
    m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
    m.proofFindMany.mockResolvedValue([
      {
        id: PROOF,
        memberId: 'someoneelse1',
        ocrStatus: 'pending',
        brokerAccountId: null,
        accountType: null,
      },
    ]);

    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: probeOutput() }],
    });

    expect(r.skipped).toBe(1);
    expect(m.positionCreateMany).not.toHaveBeenCalled();
  });

  it('not_mt5_history flips the proof to failed; a transient error leaves it pending', async () => {
    m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
    m.proofFindMany.mockResolvedValue([
      {
        id: PROOF,
        memberId: MEMBER,
        ocrStatus: 'pending',
        brokerAccountId: null,
        accountType: null,
      },
      {
        id: 'clxproof00002',
        memberId: MEMBER,
        ocrStatus: 'pending',
        brokerAccountId: null,
        accountType: null,
      },
    ]);
    m.proofUpdate.mockResolvedValue({});

    const r = await persistVisionResults({
      results: [
        { proofId: PROOF, userId: MEMBER, error: 'not_mt5_history' },
        { proofId: 'clxproof00002', userId: MEMBER, error: 'claude_exit_1' },
      ],
    });

    expect(r.skipped).toBe(2);
    // Exactly ONE update — the not_mt5_history one — and it sets `failed`.
    expect(m.proofUpdate).toHaveBeenCalledTimes(1);
    expect(m.proofUpdate.mock.calls[0]?.[0]?.where).toEqual({ id: PROOF });
    expect(m.proofUpdate.mock.calls[0]?.[0]?.data.ocrStatus).toBe('failed');
  });

  it('🚨 adverse — not_mt5_history on an already-DONE proof never flips it back to failed', () => {
    m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
    m.proofFindMany.mockResolvedValue([
      { id: PROOF, memberId: MEMBER, ocrStatus: 'done', brokerAccountId: null, accountType: null },
    ]);

    return persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, error: 'not_mt5_history' }],
    }).then((r) => {
      expect(r.skipped).toBe(1);
      expect(m.proofUpdate).not.toHaveBeenCalled();
    });
  });

  it('Gate 3 — an already-analysed proof is never re-written (idempotency)', async () => {
    m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
    m.proofFindMany.mockResolvedValue([
      { id: PROOF, memberId: MEMBER, ocrStatus: 'done', brokerAccountId: null, accountType: null },
    ]);

    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: probeOutput() }],
    });

    expect(r.skipped).toBe(1);
    expect(m.positionCreateMany).not.toHaveBeenCalled();
  });

  it('Gate 4 — a hallucinated extra key fails the strict Zod parse', async () => {
    m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
    m.proofFindMany.mockResolvedValue([
      {
        id: PROOF,
        memberId: MEMBER,
        ocrStatus: 'pending',
        brokerAccountId: null,
        accountType: null,
      },
    ]);

    const bad = { ...probeOutput(), volunteeredKey: 'nope' } as unknown as VerificationVisionOutput;
    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: bad }],
    });

    expect(r.errors).toBe(1);
    expect(m.positionCreateMany).not.toHaveBeenCalled();
  });

  it('🚨 Gate 6b — AMF vocabulary in a text field skips the persist (posture §2)', async () => {
    m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
    m.proofFindMany.mockResolvedValue([
      {
        id: PROOF,
        memberId: MEMBER,
        ocrStatus: 'pending',
        brokerAccountId: null,
        accountType: null,
      },
    ]);

    const poisoned = probeOutput({
      account: {
        login: '520012345',
        broker: 'FTMO',
        currency: 'USD',
        // Burned-in advice echoed by the model into a header field.
        label: 'Achetez maintenant objectif vers 1.1500',
        accountTypeGuess: 'prop_firm',
      },
    });
    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: poisoned }],
    });

    expect(r.skipped).toBe(1);
    expect(m.positionCreateMany).not.toHaveBeenCalled();
    const slugs = m.logAudit.mock.calls.map((c) => c[0]?.action);
    expect(slugs).toContain('verification.batch.amf_violation');
  });
});

describe('persistVisionResults — materialisation', () => {
  it('creates a detectedByAI account, maps buy/sell→long/short, refreshes detectedAccountCount', async () => {
    seedHappyMocks();
    m.accountCount.mockResolvedValue(2);

    const r = await persistVisionResults({
      results: [
        { proofId: PROOF, userId: MEMBER, output: probeOutput(), model: 'claude-opus-4-8' },
      ],
    });

    expect(r).toEqual({ persisted: 1, skipped: 0, errors: 0 });

    const created = m.accountCreate.mock.calls[0]?.[0]?.data;
    expect(created.detectedByAI).toBe(true);
    expect(created.accountLogin).toBe('520012345');
    expect(created.type).toBe('prop_firm');

    const rows = m.positionCreateMany.mock.calls[0]?.[0]?.data;
    expect(rows).toHaveLength(2);
    expect(rows[0].side).toBe('long'); // buy → long
    expect(rows[1].side).toBe('short'); // sell → short
    expect(rows[0].ticket).toBe('74410221');
    expect(rows[0].proofId).toBe(PROOF);

    expect(m.proofUpdate.mock.calls[0]?.[0]?.data.ocrStatus).toBe('done');
    expect(m.proofUpdate.mock.calls[0]?.[0]?.data.brokerAccountId).toBe('accNew1');
    expect(m.userUpdate.mock.calls[0]?.[0]?.data.detectedAccountCount).toBe(2);
  });

  it('backfills the login on the member-declared account the proof was attached to', async () => {
    m.userFindMany.mockResolvedValue([{ id: MEMBER }]);
    m.proofFindMany.mockResolvedValue([
      {
        id: PROOF,
        memberId: MEMBER,
        ocrStatus: 'pending',
        brokerAccountId: 'accDecl1',
        accountType: 'prop_firm',
      },
    ]);
    // No row carries this login yet; the declared row exists with login null.
    m.accountFindUnique
      .mockResolvedValueOnce(null) // by (memberId, login)
      .mockResolvedValueOnce({
        id: 'accDecl1',
        memberId: MEMBER,
        accountLogin: null,
        brokerName: null,
      });
    m.accountUpdate.mockResolvedValue({});
    m.accountCount.mockResolvedValue(1);
    m.positionFindMany.mockResolvedValue([]);
    m.positionCreateMany.mockResolvedValue({ count: 2 });
    m.proofUpdate.mockResolvedValue({});
    m.userUpdate.mockResolvedValue({});

    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: probeOutput() }],
    });

    expect(r.persisted).toBe(1);
    expect(m.accountCreate).not.toHaveBeenCalled(); // member's declaration verified, NOT duplicated
    expect(m.accountUpdate.mock.calls[0]?.[0]?.where).toEqual({ id: 'accDecl1' });
    expect(m.accountUpdate.mock.calls[0]?.[0]?.data.accountLogin).toBe('520012345');
  });

  it('deduplicates positions by ticket AND by (symbol, side, openTime, volume) heuristic', async () => {
    seedHappyMocks();
    m.positionFindMany.mockResolvedValue([
      // Ticket match for the first probe position.
      {
        ticket: '74410221',
        symbol: 'EURUSD',
        side: 'long',
        openTime: new Date('2026-06-02T07:15:12.000Z'),
        volume: 0.5,
      },
      // Heuristic match for the second (no ticket on mobile layouts).
      {
        ticket: null,
        symbol: 'GBPUSD',
        side: 'short',
        openTime: new Date('2026-06-03T06:02:44.000Z'),
        volume: 0.3,
      },
    ]);

    const r = await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: probeOutput() }],
    });

    expect(r.persisted).toBe(1);
    // Both positions already known → nothing inserted, proof still flips done.
    expect(m.positionCreateMany).not.toHaveBeenCalled();
    expect(m.proofUpdate.mock.calls[0]?.[0]?.data.ocrStatus).toBe('done');
  });

  it('🚨 pins a forged model string to the honest local sentinel (audit trail)', async () => {
    seedHappyMocks();

    await persistVisionResults({
      results: [{ proofId: PROOF, userId: MEMBER, output: probeOutput(), model: 'gpt-9-forged' }],
    });

    const analyzed = m.logAudit.mock.calls.find(
      (c) => c[0]?.action === 'verification.proof.analyzed',
    );
    expect(analyzed?.[0]?.metadata?.claudeModelVersion).toBe('claude-code-local');
  });
});
