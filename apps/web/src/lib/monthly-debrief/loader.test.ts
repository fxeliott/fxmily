import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session 6 pass-3 — DoD §32-2 coverage : the monthly-debrief loader injects the
 * Session-3 ConstancyScore over a period window that is DISJOINT across
 * consecutive monthly runs.
 *
 * Regression guard for the cross-month overlap bug : the reported month's
 * ConstancyScore UPPER bound used to be `parseLocalDate(monthEndLocal)`. When a
 * civil month ends mid-week (last day Mon–Sat, ~6 months out of 7) the ISO week
 * that contains the NEXT month's 1st has its `periodStart` ≤ `monthEndLocal`, so
 * it fell inside the reported range — and `constancyScores.at(-1)` surfaced that
 * mostly-next-month week as the reported month's headline constancy, while the
 * SAME folded row was independently re-read by the next month's report. The fix
 * caps the upper bound at the next month's ISO-Monday − 1ms (symmetric with the
 * `constancyPrevious` lower-bound discipline), so every folded ISO week belongs
 * to exactly one civil month.
 *
 * August 2026 ends Monday 2026-08-31 → the week Mon 31 Aug → Sun 6 Sep straddles
 * the boundary. It is the case that must be attributed to September only.
 *
 * Every dependency except the PURE date helpers (`currentPeriodStart`,
 * `computeReportingMonth`, `computeMonthWindow`, `parseLocalDate`) is stubbed so
 * the test isolates the S3 window bounds. Carbone weekly-report/loader.test.ts.
 */

const TZ = 'Europe/Paris';
// Mid-September → `computeReportingMonth` = the just-ended civil month = August
// 2026, which ends on a Monday (mid-week) → the straddling-week scenario.
const NOW = new Date('2026-09-15T10:00:00Z'); // allow-absolute-date injected-clock-anchor

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    trade: { findMany: vi.fn(async () => []) },
    dailyCheckin: { findMany: vi.fn(async () => []) },
    markDouglasDelivery: { findMany: vi.fn(async () => []) },
    tradeAnnotation: { findMany: vi.fn(async () => []) },
    weeklyReport: { findMany: vi.fn(async () => []) },
    // Tour 14 — the loader now resolves the member's off-day context
    // (getOffDaySet). No explicit off days by default, keeping counters
    // byte-identical (weekendsOff: false is pinned on the user mock below).
    memberOffDay: { findMany: vi.fn(async () => []) },
    // J5.4 — continuite N-1 : le loader interroge le debrief du mois precedent.
    // `null` par defaut = aucun debrief anterieur (les slices existantes restent
    // byte-identiques : previousDebrief est simplement omis).
    monthlyDebrief: { findFirst: vi.fn(async () => null) },
    // J5.1 — le loader interroge les reflexions ABCD du mois. `[]` par defaut
    // = aucune reflexion (les slices existantes restent byte-identiques).
    reflectionEntry: { findMany: vi.fn(async () => []) },
  },
}));

// Non-S3 reads the loader fans out — stubbed to inert values.
vi.mock('@/lib/scoring/service', () => ({
  getLatestBehavioralScore: vi.fn(async () => null),
  getBehavioralScoreHistory: vi.fn(async () => []),
}));
vi.mock('@/lib/training/training-trade-service', () => ({
  countRecentTrainingActivity: vi.fn(async () => ({ count: 0, lastEnteredAt: null })),
}));
vi.mock('@/lib/meeting/service', () => ({
  countMeetingAttendance: vi.fn(async () => ({ scheduledCount: 0, completedCount: 0 })),
}));
vi.mock('@/lib/onboarding-interview/service', () => ({
  getProfileForUser: vi.fn(async () => null),
}));
// `floorMeetingWindowAtJoin`, `pseudonymizeMember`, `safeFreeText`, the
// `month-window` helpers and `currentPeriodStart` all run REAL (pure date/string
// maths) — the join date is far in the past so the meeting floor is a no-op.

