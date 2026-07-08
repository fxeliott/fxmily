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
  proofCount: vi.fn(),
  positionGroupBy: vi.fn(),
  discrepancyFindUnique: vi.fn(),
  discrepancyFindMany: vi.fn(),
  discrepancyUpdateMany: vi.fn(),
  storageDelete: vi.fn(),
  storageGetReadUrl: vi.fn((key: string) => `/api/uploads/${key}`),
  getOffDaySet: vi.fn(),
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
      count: m.proofCount,
    },
    extractedPosition: {
      groupBy: m.positionGroupBy,
    },
    discrepancy: {
      findUnique: m.discrepancyFindUnique,
      findMany: m.discrepancyFindMany,
      updateMany: m.discrepancyUpdateMany,
    },
  },
}));

// Only `getOffDaySet` (the DB read) is mocked — `isOffDay` stays REAL so the
// weekend predicate under test is the production one, not a test stub.
vi.mock('@/lib/checkin/off-days', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/checkin/off-days')>();
  return { ...actual, getOffDaySet: m.getOffDaySet };
});

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
  countOpenDiscrepancies,
  countPendingProofs,
  createBrokerAccount,
  deleteProof,
  getVerificationOverview,
  listDiscrepancies,
  resolveDiscrepancyAsAdmin,
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

describe('resolveDiscrepancyAsAdmin — admin hand-close (Tour 11 chantier G)', () => {
  it('flips open|acknowledged → resolved via a status-guarded updateMany and returns the count', async () => {
    m.discrepancyUpdateMany.mockResolvedValue({ count: 1 });

    const flipped = await resolveDiscrepancyAsAdmin('disc1');

    expect(flipped).toBe(1);
    const call = m.discrepancyUpdateMany.mock.calls[0]?.[0];
    // Gate-locked WHERE: a row already 'resolved' (reconcile won the race) is
    // excluded, so the admin close can never clobber a machine resolution.
    expect(call?.where).toEqual({ id: 'disc1', status: { in: ['open', 'acknowledged'] } });
    expect(call?.data).toEqual({ status: 'resolved' });
    // No memberId in the WHERE — this is an admin-scoped write (auth already checked).
    expect('memberId' in (call?.where ?? {})).toBe(false);
  });

  it('RACE — already resolved / stale id matches 0 rows and returns 0 (no throw)', async () => {
    m.discrepancyUpdateMany.mockResolvedValue({ count: 0 });
    await expect(resolveDiscrepancyAsAdmin('disc1')).resolves.toBe(0);
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

describe('countPendingProofs — light poll counter (Tour 15)', () => {
  it('counts only the member’s pending proofs via a single scoped count', async () => {
    m.proofCount.mockResolvedValue(2);

    const pending = await countPendingProofs('member1');

    expect(pending).toBe(2);
    // Single indexed count, scoped to the member + the exact `pending`
    // predicate that VerificationOverview.pendingProofsCount uses, so the
    // client can compare the two. No joins, no findMany.
    expect(m.proofCount).toHaveBeenCalledTimes(1);
    expect(m.proofCount.mock.calls[0]?.[0]).toEqual({
      where: { memberId: 'member1', ocrStatus: 'pending' },
    });
    expect(m.proofFindMany).not.toHaveBeenCalled();
  });

  it('returns 0 when nothing is pending', async () => {
    m.proofCount.mockResolvedValue(0);
    await expect(countPendingProofs('member1')).resolves.toBe(0);
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

describe('off-day neutralization — listDiscrepancies + countOpenDiscrepancies (fix 2026-07-08)', () => {
  // 2026-07-04 = a Saturday (10:00 Paris), 2026-07-07 = a Tuesday. The fold
  // (constancy.ts) already forgives the Saturday blank day; these tests pin
  // that the LIST + the COUNT tell the member the same story.
  const saturday = new Date('2026-07-04T08:00:00Z');
  const tuesday = new Date('2026-07-07T08:00:00Z');

  const blankDayRow = (id: string, detectedAt: Date) => ({
    id,
    type: 'unfilled_no_reason' as const,
    severity: 1,
    status: 'open' as const,
    claudeReasoning: null,
    memberReason: null,
    detectedAt,
    declaredTrade: null,
    extractedPosition: null,
  });

  beforeEach(() => {
    m.discrepancyFindMany.mockReset();
    m.getOffDaySet.mockReset();
    m.getOffDaySet.mockResolvedValue({ weekendsOff: true, explicitDates: new Set() });
  });

  it('flags a weekend blank-day écart as offDayNeutralized, weekday one stays actionable', async () => {
    m.discrepancyFindMany.mockResolvedValue([
      blankDayRow('d-sat', saturday),
      blankDayRow('d-tue', tuesday),
      { ...blankDayRow('d-mismatch-sat', saturday), type: 'mismatch' as const },
    ]);

    const views = await listDiscrepancies('member1');

    expect(views.find((v) => v.id === 'd-sat')?.offDayNeutralized).toBe(true);
    expect(views.find((v) => v.id === 'd-tue')?.offDayNeutralized).toBe(false);
    // Only blank-day écarts are date-anchored to an off day — a mismatch on a
    // Saturday is still a real face-à-face divergence.
    expect(views.find((v) => v.id === 'd-mismatch-sat')?.offDayNeutralized).toBe(false);
  });

  it('respects weekendsOff:false — nothing is neutralized', async () => {
    m.getOffDaySet.mockResolvedValue({ weekendsOff: false, explicitDates: new Set() });
    m.discrepancyFindMany.mockResolvedValue([blankDayRow('d-sat', saturday)]);

    const views = await listDiscrepancies('member1');
    expect(views[0]?.offDayNeutralized).toBe(false);
  });

  it('skips the off-day query entirely when no blank-day écart is present', async () => {
    m.discrepancyFindMany.mockResolvedValue([
      { ...blankDayRow('d-mismatch', tuesday), type: 'mismatch' as const },
    ]);

    await listDiscrepancies('member1');
    expect(m.getOffDaySet).not.toHaveBeenCalled();
  });

  it('countOpenDiscrepancies excludes the neutralized blank day (teaser mirrors the page)', async () => {
    m.discrepancyFindMany.mockResolvedValue([
      { type: 'unfilled_no_reason', detectedAt: saturday },
      { type: 'unfilled_no_reason', detectedAt: tuesday },
      { type: 'mismatch', detectedAt: saturday },
    ]);

    await expect(countOpenDiscrepancies('member1')).resolves.toBe(2);
  });
});
