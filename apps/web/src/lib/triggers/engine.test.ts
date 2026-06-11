import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S4 DOD2-T2-1 — member-day cap « ≤ 1 fiche Douglas par membre par JOUR ».
 *
 * The unique index `(userId, cardId, triggeredOn)` only caps PER CARD: with
 * 4 cron ticks/day + the realtime scheduler, tick 2 could deliver a DIFFERENT
 * matched card the same local day. The engine now short-circuits when any
 * delivery already carries today's `triggeredOn`. Engine runs REAL;
 * db / audit / notifications / training primitive are mocked.
 */

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    trade: { findMany: vi.fn() },
    dailyCheckin: { findMany: vi.fn() },
    markDouglasCard: { findMany: vi.fn() },
    markDouglasDelivery: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueDouglasDeliveryNotification: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/training/training-trade-service', () => ({
  countRecentTrainingActivity: vi.fn().mockResolvedValue({ count: 0, lastEnteredAt: null }),
}));

import { db } from '@/lib/db';

import { evaluateAndDispatchForUser } from './engine';

// 10:00 UTC in June = 12:00 Paris → todayLocal (Paris) = 2026-06-11. The
// `triggeredOn` column materializes the local day at UTC midnight
// (`parseLocalDate` canon).
const NOW = new Date('2026-06-11T10:00:00.000Z');
const TODAY_TRIGGERED_ON = new Date('2026-06-11T00:00:00.000Z');

const USER = {
  id: 'user-1',
  timezone: 'Europe/Paris',
  status: 'active',
  // Old enough for the no_checkin_streak account-age guard (M4).
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

// Always-matching rule for this harness: zero check-ins seeded + account
// older than `days` → evalNoCheckinStreak matches.
const CARD = {
  id: 'card-A',
  slug: 'process-over-outcome',
  priority: 5,
  hatClass: 'white',
  triggerRules: { kind: 'no_checkin_streak', days: 3 },
};

function arm(options: {
  /** What the member-day cap probe (`findFirst({userId, triggeredOn})`) returns. */
  deliveredToday: { id: string } | null;
  /** 14-day cooldown history (`findMany`). */
  history?: Array<{ cardId: string; createdAt: Date }>;
}) {
  vi.mocked(db.user.findUnique).mockResolvedValue(USER as never);
  vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
  vi.mocked(db.dailyCheckin.findMany).mockResolvedValue([] as never);
  vi.mocked(db.markDouglasCard.findMany).mockResolvedValue([CARD] as never);
  vi.mocked(db.markDouglasDelivery.findFirst).mockResolvedValue(options.deliveredToday as never);
  vi.mocked(db.markDouglasDelivery.findMany).mockResolvedValue((options.history ?? []) as never);
  vi.mocked(db.markDouglasDelivery.create).mockResolvedValue({ id: 'delivery-new' } as never);
}

describe('evaluateAndDispatchForUser — member-day cap (S4 DOD2-T2-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('control — yesterday-only history: the matched card IS dispatched today', async () => {
    arm({
      deliveredToday: null,
      history: [{ cardId: 'card-other', createdAt: new Date('2026-06-10T09:00:00.000Z') }],
    });
    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });
    expect(r.delivered?.cardId).toBe('card-A');
    expect(db.markDouglasDelivery.create).toHaveBeenCalledTimes(1);
    // The cap probe queries TODAY's member-local day (UTC-midnight canon).
    expect(db.markDouglasDelivery.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', triggeredOn: TODAY_TRIGGERED_ON },
      select: { id: true },
    });
  });

  it('🚨 cap — a delivery already made today blocks any second dispatch', async () => {
    arm({ deliveredToday: { id: 'delivery-today' } });
    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });
    expect(r.delivered).toBeNull();
    // Short-circuits BEFORE rule evaluation…
    expect(r.evaluated).toBe(0);
    expect(db.markDouglasDelivery.create).not.toHaveBeenCalled();
    // …and BEFORE the heavy context fetch (the cap probe replaces the 5
    // parallel queries on the already-served common case).
    expect(db.trade.findMany).not.toHaveBeenCalled();
    expect(db.markDouglasCard.findMany).not.toHaveBeenCalled();
  });

  it('empty history (new member): dispatch proceeds — the cap probe alone gates', async () => {
    arm({ deliveredToday: null });
    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });
    expect(r.delivered?.cardId).toBe('card-A');
  });
});