// 🎯 The S3 read under test — mock ONLY the DB-touching `listConstancyScoresInRange`,
// keep the pure `currentPeriodStart` real (the fix derives the bound from it).
vi.mock('@/lib/verification/constancy', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/verification/constancy')>();
  return { ...actual, listConstancyScoresInRange: vi.fn(async () => []) };
});
vi.mock('@/lib/verification/alerts', () => ({ countAlertsInRange: vi.fn(async () => 0) }));
vi.mock('@/lib/verification/service', () => ({ countOpenDiscrepancies: vi.fn(async () => 0) }));
// S5 §32-C/D — coaching synthesis read (process/mental). Stubbed inert (null =
// no insight) so this loader test stays isolated; the builder then omits the
// `coaching` slice. Coaching wiring has its own dedicated tests.
vi.mock('@/lib/coaching/service', () => ({
  getCoachingReportContext: vi.fn(async () => null),
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

import { parseLocalDate } from '@/lib/checkin/timezone';
import { getProfileForUser } from '@/lib/onboarding-interview/service';
import { getProcessObjectives } from '@/lib/objectives/service';
import { listMyFavorites } from '@/lib/cards/service';
import { listConstancyScoresInRange, currentPeriodStart } from '@/lib/verification/constancy';

import { db } from '@/lib/db';
import { loadMonthlySliceForUser } from './loader';
import { computeMonthWindow, computeReportingMonth } from './month-window';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.user.findUnique).mockResolvedValue({
    id: 'user-1',
    timezone: TZ,
    status: 'active',
    joinedAt: new Date('2024-01-01T00:00:00Z'),
    email: 'm@example.com',
    firstName: 'Mem',
    lastName: 'Ber',
    // Tour 14 — getOffDaySet reads weekendsOff through the same findUnique
    // mock; false = no weekend off days, so offDaysCount stays 0 and every
    // pre-tour-14 counter assertion below remains byte-identical.
    weekendsOff: false,
  } as never);
});

/** The reported month's ConstancyScore call (its lower bound is the reported
 *  month's ISO-Monday; the previous-month call's lower bound is earlier). */
function reportedConstancyCallArgs(): unknown[] {
  const window = computeReportingMonth(NOW, TZ);
  const reportedLower = parseLocalDate(currentPeriodStart(window.monthStartUtc));
  const call = vi
    .mocked(listConstancyScoresInRange)
    .mock.calls.find((args) => (args[1] as Date).getTime() === reportedLower.getTime());
  if (!call) throw new Error('reported-month constancy call not found');
  return call;
}

describe('loadMonthlySliceForUser — Session-3 constancy window (DoD §32-2)', () => {
  it('should_cap_reported_month_constancy_upper_bound_at_next_month_iso_monday_minus_1ms', async () => {
    const window = computeReportingMonth(NOW, TZ); // August 2026
    const nextMonth = computeMonthWindow(new Date(window.monthEndUtc.getTime() + 1), TZ); // Sept
    const expectedUpper = new Date(
      parseLocalDate(currentPeriodStart(nextMonth.monthStartUtc)).getTime() - 1,
    );

    await loadMonthlySliceForUser('user-1', { now: NOW });

    const [userId, lower, upper] = reportedConstancyCallArgs();
    expect(userId).toBe('user-1');
    expect((lower as Date).getTime()).toBe(
      parseLocalDate(currentPeriodStart(window.monthStartUtc)).getTime(),
    );
    // The disjoint bound — NOT the old `parseLocalDate(monthEndLocal)`.
    expect((upper as Date).getTime()).toBe(expectedUpper.getTime());
  });

  it('should_exclude_the_next_month_straddling_week_for_a_month_that_ends_mid_week', async () => {
    const window = computeReportingMonth(NOW, TZ); // August 2026, ends Mon 31 Aug
    const monthEndBound = parseLocalDate(window.monthEndLocal);

    await loadMonthlySliceForUser('user-1', { now: NOW });

    const [, , upper] = reportedConstancyCallArgs();
    // For a mid-week-ending month the fixed upper bound is STRICTLY before the
    // civil month-end (the old buggy bound) — proving the straddling week
    // (periodStart 2026-08-31) is no longer pulled into August's range.
    expect((upper as Date).getTime()).toBeLessThan(monthEndBound.getTime());
  });

  it('should_make_the_reported_range_end_exactly_where_the_next_month_range_begins', async () => {
    const window = computeReportingMonth(NOW, TZ);
    const nextMonth = computeMonthWindow(new Date(window.monthEndUtc.getTime() + 1), TZ);
    const nextMonthLower = parseLocalDate(currentPeriodStart(nextMonth.monthStartUtc));

    await loadMonthlySliceForUser('user-1', { now: NOW });

    const [, , upper] = reportedConstancyCallArgs();
    // Disjoint AND complete: reported upper + 1ms === next month's lower bound,
    // so every folded ISO week is attributed to exactly one civil month.
    expect((upper as Date).getTime() + 1).toBe(nextMonthLower.getTime());
  });
});

