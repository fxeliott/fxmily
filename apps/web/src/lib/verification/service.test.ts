import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3 — service tests for the verification surface (broker accounts + MT5
 * proofs). Mocking strategy mirrors `lib/access-request/service.test.ts`:
 * `@/lib/db` is mocked so the service's branching logic is exercised, not
 * Postgres; `@/lib/storage` is mocked so the delete path's best-effort
 * contract is provable without a filesystem.
 */

const m = vi.hoisted(() => ({
  brokerAccountCount: vi.fn(),
  brokerAccountCreate: vi.fn(),
  brokerAccountFindMany: vi.fn(),
  proofFindMany: vi.fn(),
  proofFindUnique: vi.fn(),
  proofDelete: vi.fn(),
  positionGroupBy: vi.fn(),
  discrepancyFindUnique: vi.fn(),
  discrepancyUpdateMany: vi.fn(),
  storageDelete: vi.fn(),
  storageGetReadUrl: vi.fn((key: string) => `/api/uploads/${key}`),
}));

vi.mock('@/lib/db', () => ({
  db: {
    brokerAccount: {
      count: m.brokerAccountCount,
      create: m.brokerAccountCreate,
      findMany: m.brokerAccountFindMany,
    },
    mt5AccountProof: {
      findMany: m.proofFindMany,
      findUnique: m.proofFindUnique,
      delete: m.proofDelete,
    },
    extractedPosition: {
      groupBy: m.positionGroupBy,
    },
    discrepancy: {
      findUnique: m.discrepancyFindUnique,
      updateMany: m.discrepancyUpdateMany,
    },
  },
}));

vi.mock('@/lib/storage', () => ({
  selectStorage: () => ({
    id: 'local' as const,
    put: vi.fn(),
    getReadUrl: m.storageGetReadUrl,
    delete: m.storageDelete,
  }),
}));

import {
  BrokerAccountLimitError,
  DiscrepancyNotFoundError,
  MAX_BROKER_ACCOUNTS_PER_MEMBER,
  ProofNotFoundError,
  createBrokerAccount,
  deleteProof,
  getVerificationOverview,
  submitDiscrepancyReason,
} from './service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('submitDiscrepancyReason — atomic status flip (RC#7 TX-3)', () => {
  it('records the reason ALWAYS and flips status open→acknowledged ONLY via a status-guarded updateMany', async () => {
    m.discrepancyFindUnique.mockResolvedValue({ memberId: 'member1' });
    m.discrepancyUpdateMany.mockResolvedValue({ count: 1 });

    await submitDiscrepancyReason('member1', 'disc1', '  je me suis reposé​ '); // trailing space + zero-width

    // Two writes: (1) reason fields, keyed by id+member, no status predicate;
    const reasonCall = m.discrepancyUpdateMany.mock.calls[0]?.[0];
    expect(reasonCall?.where).toEqual({ id: 'disc1', memberId: 'member1' });
    expect(reasonCall?.data.memberReason).toBe('je me suis reposé'); // safeFreeText trimmed + stripped ZW
    expect(reasonCall?.data.memberReasonAt).toBeInstanceOf(Date);
    expect('status' in (reasonCall?.data ?? {})).toBe(false);
    // (2) the status flip, gated by `status: 'open'` in the WHERE — a row a
    // concurrent reconcile already re-statused (e.g. 'resolved') is left
    // untouched, so reality's retraction wins instead of being clobbered.
    const flipCall = m.discrepancyUpdateMany.mock.calls[1]?.[0];
    expect(flipCall?.where).toEqual({ id: 'disc1', memberId: 'member1', status: 'open' });
    expect(flipCall?.data).toEqual({ status: 'acknowledged' });
  });

  it('🚨 RACE — reconcile flipped the row to resolved first: the guarded flip is a no-op (count 0), the reason is still recorded', async () => {
    m.discrepancyFindUnique.mockResolvedValue({ memberId: 'member1' });
    // reason write succeeds; the status-guarded write matches 0 rows.
    m.discrepancyUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(submitDiscrepancyReason('member1', 'disc1', 'motif')).resolves.toBeUndefined();
    // Both writes were attempted; the function never derives status from a stale read.
    expect(m.discrepancyUpdateMany).toHaveBeenCalledTimes(2);
    expect(m.discrepancyUpdateMany.mock.calls[1]?.[0]?.where).toMatchObject({ status: 'open' });
  });

  it('BOLA — absent or another member collapses to DiscrepancyNotFoundError, no write', async () => {
    m.discrepancyFindUnique.mockResolvedValue({ memberId: 'memberX' });
    await expect(submitDiscrepancyReason('member1', 'disc1', 'x')).rejects.toBeInstanceOf(
      DiscrepancyNotFoundError,
    );
    m.discrepancyFindUnique.mockResolvedValue(null);
    await expect(submitDiscrepancyReason('member1', 'disc1', 'x')).rejects.toBeInstanceOf(
      DiscrepancyNotFoundError,
    );
    expect(m.discrepancyUpdateMany).not.toHaveBeenCalled();
  });
});

