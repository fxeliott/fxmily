import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session 6 — DoD §32 #2 coverage : the weekly-report loader injects the
 * Session-3 VERIFICATION counters over the CORRECT period window.
 *
 * The loader (`loadWeeklySliceForUser`) derives a Mon→Sun window via
 * `computeReportingWeek(now, timezone)` (real) and then feeds three S3 reads :
 *   - `listConstancyScoresInRange(userId, parseDbDate(weekStartLocal),
 *      parseDbDate(weekEndLocal))` — CIVIL-day midnights (the ConstancyScore
 *      `periodStart` convention) ;
 *   - `countAlertsInRange(userId, weekStartUtc, weekEndUtc)` — local-instant
 *      UTC bounds (alerts carry a real `createdAt`) ;
 *   - `countOpenDiscrepancies(userId)` — CURRENT-STATE, no period bound.
 *
 * A wrong bound here would silently mis-scope the honesty/regularity counters
 * in the weekly email, so this pins each call's arguments to the window the
 * loader computed. Every other dependency (DB tables + the scoring/training/
 * meeting reads) is stubbed so the test isolates the S3 injection. Carbone the
 * batch.test.ts mock style (vi.mock @/lib/db, hoisted, vi.fn per dep).
 */

const TZ = 'Europe/Paris';
// Sunday 21:00 UTC = the cron instant. `computeReportingWeek` anchors on
// `now - 24h` (= Saturday 21:00 UTC) so the reported week is the Mon→Sun that
// just ended. 2026-06-07 is a Sunday → reported week = 2026-06-01..2026-06-07.
const CRON_NOW = new Date('2026-06-07T21:00:00Z');

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    trade: { findMany: vi.fn(async () => []) },
    dailyCheckin: { findMany: vi.fn(async () => []) },
    markDouglasDelivery: { findMany: vi.fn(async () => []) },
    tradeAnnotation: { findMany: vi.fn(async () => []) },
    // C4 (tour 10) — the loader now reads the member's onboarding profile for the
    // coaching register / learning stage. Default `null` (no profile) → the tone
    // reference degrades to `{ coachingRegister: null, learningStage: null }`,
    // keeping the S3-injection tests below byte-identical.
    memberProfile: { findUnique: vi.fn(async () => null) },
    // Tour 14 — the loader now resolves the member's off-day context
    // (getOffDaySet). No explicit off days by default, keeping counters
    // byte-identical (weekendsOff: false is pinned on the user mock below).
    memberOffDay: { findMany: vi.fn(async () => []) },
    // J5.1 — the loader reads the member's ABCD reflections of the week.
    // `[]` by default = none (existing slices stay byte-identical).
    reflectionEntry: { findMany: vi.fn(async () => []) },
  },
}));

// Non-S3 reads the loader fans out — stubbed to inert values so the slice
// builds without touching a real DB.
vi.mock('@/lib/scoring/service', () => ({
  getLatestBehavioralScore: vi.fn(async () => null),
  // S15 #6/#7 — loader now also reads the 90d score history for the momentum signal.
  getBehavioralScoreHistory: vi.fn(async () => []),
}));
vi.mock('@/lib/training/training-trade-service', () => ({
  countRecentTrainingActivity: vi.fn(async () => ({ count: 0, lastEnteredAt: null })),
}));
vi.mock('@/lib/meeting/service', () => ({
  countMeetingAttendance: vi.fn(async () => ({ scheduledCount: 0, completedCount: 0 })),
}));
// `floorMeetingWindowAtJoin` runs REAL (pure) — but the join date is far in the
// past so it returns the window bound unchanged (byte-identical path).