// =============================================================================
// D1 — the loader derives coachingRegister + learningStage from the onboarding
// profile, validates them with Zod (safeParse), and NEVER relays weakSignals.
// =============================================================================

/** A `SerializedMemberProfile`-shaped row the mocked `getProfileForUser` returns.
 *  `coachingTone` / `learningStage` / `weakSignals` are `unknown` (Prisma JSON). */
function profileRow(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'mp-1',
    userId: 'user-1',
    interviewId: 'iv-1',
    summary: 'Trader rigoureux, sujet au FOMO en fin de session.',
    highlights: [{ key: 'discipline', label: 'Discipline matinale', evidence: ['je me lève tôt'] }],
    axesPrioritaires: ['Tenir mon plan', 'Réduire le FOMO'],
    claudeModelVersion: 'claude-x',
    instrumentVersion: 'v1',
    analyzedAt: '2026-06-01T00:00:00.000Z',
    coachingTone: {
      register: 'socratique',
      rationale: 'Le membre progresse mieux en se posant ses propres questions.',
      evidence: ['je me demande souvent pourquoi'],
    },
    learningStage: {
      stage: 'intuitive',
      rationale: 'Le membre lit le marché sans dérouler mécaniquement ses règles.',
      evidence: ['je sens le moment'],
    },
    // ADMIN-ONLY — must NEVER cross the member boundary (§21.5 + admin surface).
    weakSignals: [
      {
        signal: 'tendance à sur-risquer après une perte',
        dimensionId: 'risk_management',
        evidence: ['je double après une perte'],
      },
    ],
    ...over,
  };
}