describe('createBrokerAccount', () => {
  it('creates a member-declared row (detectedByAI=false) with sanitized text', async () => {
    m.brokerAccountCount.mockResolvedValue(0);
    m.brokerAccountCreate.mockResolvedValue({ id: 'acc1' });

    const result = await createBrokerAccount('member1', {
      label: '  FTMO 100k​ ', // trailing space + zero-width char
      type: 'prop_firm',
      brokerName: 'FTMO',
    });

    expect(result.id).toBe('acc1');
    const data = m.brokerAccountCreate.mock.calls[0]?.[0]?.data;
    expect(data.label).toBe('FTMO 100k'); // trimmed + bidi/zw stripped
    expect(data.detectedByAI).toBe(false);
    expect(data.memberId).toBe('member1');
  });

  it('rejects past the defensive account cap', async () => {
    m.brokerAccountCount.mockResolvedValue(MAX_BROKER_ACCOUNTS_PER_MEMBER);
    await expect(
      createBrokerAccount('member1', { label: 'Compte', type: 'personal' }),
    ).rejects.toBeInstanceOf(BrokerAccountLimitError);
    expect(m.brokerAccountCreate).not.toHaveBeenCalled();
  });

  it('stores null (not empty string) when brokerName is absent', async () => {
    m.brokerAccountCount.mockResolvedValue(1);
    m.brokerAccountCreate.mockResolvedValue({ id: 'acc2' });
    await createBrokerAccount('member1', { label: 'Perso IC', type: 'personal' });
    expect(m.brokerAccountCreate.mock.calls[0]?.[0]?.data.brokerName).toBeNull();
  });
});

describe('getVerificationOverview', () => {
  it('aggregates accounts + proofs with grouped position counts (no N+1)', async () => {
    m.brokerAccountFindMany.mockResolvedValue([
      {
        id: 'acc1',
        label: 'FTMO 100k',
        type: 'prop_firm',
        brokerName: 'FTMO',
        detectedByAI: false,
        confidence: null,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        _count: { proofs: 2 },
      },
    ]);
    m.proofFindMany.mockResolvedValue([
      {
        id: 'p1',
        fileKey: 'proofs/member1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
        accountType: 'prop_firm',
        ocrStatus: 'pending',
        uploadedAt: new Date('2026-06-10T00:00:00Z'),
        brokerAccountId: 'acc1',
      },
      {
        id: 'p2',
        fileKey: 'proofs/member1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
        accountType: null,
        ocrStatus: 'done',
        uploadedAt: new Date('2026-06-09T00:00:00Z'),
        brokerAccountId: 'acc1',
      },
    ]);
    m.positionGroupBy
      .mockResolvedValueOnce([{ brokerAccountId: 'acc1', _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ proofId: 'p2', _count: { _all: 5 } }]);

    const overview = await getVerificationOverview('member1');

    expect(overview.accounts).toHaveLength(1);
    expect(overview.accounts[0]?.positionsCount).toBe(5);
    expect(overview.accounts[0]?.proofsCount).toBe(2);
    expect(overview.proofs).toHaveLength(2);
    expect(overview.proofs[0]?.extractedPositionsCount).toBe(0); // pending proof
    expect(overview.proofs[1]?.extractedPositionsCount).toBe(5);
    expect(overview.proofs[0]?.readUrl).toMatch(/^\/api\/uploads\/proofs\//);
    expect(overview.pendingProofsCount).toBe(1);
  });
});

describe('deleteProof', () => {
  it('deletes the row then best-effort deletes the storage object', async () => {
    m.proofFindUnique.mockResolvedValue({
      memberId: 'member1',
      fileKey: 'proofs/member1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
    });
    m.proofDelete.mockResolvedValue({});
    m.storageDelete.mockResolvedValue(undefined);

    await deleteProof('member1', 'p1');

    expect(m.proofDelete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(m.storageDelete).toHaveBeenCalledWith(
      'proofs/member1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
    );
  });

  it('🚨 BOLA — refuses another member’s proof (absent + not-owner collapse)', async () => {
    m.proofFindUnique.mockResolvedValue({ memberId: 'memberX', fileKey: 'proofs/x/k.png' });
    await expect(deleteProof('member1', 'p1')).rejects.toBeInstanceOf(ProofNotFoundError);
    m.proofFindUnique.mockResolvedValue(null);
    await expect(deleteProof('member1', 'p1')).rejects.toBeInstanceOf(ProofNotFoundError);
    expect(m.proofDelete).not.toHaveBeenCalled();
  });

  it('storage failure never blocks the row deletion (best-effort contract)', async () => {
    m.proofFindUnique.mockResolvedValue({
      memberId: 'member1',
      fileKey: 'proofs/member1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
    });
    m.proofDelete.mockResolvedValue({});
    m.storageDelete.mockRejectedValue(new Error('disk on fire'));

    await expect(deleteProof('member1', 'p1')).resolves.toBeUndefined();
    expect(m.proofDelete).toHaveBeenCalled();
  });
});
