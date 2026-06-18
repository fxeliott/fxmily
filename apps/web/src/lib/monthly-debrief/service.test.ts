import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S6 audit — monthly debrief member-guidance reads/stamp.
 *
 * `getLatestUnreadMonthlyDebrief` (latest row with seenAt null) and
 * `markMonthlyDebriefSeen` (idempotent, user-scoped, length-guarded first-view
 * stamp) run REAL against a mocked `@/lib/db`. These power the calm dashboard
 * "ton débrief est prêt" nudge that goes quiet once the member has read it.
 */

vi.mock('@/lib/db', () => ({
  db: {
    monthlyDebrief: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import { getLatestUnreadMonthlyDebrief, markMonthlyDebriefSeen } from './service';

/** A full persisted row the serializer can consume. */
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cuid-debrief-1',
    userId: 'user-1',
    monthStart: new Date('2026-05-01T00:00:00.000Z'),
    monthEnd: new Date('2026-05-31T00:00:00.000Z'),
    generatedAt: new Date('2026-06-01T03:00:00.000Z'),
    progressionNarrative: 'Tu progresses sur ta discipline.',
    summaryReal: 'Exécution en réel.',
    summaryTraining: '12 backtests ce mois.',
    risks: ['Surtrading après une perte'],
    recommendations: ['Garde ta routine du matin'],
    patterns: {},
    claudeModel: 'claude-code-local',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    costEur: { toString: () => '0.000000' },
    sentToMemberAt: new Date('2026-06-01T03:01:00.000Z'),
    sentToMemberEmail: 'm@fxmily.test',
    pushEnqueuedAt: null,
    seenAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLatestUnreadMonthlyDebrief', () => {
  it('returns the latest UNREAD debrief, serialized with seenAt', async () => {
    vi.mocked(db.monthlyDebrief.findFirst).mockResolvedValue(row() as never);
    const got = await getLatestUnreadMonthlyDebrief('user-1');
    expect(got).not.toBeNull();
    expect(got?.id).toBe('cuid-debrief-1');
    expect(got?.monthStart).toBe('2026-05-01');
    expect(got?.seenAt).toBeNull();
    // query is user-scoped AND filters seenAt: null, newest first
    expect(db.monthlyDebrief.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', seenAt: null },
      orderBy: { monthStart: 'desc' },
    });
  });

  it('returns null when every debrief is already read', async () => {
    vi.mocked(db.monthlyDebrief.findFirst).mockResolvedValue(null as never);
    expect(await getLatestUnreadMonthlyDebrief('user-1')).toBeNull();
  });
});

describe('markMonthlyDebriefSeen', () => {
  it('stamps seenAt on the first view (count > 0 → true), scoped to id+userId+null', async () => {
    vi.mocked(db.monthlyDebrief.updateMany).mockResolvedValue({ count: 1 } as never);
    const stamped = await markMonthlyDebriefSeen('user-1', 'cuid-debrief-1');
    expect(stamped).toBe(true);
    const call = vi.mocked(db.monthlyDebrief.updateMany).mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: { seenAt: unknown };
    };
    expect(call.where).toMatchObject({ id: 'cuid-debrief-1', userId: 'user-1', seenAt: null });
    expect(call.data.seenAt).toBeInstanceOf(Date);
  });

  it('is idempotent: a re-view (already stamped / foreign id → count 0) returns false', async () => {
    vi.mocked(db.monthlyDebrief.updateMany).mockResolvedValue({ count: 0 } as never);
    expect(await markMonthlyDebriefSeen('user-1', 'cuid-debrief-1')).toBe(false);
  });

  it('rejects an empty or oversized id without hitting the DB (no enumeration surface)', async () => {
    expect(await markMonthlyDebriefSeen('user-1', '')).toBe(false);
    expect(await markMonthlyDebriefSeen('user-1', 'x'.repeat(65))).toBe(false);
    expect(db.monthlyDebrief.updateMany).not.toHaveBeenCalled();
  });
});
