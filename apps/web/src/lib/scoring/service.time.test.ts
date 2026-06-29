import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localInstantToUtc } from '@/lib/checkin/timezone';

/**
 * TIME-1 + TIME-2 (RC#8) — the scoring window's TRADE bucket.
 *
 * `Trade.closedAt`/`enteredAt` are TRUE UTC instants (plain `DateTime`), NOT the
 * UTC-midnight civil pins that `@db.Date` columns (`DailyCheckin.date`) carry.
 * Bucketing trades by `parseLocalDate` (UTC midnight) is 1-2h off the real Paris
 * civil-day boundary, so a late-evening trade lands in the wrong day's window —
 * disagreeing with the weekly report (which buckets the SAME column via
 * `localInstantToUtc`). The fix uses the real Paris civil instant for the trade
 * fetch while keeping the UTC-midnight bound for the `@db.Date` check-in fetch.
 *
 * TIME-2 — an injected `now` (the dev `?at=` back-test override) must reach the
 * anchor so the scored day is deterministic, not the ambient wall clock.
 *
 * `@/lib/db` + the two count-only window primitives are mocked so the branching
 * is exercised, not Postgres; the assertions read the actual query bounds.
 */

const m = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tradeFindMany: vi.fn(),
  checkinFindMany: vi.fn(),
  countTraining: vi.fn(),
  countMeeting: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: m.userFindUnique },
    trade: { findMany: m.tradeFindMany },
    dailyCheckin: { findMany: m.checkinFindMany },
  },
}));

vi.mock('@/lib/training/training-trade-service', () => ({
  countRecentTrainingActivity: m.countTraining,
}));

vi.mock('@/lib/meeting/service', () => ({
  countMeetingAttendance: m.countMeeting,
}));

import { computeScoresForUser } from './service';

const TZ = 'Europe/Paris';

beforeEach(() => {
  vi.clearAllMocks();
  m.tradeFindMany.mockResolvedValue([]);
  m.checkinFindMany.mockResolvedValue([]);
  m.countTraining.mockResolvedValue({ count: 0 });
  m.countMeeting.mockResolvedValue({ scheduledCount: 0, completedCount: 0 });
});

type TradeWhere = {
  OR: Array<{
    closedAt?: { gte: Date; lt: Date } | null;
    enteredAt?: { gte: Date; lt: Date };
  }>;
};
type CheckinWhere = { date: { gte: Date; lt: Date } };

describe('computeScoresForUser — TIME-1 trade-window boundary', () => {
  it('buckets trades by the Paris civil-day instant, NOT the UTC-midnight @db.Date pin', async () => {
    // TIME-2: deterministic anchor via injected `now` (summer ⇒ CEST, UTC+2).
    const now = new Date('2026-06-16T09:00:00.000Z');
    await computeScoresForUser('user_1', undefined, { timezone: TZ, now });

    const tradeWhere = m.tradeFindMany.mock.calls[0]?.[0]?.where as TradeWhere;
    const checkinWhere = m.checkinFindMany.mock.calls[0]?.[0]?.where as CheckinWhere;

    const tradeStart = tradeWhere.OR[0]?.closedAt?.gte as Date;
    const tradeEnd = tradeWhere.OR[0]?.closedAt?.lt as Date;
    const checkinStart = checkinWhere.date.gte;
    const checkinEnd = checkinWhere.date.lt;

    // The check-in bound is the UTC-midnight pin; the day it pins IS windowStart.
    // (Robust to DEFAULT_WINDOW_DAYS — we derive the expected trade bound from it
    //  rather than hardcoding the window length.)
    const windowStartCivil = checkinStart.toISOString().slice(0, 10);
    const windowEndCivil = checkinEnd.toISOString().slice(0, 10);
    expect(checkinStart.toISOString()).toBe(`${windowStartCivil}T00:00:00.000Z`);

    // The trade bound is the SAME civil date taken as a real Paris instant.
    expect(tradeStart.toISOString()).toBe(
      localInstantToUtc(windowStartCivil, 0, 0, 0, 0, TZ).toISOString(),
    );
    expect(tradeEnd.toISOString()).toBe(
      localInstantToUtc(windowEndCivil, 0, 0, 0, 0, TZ).toISOString(),
    );

    // The fix's whole point: in summer the trade bound is 2h EARLIER than the
    // UTC-midnight check-in bound, so a 22:00-24:00Z trade is no longer mis-bucketed.
    expect(checkinStart.getTime() - tradeStart.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(checkinEnd.getTime() - tradeEnd.getTime()).toBe(2 * 60 * 60 * 1000);

    // The open-trade branch (closedAt null) shares the exact same civil-instant bounds.
    expect((tradeWhere.OR[1]?.enteredAt?.gte as Date).toISOString()).toBe(tradeStart.toISOString());
    expect((tradeWhere.OR[1]?.enteredAt?.lt as Date).toISOString()).toBe(tradeEnd.toISOString());
  });

  it('keeps the offset DST-aware (winter ⇒ CET, UTC+1 ⇒ only 1h skew)', async () => {
    const now = new Date('2026-01-16T09:00:00.000Z'); // firmly CET (UTC+1)
    await computeScoresForUser('user_1', undefined, { timezone: TZ, now });

    const tradeWhere = m.tradeFindMany.mock.calls[0]?.[0]?.where as TradeWhere;
    const checkinWhere = m.checkinFindMany.mock.calls[0]?.[0]?.where as CheckinWhere;

    const tradeStart = tradeWhere.OR[0]?.closedAt?.gte as Date;
    // Winter: the Paris civil midnight is only 1h before UTC midnight.
    expect(checkinWhere.date.gte.getTime() - tradeStart.getTime()).toBe(60 * 60 * 1000);
  });
});

describe('computeScoresForUser — TIME-2 deterministic anchor', () => {
  it('drives the scored day from the injected `now`, not the ambient clock', async () => {
    // Day AFTER the spring-forward (2026-03-29) so the anchor lands on the jump day.
    const now = new Date('2026-03-30T12:00:00.000Z');
    const { result } = await computeScoresForUser('user_1', undefined, { timezone: TZ, now });
    // anchor = yesterday-local of 2026-03-30 Paris = 2026-03-29.
    expect(result.date).toBe('2026-03-29');
  });

  it('an explicit asOf still overrides everything (back-test of a fixed day)', async () => {
    const now = new Date('2026-06-16T09:00:00.000Z');
    const { result } = await computeScoresForUser('user_1', '2026-05-01', { timezone: TZ, now });
    expect(result.date).toBe('2026-05-01');
  });
});