describe('loadMonthlySliceForUser — D1 coaching register/stage relay (never weakSignals)', () => {
  it('derives coachingRegister + learningStage enums from the onboarding profile', async () => {
    vi.mocked(getProfileForUser).mockResolvedValueOnce(profileRow() as never);

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });

    const profile = slice!.builderInput.memberProfile;
    expect(profile).not.toBeNull();
    expect(profile!.coachingRegister).toBe('socratique');
    expect(profile!.learningStage).toBe('intuitive');
    // The verbatim rationale/evidence are DROPPED — only the enums travel.
    expect(JSON.stringify(profile)).not.toContain('rationale');
    expect(JSON.stringify(profile)).not.toContain('je me demande souvent');
  });

  it('NEVER relays weakSignals into the builder input (admin-only, §21.5)', async () => {
    vi.mocked(getProfileForUser).mockResolvedValueOnce(profileRow() as never);

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });

    const serialized = JSON.stringify(slice!.builderInput.memberProfile);
    expect(serialized).not.toMatch(/weak[_-]?signals?/i);
    expect(serialized).not.toContain('sur-risquer');
  });

  it('degrades cleanly (null enum) on malformed coachingTone / learningStage JSON', async () => {
    vi.mocked(getProfileForUser).mockResolvedValueOnce(
      profileRow({
        coachingTone: { register: 'not-an-enum' }, // fails safeParse
        learningStage: 'garbage', // wrong shape
      }) as never,
    );

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });

    const profile = slice!.builderInput.memberProfile;
    // The member's words still surface; only the tone enums fall back to null.
    expect(profile).not.toBeNull();
    expect(profile!.coachingRegister).toBeNull();
    expect(profile!.learningStage).toBeNull();
    expect(profile!.summary).toContain('Trader rigoureux');
  });

  it('surfaces a reference carrying ONLY a valid register when the member has no words', async () => {
    vi.mocked(getProfileForUser).mockResolvedValueOnce(
      profileRow({
        summary: '',
        highlights: [],
        axesPrioritaires: [],
        learningStage: null,
      }) as never,
    );

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });

    const profile = slice!.builderInput.memberProfile;
    // A valid register alone is "usable" so the tone consigne can travel.
    expect(profile).not.toBeNull();
    expect(profile!.coachingRegister).toBe('socratique');
    expect(profile!.learningStage).toBeNull();
    expect(profile!.summary).toBe('');
    expect(profile!.axesPrioritaires).toEqual([]);
  });
});

// =============================================================================
// J-AI corrections echo — the loader loads the coach's TAGGED corrections on the
// member's REAL trades, pre-formatted `« Axe » : commentaire` (REAL side only).
// =============================================================================

describe('loadMonthlySliceForUser — coach corrections corpus (J-AI corrections echo)', () => {
  it('reads only TAGGED real-trade corrections and pre-formats them « Axe » : commentaire', async () => {
    // The loader calls db.tradeAnnotation.findMany twice: the count-only
    // `loadAnnotationStats` (no axis filter) and `loadCoachCorrections`
    // (`axis: { not: null }`). Route by the axis filter so only the corrections
    // read returns rows.
    vi.mocked(db.tradeAnnotation.findMany).mockImplementation((async (args: {
      where?: { axis?: unknown };
      select?: Record<string, unknown>;
    }) => {
      if (args.where?.axis !== undefined) {
        return [
          { axis: 'execution', comment: '  entrée avant confirmation  ' },
          { axis: 'risk_discipline', comment: 'stop non défini' },
        ];
      }
      return [];
    }) as never);

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });

    expect(slice!.builderInput.coachCorrections).toEqual([
      '« Exécution » : entrée avant confirmation',
      '« Gestion du risque » : stop non défini',
    ]);
  });

  it('scopes the corrections read to the member + non-null axis + the month window', async () => {
    await loadMonthlySliceForUser('user-1', { now: NOW });

    const call = vi
      .mocked(db.tradeAnnotation.findMany)
      .mock.calls.find((c) => (c[0] as { where?: { axis?: unknown } }).where?.axis !== undefined);
    expect(call, 'a corrections read (axis filter) must have happened').toBeDefined();
    const where = (call![0] as { where: { axis: unknown; trade: unknown } }).where;
    expect(where.axis).toEqual({ not: null });
    expect(where.trade).toEqual({ userId: 'user-1' });
  });

  it('defaults to an empty corpus when the coach tagged nothing', async () => {
    // No tagged corrections this month → both reads return nothing.
    vi.mocked(db.tradeAnnotation.findMany).mockResolvedValue([] as never);
    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });
    expect(slice!.builderInput.coachCorrections).toEqual([]);
  });
});

