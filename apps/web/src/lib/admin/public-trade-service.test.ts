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

import { PublicTradeNotFoundError, setPublished } from './public-trade-service';

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