// 🎯 The S3 verification reads under test.
vi.mock('@/lib/verification/constancy', () => ({
  listConstancyScoresInRange: vi.fn(async () => []),
}));
vi.mock('@/lib/verification/alerts', () => ({ countAlertsInRange: vi.fn(async () => 0) }));
vi.mock('@/lib/verification/service', () => ({ countOpenDiscrepancies: vi.fn(async () => 0) }));
// S5 §32-C/D — coaching synthesis read (process/mental). Stubbed inert (null =
// no insight) so this S3-injection test stays isolated; the builder then omits
// the `coaching` slice. Coaching wiring has its own dedicated tests.
vi.mock('@/lib/coaching/service', () => ({
  getCoachingReportContext: vi.fn(async () => null),
}));
// V1.8 REFLECT — the member's own weekly review. Default `null` (no review
// submitted) = the DEFENSIVE path: every pre-existing assertion stays
// byte-identical and the report builds exactly as before the wiring.
vi.mock('@/lib/weekly-review/service', () => ({
  getWeeklyReview: vi.fn(async () => null),
}));
// J5.7 — objectifs de process (SSOT). Stubbed inert (empty rings, null axis/goal)
// so the builder omits the slice and existing assertions stay byte-identical.
vi.mock('@/lib/objectives/service', () => ({
  getProcessObjectives: vi.fn(async () => ({
    objectives: [],
    coachingAxis: null,
    methodGoal: null,
  })),
}));
// J5.8 — favoris Douglas (SSOT). Stubbed inert ([]) so the builder omits the slice
// and existing assertions stay byte-identical.
vi.mock('@/lib/cards/service', () => ({
  listMyFavorites: vi.fn(async () => []),
}));

import { db } from '@/lib/db';
import { getProcessObjectives } from '@/lib/objectives/service';
import { listMyFavorites } from '@/lib/cards/service';
import { MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS } from '@/lib/schemas/weekly-report';
import { countAlertsInRange } from '@/lib/verification/alerts';
import { listConstancyScoresInRange } from '@/lib/verification/constancy';
import { countOpenDiscrepancies } from '@/lib/verification/service';
import { getWeeklyReview } from '@/lib/weekly-review/service';

import { loadWeeklySliceForUser } from './loader';
import { computeReportingWeek } from './week-window';

/** Mirror the loader's private `parseDbDate` — UTC-midnight Date of a YYYY-MM-DD. */
function parseDbDate(local: string): Date {
  const [y, m, d] = local.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.user.findUnique).mockResolvedValue({
    id: 'user-1',
    timezone: TZ,
    status: 'active',
    joinedAt: new Date('2025-01-01T00:00:00Z'),
    email: 'm@example.com',
    firstName: 'Mem',
    lastName: 'Ber',
    // Tour 14 — getOffDaySet reads weekendsOff through the same findUnique
    // mock; false = no weekend off days, so offDaysCount stays 0 and every
    // pre-tour-14 counter assertion below remains byte-identical.
    weekendsOff: false,
  } as never);
});

describe('loadWeeklySliceForUser — Session-3 verification injection (DoD §32 #2)', () => {
  it('should_query_constancy_with_civil_day_window_bounds_when_loading_the_slice', async () => {
    // Arrange — the expected window the loader derives from (now, tz).
    const window = computeReportingWeek(CRON_NOW, TZ);

    // Act
    await loadWeeklySliceForUser('user-1', { now: CRON_NOW });

    // Assert — constancy is PERIOD-SCOPED on civil-day midnights (parseDbDate).
    expect(listConstancyScoresInRange).toHaveBeenCalledTimes(1);
    expect(listConstancyScoresInRange).toHaveBeenCalledWith(
      'user-1',
      parseDbDate(window.weekStartLocal),
      parseDbDate(window.weekEndLocal),
    );
  });

  it('should_query_alerts_with_local_instant_utc_window_bounds_when_loading_the_slice', async () => {
    // Arrange
    const window = computeReportingWeek(CRON_NOW, TZ);

    // Act
    await loadWeeklySliceForUser('user-1', { now: CRON_NOW });

    // Assert — alerts carry a real `createdAt` → local-instant UTC bounds.
    expect(countAlertsInRange).toHaveBeenCalledTimes(1);
    expect(countAlertsInRange).toHaveBeenCalledWith(
      'user-1',
      window.weekStartUtc,
      window.weekEndUtc,
    );
  });

  it('should_query_open_discrepancies_point_in_time_without_a_period_bound', async () => {
    // Act
    await loadWeeklySliceForUser('user-1', { now: CRON_NOW });

    // Assert — open discrepancies are CURRENT-STATE (no window), userId only.
    expect(countOpenDiscrepancies).toHaveBeenCalledTimes(1);
    expect(countOpenDiscrepancies).toHaveBeenCalledWith('user-1');
  });

  it('should_fold_the_S3_counters_into_builderInput_verification_when_the_slice_loads', async () => {
    // Arrange — a single ConstancyScore row for the reported week.
    vi.mocked(listConstancyScoresInRange).mockResolvedValue([
      {
        value: 72,
        breakdown: { honesty: 90, regularity: 60, discipline: 66 },
        periodStart: parseDbDate(computeReportingWeek(CRON_NOW, TZ).weekStartLocal),
        computedAt: CRON_NOW,
      },
    ] as never);
    vi.mocked(countAlertsInRange).mockResolvedValue(2);
    vi.mocked(countOpenDiscrepancies).mockResolvedValue(1);

    // Act
    const slice = await loadWeeklySliceForUser('user-1', { now: CRON_NOW });

    // Assert — the loader composes them into `builderInput.verification`.
    expect(slice?.builderInput.verification).toEqual({
      constancy: { value: 72, honesty: 90, regularity: 60, discipline: 66 },
      openDiscrepancyCount: 1,
      alertCount: 2,
    });
  });
});