describe('loadMonthlySliceForUser — J5.4 previousDebrief (continuite N-1)', () => {
  const prevMonthStart = new Date('2026-03-31T22:00:00.000Z'); // Paris 2026-04-01

  it('charge le debrief du mois precedent dans builderInput.previousDebrief', async () => {
    vi.mocked(db.monthlyDebrief.findFirst).mockResolvedValue({
      monthStart: prevMonthStart,
      summaryReal: 'Avril : discipline en hausse.',
      recommendations: ['Tenir le journal', 42, null, 'Reduire le sizing'],
    } as never);

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });
    const prev = slice!.builderInput.previousDebrief;
    expect(prev).toBeDefined();
    expect(prev!.summaryReal).toBe('Avril : discipline en hausse.');
    // Les valeurs non-string du JSON Prisma sont defensivement filtrees.
    expect(prev!.recommendations).toEqual(['Tenir le journal', 'Reduire le sizing']);
  });

  it('interroge le debrief le plus recent strictement avant le mois rapporte', async () => {
    vi.mocked(db.monthlyDebrief.findFirst).mockResolvedValue(null as never);
    await loadMonthlySliceForUser('user-1', { now: NOW });
    const call = vi.mocked(db.monthlyDebrief.findFirst).mock.calls[0];
    expect(call, 'un findFirst previousDebrief doit avoir eu lieu').toBeDefined();
    const arg = call![0] as {
      where: { userId: string; monthStart: { lt: Date } };
      orderBy: { monthStart: string };
    };
    expect(arg.where.userId).toBe('user-1');
    expect(arg.where.monthStart.lt).toBeInstanceOf(Date);
    expect(arg.orderBy).toEqual({ monthStart: 'desc' });
  });

  it('retrocompat : aucun debrief anterieur -> previousDebrief absent', async () => {
    vi.mocked(db.monthlyDebrief.findFirst).mockResolvedValue(null as never);
    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });
    expect(slice!.builderInput.previousDebrief).toBeUndefined();
  });
});

describe('loadMonthlySliceForUser — J5.1 reflexions ABCD (CBT Ellis)', () => {
  it('charge les reflexions ABCD dans builderInput.reflections (mappees + date locale)', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([
      {
        date: new Date('2026-04-15T00:00:00.000Z'),
        triggerEvent: 'Gros gap a l ouverture',
        beliefAuto: 'Je vais rater le move',
        consequence: 'FOMO, entree impulsive',
        disputation: 'Attendre le retest, mon plan tient',
      },
    ] as never);

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });
    const refs = slice!.builderInput.reflections;
    expect(refs).toBeDefined();
    expect(refs).toHaveLength(1);
    expect(refs![0]!.date).toBe('2026-04-15');
    expect(refs![0]!.triggerEvent).toBe('Gros gap a l ouverture');
    expect(refs![0]!.disputation).toBe('Attendre le retest, mon plan tient');
  });

  it('interroge la fenetre du mois (date gte/lte), bornee + ordonnee desc', async () => {
    vi.mocked(db.reflectionEntry.findMany).mockResolvedValue([] as never);
    await loadMonthlySliceForUser('user-1', { now: NOW });
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
    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });
    expect(slice!.builderInput.reflections).toEqual([]);
  });
});

describe('loadMonthlySliceForUser — J5.7 objectifs de process (SSOT getProcessObjectives)', () => {
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

    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });
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
    await loadMonthlySliceForUser('user-1', { now: NOW });
    expect(getProcessObjectives).toHaveBeenCalledWith('user-1', expect.any(String));
  });
});

describe('loadMonthlySliceForUser — J5.8 favoris Douglas (SSOT listMyFavorites)', () => {
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
    const slice = await loadMonthlySliceForUser('user-1', { now: NOW });
    const favs = slice!.builderInput.favorites;
    expect(favs).toBeDefined();
    expect(favs).toHaveLength(2);
    expect(favs![0]!.title).toBe('Penser en probabilites');
    expect(favs![0]!.category).toBe('probabilities');
  });

  it('interroge listMyFavorites avec le userId', async () => {
    vi.mocked(listMyFavorites).mockResolvedValue([] as never);
    await loadMonthlySliceForUser('user-1', { now: NOW });
    expect(listMyFavorites).toHaveBeenCalledWith('user-1');
  });
});
