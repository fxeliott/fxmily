import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tour 15 — the weekly fold (`recomputeConstancyForAllMembers`) is off-aware:
 * a forgot/blank-day ScoreEvent whose civil day is an off day for the member (a
 * weekend while `weekendsOff` is on, or a declared `MemberOffDay`) is treated as
 * EXCUSED (zero penalty), and a blank-day discrepancy on an off day drops out of
 * the discipline denominator. The CURRENT `weekendsOff` flag applies to past
 * days too, so declaring a day off retroactively heals a score the morning scan
 * already dinged.
 *
 * These integration tests drive the real fold with a mocked db, asserting on the
 * `value` / `breakdown` written to `constancyScore.upsert`.
 */

const m = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  offDayFindMany: vi.fn(),
  scoreEventFindMany: vi.fn(),
  extractedPositionCount: vi.fn(),
  discrepancyFindMany: vi.fn(),
  constancyScoreUpsert: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: m.userFindMany },
    memberOffDay: { findMany: m.offDayFindMany },
    scoreEvent: { findMany: m.scoreEventFindMany },
    extractedPosition: { count: m.extractedPositionCount },
    discrepancy: { findMany: m.discrepancyFindMany },
    constancyScore: { upsert: m.constancyScoreUpsert },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));

import { recomputeConstancyForAllMembers } from './constancy';
import { parseLocalDate } from '@/lib/checkin/timezone';

/** A ritual ScoreEvent shaped like the fold's `select` — `createdAt` = ritual day. */
function ev(
  reason: 'filled' | 'forgot_no_reason',
  localDay: string,
  discrepancy: { memberReason: string | null; status: string } | null = null,
) {
  return { reason, createdAt: parseLocalDate(localDay), relatedDiscrepancy: discrepancy };
}

/** Extract the breakdown written to the single upsert call. */
function upsertedBreakdown(): { regularity: number | null } {
  const call = m.constancyScoreUpsert.mock.calls[0]?.[0] as {
    create: { breakdown: { regularity: number | null } };
  };
  return call.create.breakdown;
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.offDayFindMany.mockResolvedValue([]);
  m.extractedPositionCount.mockResolvedValue(1); // everConfronted → honesty scores
  m.discrepancyFindMany.mockResolvedValue([]);
  m.constancyScoreUpsert.mockResolvedValue({ id: 'cs1' });
});

// The ISO week of `now` = 2026-06-08 (Mon) .. 2026-06-14 (Sun). 2026-06-13 is a
// Saturday, 2026-06-14 a Sunday, 2026-06-11 a Thursday.
const NOW = new Date('2026-06-11T10:00:00.000Z');

describe('recomputeConstancyForAllMembers — off-aware fold (Tour 15)', () => {
  it('🚨 WEEK-END OFF — forgot events on Sat/Sun (weekendsOff=true) do NOT drag regularity down', async () => {
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: true }]);
    m.scoreEventFindMany.mockResolvedValue([
      ev('filled', '2026-06-11'), // Thursday, active
      ev('forgot_no_reason', '2026-06-13'), // Saturday, OFF → neutralized
      ev('forgot_no_reason', '2026-06-14'), // Sunday, OFF → neutralized
    ]);

    await recomputeConstancyForAllMembers({ now: NOW });

    // Only the Thursday filled counts → regularity 100 (the two weekend forgets vanish).
    expect(upsertedBreakdown().regularity).toBe(100);
  });

  it('weekendsOff=FALSE — the same weekend forgets STILL pull regularity down', async () => {
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: false }]);
    m.scoreEventFindMany.mockResolvedValue([
      ev('filled', '2026-06-11'),
      ev('forgot_no_reason', '2026-06-13'),
      ev('forgot_no_reason', '2026-06-14'),
    ]);

    await recomputeConstancyForAllMembers({ now: NOW });

    // 1 filled / (1 filled + 2 forgot) = 33.3 — the member did NOT opt out of weekends.
    expect(upsertedBreakdown().regularity).toBeCloseTo(33.3, 1);
  });

  it('🚨 RETROACTIVE — declaring a weekday off neutralizes a forgot the scan already created', async () => {
    // weekendsOff off, but the member declared Thursday 2026-06-11 off after the
    // scan had already emitted a forgot for it.
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: false }]);
    m.offDayFindMany.mockResolvedValue([{ userId: 'memberA', date: parseLocalDate('2026-06-11') }]);
    m.scoreEventFindMany.mockResolvedValue([
      ev('filled', '2026-06-10'), // Wednesday, active
      ev('forgot_no_reason', '2026-06-11'), // Thursday, now declared OFF → neutralized
    ]);

    await recomputeConstancyForAllMembers({ now: NOW });

    // The retroactively-excused Thursday forget vanishes → regularity 100.
    expect(upsertedBreakdown().regularity).toBe(100);
  });

  it('a blank-day discrepancy on an off day counts as FACED in the discipline axis', async () => {
    m.userFindMany.mockResolvedValue([{ id: 'memberA', weekendsOff: true }]);
    m.scoreEventFindMany.mockResolvedValue([ev('filled', '2026-06-11')]);
    // Two 28-day-window discrepancies: one open blank-day on a Saturday (off → faced),
    // one open blank-day on a Thursday (active → unfaced).
    m.discrepancyFindMany.mockResolvedValue([
      {
        status: 'open',
        memberReason: null,
        type: 'unfilled_no_reason',
        detectedAt: parseLocalDate('2026-06-13'), // Saturday, OFF
      },
      {
        status: 'open',
        memberReason: null,
        type: 'unfilled_no_reason',
        detectedAt: parseLocalDate('2026-06-11'), // Thursday, active
      },
    ]);

    await recomputeConstancyForAllMembers({ now: NOW });

    const call = m.constancyScoreUpsert.mock.calls[0]?.[0] as {
      create: { breakdown: { discipline: number | null } };
    };
    // 1 faced (the off-day gap) / 2 total = 50.
    expect(call.create.breakdown.discipline).toBe(50);
  });
});