describe('loadWeeklySliceForUser — V1.8 member weekly review injection', () => {
  it('should_pass_null_memberWeeklyReview_when_the_member_submitted_no_review', async () => {
    // Act — the default mock returns null (no review for this week).
    const slice = await loadWeeklySliceForUser('user-1', { now: CRON_NOW });

    // Assert — DEFENSIVE read: absent review → honest null, report unchanged.
    expect(getWeeklyReview).toHaveBeenCalledTimes(1);
    expect(slice?.builderInput.memberWeeklyReview).toBeNull();
  });

  it('should_key_the_review_lookup_on_the_civil_local_monday_of_the_report_week', async () => {
    // Arrange — the loader must use weekStartLocal (YYYY-MM-DD civil Monday),
    // never the TZ-shifted weekStartUtc instant (J8 BLOCKER #1 lesson).
    const window = computeReportingWeek(CRON_NOW, TZ);

    // Act
    await loadWeeklySliceForUser('user-1', { now: CRON_NOW });

    // Assert
    expect(getWeeklyReview).toHaveBeenCalledWith('user-1', window.weekStartLocal);
  });

  it('should_shape_and_truncate_the_answers_when_the_member_submitted_a_review', async () => {
    // Arrange — a completed review. `biggestMistake` overshoots the raised
    // MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS loader cap (must truncate);
    // `lessonLearned` sits in the 301–2000 window that the old 300-char cap would
    // have clipped mid-sentence and must now survive intact (J5.3). `bestPractice`
    // is the honest optional null.
    vi.mocked(getWeeklyReview).mockResolvedValue({
      id: 'rev-1',
      userId: 'user-1',
      weekStart: '2026-06-01',
      weekEnd: '2026-06-07',
      biggestWin: '  Respecté mon plan toute la semaine.  ',
      biggestMistake: 'x'.repeat(MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS + 100),
      bestPractice: null,
      lessonLearned: 'y'.repeat(500),
      nextWeekFocus: 'Une seule session par jour.',
      submittedAt: '2026-06-07T18:00:00.000Z',
      createdAt: '2026-06-07T18:00:00.000Z',
      updatedAt: '2026-06-07T18:00:00.000Z',
    });

    // Act
    const slice = await loadWeeklySliceForUser('user-1', { now: CRON_NOW });

    // Assert — trimmed, truncated to the raised loader cap, the 301–2000 answer
    // kept intact, null preserved.
    expect(slice?.builderInput.memberWeeklyReview).toEqual({
      biggestWin: 'Respecté mon plan toute la semaine.',
      biggestMistake: 'x'.repeat(MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS),
      bestPractice: null,
      lessonLearned: 'y'.repeat(500),
      nextWeekFocus: 'Une seule session par jour.',
    });
  });
});

