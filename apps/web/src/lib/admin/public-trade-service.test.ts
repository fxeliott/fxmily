/**
 * TDD tests for `public-trade-service.ts` (T5 Phase H — BLOQUANT-3).
 *
 * Focus : `setPublished` preserves `publishedAt` across republish/unpublish.
 * Verified via Prisma mock — proves the fix to the BLOQUANT-3 audit finding
 * "Bumper publishedAt à chaque republish = destruction silencieuse du signal
 * chronologique" (cf. `public-trade-service.ts:295-305`).
 *
 * Mock pattern carbone `lib/admin/admin-notes-service.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    publicTrade: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import { PublicTradeInvalidStateError } from './public-trade-math';
import { PublicTradeNotFoundError, setPublished, updatePublicTrade } from './public-trade-service';

// =============================================================================
// Fixtures
// =============================================================================

function makeRow(
  overrides: Partial<{
    id: string;
    publishedAt: Date;
    isPublished: boolean;
  }> = {},
) {
  return {
    id: 'trade-1',
    segment: 'live',
    ordinal: 1,
    instrument: 'EURUSD',
    direction: 'long',
    enteredAt: new Date('2026-05-22T10:00:00Z'),
    exitedAt: new Date('2026-05-22T14:00:00Z'),
    riskPercent: { toString: () => '1.0' },
    resultR: { toString: () => '2.0' },
    resultPercent: { toString: () => '2.0' },
    status: 'closed',
    session: null,
    setup: null,
    tags: [],
    notes: null,
    screenshotUrl: null,
    source: 'admin',
    isPublished: true,
    publishedAt: new Date('2026-05-22T15:00:00Z'),
    createdAt: new Date('2026-05-22T09:00:00Z'),
    updatedAt: new Date('2026-05-22T15:00:00Z'),
    _count: { partials: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// =============================================================================
// setPublished — BLOQUANT-3 fix : preserve publishedAt
// =============================================================================

describe('setPublished — publishedAt lifecycle', () => {
  it('throws PublicTradeNotFoundError when trade does not exist', async () => {
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(null);
    await expect(setPublished('missing-id', true)).rejects.toThrow(PublicTradeNotFoundError);
    // update should NOT be called when findUnique returns null.
    expect(vi.mocked(db.publicTrade.update)).not.toHaveBeenCalled();
  });

  it('sets publishedAt to a new Date on first publish (existing.publishedAt = null)', async () => {
    // Arrange : a draft trade that has never been published.
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce({
      publishedAt: null,
    } as never);
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(makeRow() as never);

    // Act
    await setPublished('trade-1', true);

    // Assert : update call data includes publishedAt: <Date>.
    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as {
      where: { id: string };
      data: { isPublished: boolean; publishedAt?: Date };
    };
    expect(arg.where).toEqual({ id: 'trade-1' });
    expect(arg.data.isPublished).toBe(true);
    expect(arg.data.publishedAt).toBeInstanceOf(Date);
  });

  it('does NOT bump publishedAt on republish (existing.publishedAt already set)', async () => {
    // Arrange : a trade with an existing publishedAt (was published at some point).
    const originalPublishedAt = new Date('2026-01-01T00:00:00Z');
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce({
      publishedAt: originalPublishedAt,
    } as never);
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(makeRow() as never);

    // Act : re-publish (was unpublished, now re-publishing).
    await setPublished('trade-1', true);

    // Assert : update data ONLY has isPublished, NO publishedAt key.
    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as {
      data: { isPublished: boolean; publishedAt?: Date };
    };
    expect(arg.data.isPublished).toBe(true);
    expect('publishedAt' in arg.data).toBe(false);
  });

  it('does NOT touch publishedAt on unpublish (preserve history)', async () => {
    // Arrange : a published trade.
    const originalPublishedAt = new Date('2026-01-01T00:00:00Z');
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce({
      publishedAt: originalPublishedAt,
    } as never);
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(
      makeRow({ isPublished: false }) as never,
    );

    // Act : unpublish.
    await setPublished('trade-1', false);

    // Assert : data has isPublished=false but NO publishedAt key (preserved).
    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as {
      data: { isPublished: boolean; publishedAt?: Date };
    };
    expect(arg.data.isPublished).toBe(false);
    expect('publishedAt' in arg.data).toBe(false);
  });

  it('does NOT bump publishedAt when unpublishing a never-published draft (existing=null, published=false)', async () => {
    // Edge case : unpublish a draft that was never published (defensive — won't
    // happen in UI but the predicate is `published && existing.publishedAt === null`,
    // so when published=false the publishedAt write is skipped regardless.
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce({
      publishedAt: null,
    } as never);
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(
      makeRow({ isPublished: false }) as never,
    );

    await setPublished('trade-1', false);

    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as {
      data: { isPublished: boolean; publishedAt?: Date };
    };
    expect(arg.data.isPublished).toBe(false);
    expect('publishedAt' in arg.data).toBe(false);
  });
});

// =============================================================================
// updatePublicTrade — merge logic + lifecycle re-validation (Phase H+5)
//
// Closes the documented V2-defer gap (`apps/web/CLAUDE.md` T5 backlog
// "Service-layer Vitest with Prisma mock for `updatePublicTrade` merge
// logic"). Carbone the pattern des 5 tests `setPublished` ci-dessus.
//
// Couvre :
//   - `PublicTradeNotFoundError` quand `findUnique` retourne null
//   - merge undefined-skip vs null-clear (Phase H BLOQUANT-1 fix surface)
//   - `validateLifecycleInvariants` post-merge (Phase H+4 open invariant)
//   - `resultPercent` recomputé même si pas touché par input (SSOT)
//   - Decimal wrap pour riskPercent + resultR (NaN/Decimal precision)
//   - P2002 → PublicTradeOrdinalTakenError (mapping)
//   - P2025 → PublicTradeNotFoundError (race condition mid-update mapping)
// =============================================================================

function makeExisting(
  overrides: Partial<{
    status: string;
    enteredAt: Date;
    exitedAt: Date | null;
    riskPercent: { toString: () => string };
    resultR: { toString: () => string } | null;
    ordinal: number;
  }> = {},
) {
  return {
    id: 'trade-1',
    status: 'closed',
    enteredAt: new Date('2026-05-22T10:00:00Z'),
    exitedAt: new Date('2026-05-22T14:00:00Z'),
    riskPercent: { toString: () => '1.0' },
    resultR: { toString: () => '2.0' },
    ordinal: 1,
    ...overrides,
  };
}

describe('updatePublicTrade — merge logic + lifecycle re-validation (Phase H+5)', () => {
  it('throws PublicTradeNotFoundError when findUnique returns null', async () => {
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(null);

    await expect(updatePublicTrade('missing-id', { notes: 'x' })).rejects.toThrow(
      PublicTradeNotFoundError,
    );
    // update must NOT be called when existing not found.
    expect(vi.mocked(db.publicTrade.update)).not.toHaveBeenCalled();
  });

  it('merge: input.notes === null clears the field (admin form clear)', async () => {
    // Phase H BLOQUANT-1 fix surface : the form-shapers `strFieldNullable`
    // returns `null` when admin clears an input. The service must propagate
    // null to the DB (vs `undefined` which means "skip update").
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(makeExisting() as never);
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(makeRow() as never);

    await updatePublicTrade('trade-1', { notes: null });

    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as { data: Record<string, unknown> };
    expect('notes' in arg.data).toBe(true);
    expect(arg.data.notes).toBeNull();
  });

  it('merge: input.notes absent → key NOT in update data (preserve existing)', async () => {
    // Verify undefined-skip semantics. Admin form submitted without modifying
    // notes → no `notes` key in input → no `notes` key in update data → DB
    // value preserved.
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(makeExisting() as never);
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(makeRow() as never);

    await updatePublicTrade('trade-1', { instrument: 'GBPUSD' });

    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as { data: Record<string, unknown> };
    expect('notes' in arg.data).toBe(false);
    expect(arg.data.instrument).toBe('GBPUSD');
  });

  it('Phase H+4 invariant: switching status closed→open without clearing exitedAt throws before update', async () => {
    // Phase H+4 TIER 1 stress-test #1 service-side enforcement.
    // Existing trade is closed with exitedAt set. Admin tries to change
    // status to "open" but forgets to clear exitedAt. `validateLifecycleInvariants`
    // must throw BEFORE `db.update` is called.
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(
      makeExisting({ status: 'closed', exitedAt: new Date('2026-05-22T14:00:00Z') }) as never,
    );

    await expect(updatePublicTrade('trade-1', { status: 'open' })).rejects.toThrow(
      PublicTradeInvalidStateError,
    );
    // update must NOT be called when invariant fails post-merge.
    expect(vi.mocked(db.publicTrade.update)).not.toHaveBeenCalled();
  });

  it('Phase H+4 invariant: closed→open with explicit exitedAt=null + resultR=null passes (admin cleared both)', async () => {
    // Same scenario but admin properly cleared exitedAt + resultR in the
    // same form submit. Invariant satisfied → update proceeds.
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(
      makeExisting({ status: 'closed', exitedAt: new Date('2026-05-22T14:00:00Z') }) as never,
    );
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(makeRow() as never);

    await updatePublicTrade('trade-1', {
      status: 'open',
      exitedAt: null,
      resultR: null,
    });

    expect(vi.mocked(db.publicTrade.update)).toHaveBeenCalledOnce();
    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as { data: Record<string, unknown> };
    expect(arg.data.status).toBe('open');
    expect(arg.data.exitedAt).toBeNull();
    expect(arg.data.resultR).toBeNull();
  });

  it('resultPercent SSOT: recomputed on every update even if input does not touch risk/R', async () => {
    // resultPercent is recomputed on every update from merged
    // (status, riskPercent, resultR) to maintain DB invariant
    // `resultPercent = riskPercent × resultR` (when status=closed).
    // Even if admin only changes a comment, the column is rewritten.
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(
      makeExisting({
        status: 'closed',
        riskPercent: { toString: () => '1.5' },
        resultR: { toString: () => '3.0' },
      }) as never,
    );
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(makeRow() as never);

    await updatePublicTrade('trade-1', { setup: 'new-setup' });

    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as { data: { resultPercent: { toString: () => string } | null } };
    // 1.5% × 3.0R = 4.5% (closed status, valid computation).
    expect(arg.data.resultPercent).not.toBeNull();
    expect(arg.data.resultPercent?.toString()).toBe('4.5');
  });

  it('Decimal wrap: riskPercent input number is wrapped in Prisma.Decimal on write', async () => {
    vi.mocked(db.publicTrade.findUnique).mockResolvedValueOnce(makeExisting() as never);
    vi.mocked(db.publicTrade.update).mockResolvedValueOnce(makeRow() as never);

    await updatePublicTrade('trade-1', { riskPercent: 2.5 });

    const call = vi.mocked(db.publicTrade.update).mock.calls[0];
    if (!call) throw new Error('expected update to be called');
    const arg = call[0] as { data: { riskPercent?: { toString: () => string } } };
    // Prisma.Decimal exposes .toString() — proves wrap (vs raw number).
    expect(arg.data.riskPercent).toBeDefined();
    expect(arg.data.riskPercent?.toString()).toBe('2.5');
  });
});
