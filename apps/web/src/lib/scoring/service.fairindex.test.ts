import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fair-indexing (n4) — the engagement fill-rate window is FLOORED at the
 * member's join day, end-to-end through `computeScoresForUser`.
 *
 * The pure flooring helper is unit-tested in `fill-window.test.ts`; this file
 * proves the SERVICE wires it correctly through BOTH join-resolution routes
 * (`service.ts:145-156`) and pins the invariant a future refactor could
 * silently break:
 *
 *   - NUMERATOR is counted over the full fetch window (`checkinFindMany` is NOT
 *     re-filtered on the join day), DENOMINATOR is floored to the days the
 *     member actually existed. That is only safe because a member has no acts
 *     before they join, so the extra pre-join days contribute zero to the
 *     numerator — the rate can never exceed 1. A newcomer's assiduité is
 *     measured on 8/10, never diluted to 8/30.
 *   - A veteran (join on/before windowStart, or an unresolved `null` join) is
 *     BYTE-IDENTICAL to the pre-fix behaviour: the denominator stays the full
 *     window and the whole engagement result is unchanged.
 *
 * Same mock harness as `service.time.test.ts`: `@/lib/db` + the two count-only
 * primitives are mocked so the scoring branching is exercised, not Postgres.
 *
 * Two resolution routes (`service.ts:145`):
 *   - CRON path — `options.timezone` supplied ⇒ the per-user query is SKIPPED
 *     and `joinedAt` rides in via `options.joinedAt` (the nightly batch).
 *   - SINGLE-USER path — no `options.timezone` ⇒ `joinedAt` is read from the
 *     per-user `user.findUnique`.
 */

const m = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tradeFindMany: vi.fn(),
  checkinFindMany: vi.fn(),
  countTraining: vi.fn(),
  countMeeting: vi.fn(),
  offDayFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: m.userFindUnique },
    trade: { findMany: m.tradeFindMany },
    dailyCheckin: { findMany: m.checkinFindMany },
    memberOffDay: { findMany: m.offDayFindMany },
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

// Winter (CET, UTC+1) so a UTC-midnight `@db.Date` pin maps to the same Paris
// civil day with no DST ambiguity. today = 2026-02-15 ⇒ anchor = 2026-02-14 ⇒
// the default 30-day window is [2026-01-16, 2026-02-14].
const NOW = new Date('2026-02-15T12:00:00.000Z');
const FULL_WINDOW_DAYS = 30;
/** Mid-window join ⇒ floored window [2026-02-05, 2026-02-14] = 10 days. */
const JOIN_MID = new Date(Date.UTC(2026, 1, 5)); // month index 1 = February
const FLOORED_DAYS = 10;

/** A morning-only check-in on the given civil day (UTC-midnight `@db.Date` pin).
 *  Every field the scoring mappers read is present and null/empty so only the
 *  fill-rate (day count) is exercised. */
function morning(day: number): Record<string, unknown> {
  return {
    date: new Date(Date.UTC(2026, 1, day)),
    slot: 'morning',
    planRespectedToday: null,
    morningRoutineCompleted: null,
    intention: null,
    marketAnalysisDone: null,
    intentionKept: null,
    moodScore: null,
    stressScore: null,
    emotionTags: [],
    journalNote: null,
    sleepQuality: null,
    formationFollowed: null,
  };
}

// 8 distinct check-in days (2026-02-05 … 2026-02-12), all inside a mid-window
// joiner's floored window AND ≥ ENGAGEMENT_MIN_DAYS so status is 'ok'.
const CHECKINS = [5, 6, 7, 8, 9, 10, 11, 12].map(morning);

beforeEach(() => {
  vi.clearAllMocks();
  m.tradeFindMany.mockResolvedValue([]);
  m.checkinFindMany.mockResolvedValue(CHECKINS);
  m.countTraining.mockResolvedValue({ count: 0 });
  m.countMeeting.mockResolvedValue({ scheduledCount: 0, completedCount: 0 });
  m.offDayFindMany.mockResolvedValue([]);
  // Default: the off-day context read (getOffDaySet) sees weekendsOff false. The
  // main per-user query is skipped whenever a test passes options.timezone.
  m.userFindUnique.mockResolvedValue({ weekendsOff: false });
});

describe('computeScoresForUser — fair-indexing (join-floored engagement window)', () => {
  it('floors a mid-window joiner’s denominator via the CRON path (options.joinedAt)', async () => {
    const { result } = await computeScoresForUser('user_1', undefined, {
      timezone: TZ,
      now: NOW,
      joinedAt: JOIN_MID,
    });
    const fill = result.engagement.parts.checkinFillRate;

    // Denominator = days since join (10), NOT the full 30. Numerator = the 8
    // check-in days, counted over the full fetch (NOT re-floored): the invariant.
    expect(fill.denominator).toBe(FLOORED_DAYS);
    expect(fill.numerator).toBe(8);
    expect(fill.rate).toBeCloseTo(0.8, 5);
    expect(result.engagement.status).toBe('ok');
  });

  it('floors a mid-window joiner’s denominator via the SINGLE-USER path (join from db)', async () => {
    // No options.timezone ⇒ the per-user query runs and supplies joinedAt.
    m.userFindUnique.mockResolvedValue({ timezone: TZ, weekendsOff: false, joinedAt: JOIN_MID });

    const { result } = await computeScoresForUser('user_1', undefined, { now: NOW });
    const fill = result.engagement.parts.checkinFillRate;

    expect(fill.denominator).toBe(FLOORED_DAYS);
    expect(fill.numerator).toBe(8);
    expect(fill.rate).toBeCloseTo(0.8, 5);
  });

  it('leaves a veteran byte-identical whether the join is pre-window or unresolved (null)', async () => {
    // Veteran A — joined 2025-12-01, well before windowStart.
    const preWindow = (
      await computeScoresForUser('user_1', undefined, {
        timezone: TZ,
        now: NOW,
        joinedAt: new Date(Date.UTC(2025, 11, 1)),
      })
    ).result.engagement;

    // Veteran B — no join resolved at all (a caller that only passed timezone).
    const nullJoin = (await computeScoresForUser('user_1', undefined, { timezone: TZ, now: NOW }))
      .result.engagement;

    // Full-window denominator for both, and the two results are indistinguishable.
    expect(preWindow.parts.checkinFillRate.denominator).toBe(FULL_WINDOW_DAYS);
    expect(nullJoin.parts.checkinFillRate.denominator).toBe(FULL_WINDOW_DAYS);
    expect(preWindow).toEqual(nullJoin);
  });

  it('rewards the diligent newcomer over the veteran for the SAME assiduité', async () => {
    // Same 8 check-in days, only the tenure differs.
    const newcomer = (
      await computeScoresForUser('user_1', undefined, {
        timezone: TZ,
        now: NOW,
        joinedAt: JOIN_MID,
      })
    ).result.engagement;

    const veteran = (await computeScoresForUser('user_1', undefined, { timezone: TZ, now: NOW }))
      .result.engagement;

    // Identical numerator (assiduité is NOT floored) but the newcomer's floored
    // denominator lifts both the fill-rate and the composite engagement score —
    // exactly the lever a new assiduous member owns to climb (n4).
    expect(newcomer.parts.checkinFillRate.numerator).toBe(veteran.parts.checkinFillRate.numerator);
    expect(newcomer.parts.checkinFillRate.rate).toBeGreaterThan(veteran.parts.checkinFillRate.rate);
    expect(newcomer.score ?? 0).toBeGreaterThan(veteran.score ?? 0);
  });
});