describe('loadWeeklySliceForUser — J5.1 reflexions ABCD (CBT Ellis)', () => {
  it('charge les reflexions ABCD dans builderInput.reflections (mappees + date locale)', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([
      {
        date: new Date('2026-06-03T00:00:00.000Z'),
        triggerEvent: 'Gros gap a l ouverture',
        beliefAuto: 'Je vais rater le move',
        consequence: 'FOMO, entree impulsive',
        disputation: 'Attendre le retest, mon plan tient',
      },
    ] as never);

    const slice = await loadWeeklySliceForUser('user-1', { now: CRON_NOW });
    const refs = slice?.builderInput.reflections;
    expect(refs).toBeDefined();
    expect(refs).toHaveLength(1);
    expect(refs![0]!.date).toBe('2026-06-03');
    expect(refs![0]!.triggerEvent).toBe('Gros gap a l ouverture');
    expect(refs![0]!.disputation).toBe('Attendre le retest, mon plan tient');
  });

  it('interroge la fenetre de la semaine (date gte/lte), bornee + ordonnee desc', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);
    await loadWeeklySliceForUser('user-1', { now: CRON_NOW });
    const call = vi.mocked(db.reflectionEntry.findMany).mock.calls[0];
    expect(call, 'un findMany reflectionEntry doit avoir eu lieu').toBeDefined();
    const arg = call![0] as {
      where: { userId: string; date: { gte: Date; lte: Date } };
      orderBy: unknown;
      take: number;
    };
    expect(arg.where.userId).toBe('user-1');
    expect(arg.where.date.gte).toBeInstanceOf(Date);
    expect(arg.where.date.lte).toBeInstanceOf(Date);
    expect(arg.take).toBe(3);
    expect(arg.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
  });

  it('retrocompat : aucune reflexion -> builderInput.reflections === []', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);
    const slice = await loadWeeklySliceForUser('user-1', { now: CRON_NOW });
    expect(slice?.builderInput.reflections).toEqual([]);
  });
});

describe('loadWeeklySliceForUser — J5.7 objectifs de process (SSOT getProcessObjectives)', () => {
  it('relaie anneaux + coachingAxis + methodGoal dans builderInput.objectives', async () => {
    vi.mocked(getProcessObjectives).mockResolvedValue({
      objectives: [
        {
          key: 'discipline',
          label: 'Discipline',
          hint: '',
          current: 72,
          target: 80,
          gap: 8,
          reached: false,
        },
        {
          key: 'consistency',
          label: 'Constance',
          hint: '',
          current: 65,
          target: 80,
          gap: 15,
          reached: false,
        },
      ],
      coachingAxis: 'Patience sur les entrees',
      methodGoal: {
        rule: 'session_window',
        label: 'Fenetre 13h-16h',
        hint: 'Trader la bonne fenetre',
        current: 60,
        target: 75,
        good: 12,
        total: 20,
        windowDays: 30,
      },
    } as never);

    const slice = await loadWeeklySliceForUser('user-1', { now: CRON_NOW });
    const obj = slice!.builderInput.objectives;
    expect(obj).toBeDefined();
    expect(obj!.rings).toHaveLength(2);
    expect(obj!.rings[0]!.label).toBe('Discipline');
    expect(obj!.coachingAxis).toBe('Patience sur les entrees');
    expect(obj!.methodGoal?.label).toBe('Fenetre 13h-16h');
  });

  it('interroge getProcessObjectives avec userId + timezone', async () => {
    vi.mocked(getProcessObjectives).mockResolvedValue({
      objectives: [],
      coachingAxis: null,
      methodGoal: null,
    } as never);
    await loadWeeklySliceForUser('user-1', { now: CRON_NOW });
    expect(getProcessObjectives).toHaveBeenCalledWith('user-1', expect.any(String));
  });
});

describe('loadWeeklySliceForUser — J5.8 favoris Douglas (SSOT listMyFavorites)', () => {
  it('relaie titre + categorie dans builderInput.favorites', async () => {
    vi.mocked(listMyFavorites).mockResolvedValue([
      {
        userId: 'user-1',
        cardId: 'c1',
        cardSlug: 'penser-proba',
        cardTitle: 'Penser en probabilites',
        cardCategory: 'probabilities',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      {
        userId: 'user-1',
        cardId: 'c2',
        cardSlug: 'accepter-risque',
        cardTitle: 'Accepter le risque',
        cardCategory: 'acceptance',
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    ] as never);
    const slice = await loadWeeklySliceForUser('user-1', { now: CRON_NOW });
    const favs = slice!.builderInput.favorites;
    expect(favs).toBeDefined();
    expect(favs).toHaveLength(2);
    expect(favs![0]!.title).toBe('Penser en probabilites');
    expect(favs![0]!.category).toBe('probabilities');
  });

  it('interroge listMyFavorites avec le userId', async () => {
    vi.mocked(listMyFavorites).mockResolvedValue([] as never);
    await loadWeeklySliceForUser('user-1', { now: CRON_NOW });
    expect(listMyFavorites).toHaveBeenCalledWith('user-1');
  });
});
