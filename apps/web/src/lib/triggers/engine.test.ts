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
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    trade: { findMany: vi.fn() },
    dailyCheckin: { findMany: vi.fn() },
    markDouglasCard: { findMany: vi.fn() },
    markDouglasDelivery: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    // T1 — `getBehavioralScoreHistory` (score_drift) reads this in the engine.
    behavioralScore: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueDouglasDeliveryNotification: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/training/training-trade-service', () => ({
  countRecentTrainingActivity: vi.fn().mockResolvedValue({ count: 0, lastEnteredAt: null }),
}));
vi.mock('@/lib/observability', () => ({ reportWarning: vi.fn() }));
// Tour 12 (action 3) — the engine now reads the member's dominant mental axis for
// the picker tie-break. Default `null` (un-profiled) → historical pick order, so
// every assertion below (single-priority card-A / card-drift) is unchanged. The
// dedicated tie-break behaviour is unit-tested in `cooldown.test.ts` (pure).
vi.mock('@/lib/coaching/service', () => ({
  getDominantMentalAxis: vi.fn().mockResolvedValue(null),
}));

import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

import { dispatchForAllActiveMembers, evaluateAndDispatchForUser } from './engine';

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
  category: 'process',
  triggerRules: { kind: 'no_checkin_streak', days: 3 },
};

function arm(options: {
  /** What the member-day cap probe (`findFirst({userId, triggeredOn})`) returns. */
  deliveredToday: { id: string } | null;
  /**
   * 14-day delivery history (`findMany`). `seenAt`/`sourceAlertId` are optional
   * for the legacy cooldown cases; TASK C reads them for routine saturation
   * (undefined → null-equivalent, matching the engine's `?:` extraction).
   */
  history?: Array<{
    cardId: string;
    createdAt: Date;
    seenAt?: Date | null;
    sourceAlertId?: string | null;
  }>;
}) {
  vi.mocked(db.user.findUnique).mockResolvedValue(USER as never);
  vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
  vi.mocked(db.dailyCheckin.findMany).mockResolvedValue([] as never);
  vi.mocked(db.markDouglasCard.findMany).mockResolvedValue([CARD] as never);
  vi.mocked(db.markDouglasDelivery.findFirst).mockResolvedValue(options.deliveredToday as never);
  vi.mocked(db.markDouglasDelivery.findMany).mockResolvedValue((options.history ?? []) as never);
  vi.mocked(db.markDouglasDelivery.create).mockResolvedValue({ id: 'delivery-new' } as never);
  vi.mocked(db.behavioralScore.findMany).mockResolvedValue([] as never);
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

describe('loadPublishedTriggerCards — malformed rule observability (RC#7 SF-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('🚨 a published card whose triggerRules no longer parse is surfaced to Sentry AND dropped (not silently skipped)', async () => {
    arm({ deliveredToday: null });
    // Override the cards read with a single card carrying an unparseable rule
    // (schema drift / out-of-band write). parseTriggerRule → null.
    vi.mocked(db.markDouglasCard.findMany).mockResolvedValue([
      { ...CARD, id: 'card-bad', triggerRules: { kind: 'totally_invalid_kind' } },
    ] as never);

    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });

    // Surfaced to Sentry, not a bare console.warn that an operator never sees.
    expect(vi.mocked(reportWarning)).toHaveBeenCalledWith(
      'douglas.engine',
      'invalid_trigger_rules',
      {
        cardId: 'card-bad',
      },
    );
    // The unparseable card is dropped from dispatch → nothing delivered.
    expect(r.delivered).toBeNull();
    expect(db.markDouglasDelivery.create).not.toHaveBeenCalled();
  });
});

describe('evaluateAndDispatchForUser — routine-cadence adaptive spacing (TASK C, §26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Days before NOW (2026-06-11). Cooldown for card-other is irrelevant here:
  // the seeded ROUTINE deliveries are for OTHER cards than the matching card-A.
  function past(daysAgo: number): Date {
    return new Date(NOW.getTime() - daysAgo * 24 * 3600 * 1000);
  }

  // (a) ENGAGED MEMBER — last routine deliveries were SEEN → cadence unchanged.
  it('engaged member (recent routine deliveries seen) → card still dispatched', async () => {
    arm({
      deliveredToday: null,
      history: [
        { cardId: 'r1', createdAt: past(2), seenAt: past(2), sourceAlertId: null },
        { cardId: 'r2', createdAt: past(4), seenAt: null, sourceAlertId: null },
        { cardId: 'r3', createdAt: past(6), seenAt: null, sourceAlertId: null },
      ],
    });
    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });
    expect(r.delivered?.cardId).toBe('card-A');
    expect(db.markDouglasDelivery.create).toHaveBeenCalledTimes(1);
  });

  // (b) SATURATED MEMBER — K unseen routine deliveries in a row → spaced (skip).
  it('saturated member (K routine deliveries all unseen) → routine fiche skipped', async () => {
    arm({
      deliveredToday: null,
      history: [
        { cardId: 'r1', createdAt: past(2), seenAt: null, sourceAlertId: null },
        { cardId: 'r2', createdAt: past(4), seenAt: null, sourceAlertId: null },
        { cardId: 'r3', createdAt: past(6), seenAt: null, sourceAlertId: null },
      ],
    });
    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });
    expect(r.delivered).toBeNull();
    // The card DID match (matched > 0) but was spaced out, not persisted.
    expect(r.matched).toBeGreaterThan(0);
    expect(db.markDouglasDelivery.create).not.toHaveBeenCalled();
  });

  // ALERTE deliveries must never be counted → never cause spacing.
  it('saturation ignores ALERTE deliveries (sourceAlertId !== null)', async () => {
    arm({
      deliveredToday: null,
      // 3 unseen ALERTE + 2 unseen ROUTINE → < K routine → NOT saturated.
      history: [
        { cardId: 'a1', createdAt: past(1), seenAt: null, sourceAlertId: 'alert-1' },
        { cardId: 'a2', createdAt: past(2), seenAt: null, sourceAlertId: 'alert-2' },
        { cardId: 'a3', createdAt: past(3), seenAt: null, sourceAlertId: 'alert-3' },
        { cardId: 'r1', createdAt: past(5), seenAt: null, sourceAlertId: null },
        { cardId: 'r2', createdAt: past(7), seenAt: null, sourceAlertId: null },
      ],
    });
    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });
    expect(r.delivered?.cardId).toBe('card-A');
  });

  // (c) NEW MEMBER — insufficient routine history → OFF-equivalent (dispatches).
  it('new member (fewer than K routine deliveries) → behaves as before (dispatch)', async () => {
    arm({
      deliveredToday: null,
      history: [
        { cardId: 'r1', createdAt: past(2), seenAt: null, sourceAlertId: null },
        { cardId: 'r2', createdAt: past(4), seenAt: null, sourceAlertId: null },
      ],
    });
    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });
    expect(r.delivered?.cardId).toBe('card-A');
    expect(db.markDouglasDelivery.create).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchForAllActiveMembers — S10 perf: member-independent cards fetched ONCE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries markDouglasCard.findMany exactly once regardless of member count', async () => {
    // 3 active members, all unserved today → all run the full per-member pipeline.
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: 'm1' },
      { id: 'm2' },
      { id: 'm3' },
    ] as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(USER as never);
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValue([] as never);
    vi.mocked(db.markDouglasCard.findMany).mockResolvedValue([CARD] as never);
    vi.mocked(db.markDouglasDelivery.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.markDouglasDelivery.findMany).mockResolvedValue([] as never);
    vi.mocked(db.markDouglasDelivery.create).mockResolvedValue({ id: 'delivery-new' } as never);
    vi.mocked(db.behavioralScore.findMany).mockResolvedValue([] as never);

    const r = await dispatchForAllActiveMembers(NOW);

    expect(r.scanned).toBe(3);
    // The published cards are member-independent: the bulk path loads + parses
    // them ONCE, the per-member path reuses the pre-parsed list (no re-query).
    expect(db.markDouglasCard.findMany).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// T1 "cerveau actif" — score_drift end-to-end through the FULL engine pipeline.
//
// Proves the brain ACTS: a sustained slow decline of the behavioral score
// (loaded by getBehavioralScoreHistory → ctx.scoreHistory → evalScoreDrift via
// detectMomentum) results in a real MarkDouglasDelivery, not just a matched
// evaluator. This is the runtime proof that the wiring (engine fetch + ctx
// injection + schema) holds, beyond the pure unit test.
// =============================================================================

describe('evaluateAndDispatchForUser — score_drift end-to-end (T1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const DRIFT_CARD = {
    id: 'card-drift',
    slug: 'process-vs-outcome',
    priority: 6,
    hatClass: 'white',
    category: 'process',
    triggerRules: { kind: 'score_drift', minDecliningDimensions: 1 },
  };

  // 7 weekly points, emotionalStability dropping ~3 pts/week (past the -0.5
  // threshold), the other 3 flat. detectMomentum anchors on the point dates.
  const DECLINING_HISTORY = [
    '2026-04-24',
    '2026-05-01',
    '2026-05-08',
    '2026-05-15',
    '2026-05-22',
    '2026-05-29',
    '2026-06-05',
  ].map((dateStr, i) => ({
    date: new Date(`${dateStr}T00:00:00.000Z`),
    disciplineScore: 70,
    emotionalStabilityScore: [80, 77, 74, 71, 68, 65, 62][i]!,
    consistencyScore: 70,
    engagementScore: 70,
  }));

  it('delivers the calm white-hat card when the score drifts down', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(USER as never);
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    // A check-in TODAY suppresses the no_checkin_streak fallback — score_drift
    // is the only matchable rule, so the delivery is unambiguously its doing.
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValue([
      {
        date: new Date('2026-06-11T00:00:00.000Z'),
        slot: 'morning',
        moodScore: 6,
        sleepHours: 7,
        planRespectedToday: null,
        emotionTags: [],
      },
    ] as never);
    vi.mocked(db.markDouglasCard.findMany).mockResolvedValue([DRIFT_CARD] as never);
    vi.mocked(db.markDouglasDelivery.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.markDouglasDelivery.findMany).mockResolvedValue([] as never);
    vi.mocked(db.markDouglasDelivery.create).mockResolvedValue({ id: 'delivery-drift' } as never);
    vi.mocked(db.behavioralScore.findMany).mockResolvedValue(DECLINING_HISTORY as never);

    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });

    expect(r.delivered?.cardId).toBe('card-drift');
    expect(r.delivered?.triggeredBy).toContain('Stabilité');
    expect(db.markDouglasDelivery.create).toHaveBeenCalledTimes(1);
  });

  it('does NOT deliver when the score is flat (no drift)', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(USER as never);
    vi.mocked(db.trade.findMany).mockResolvedValue([] as never);
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValue([
      {
        date: new Date('2026-06-11T00:00:00.000Z'),
        slot: 'morning',
        moodScore: 6,
        sleepHours: 7,
        planRespectedToday: null,
        emotionTags: [],
      },
    ] as never);
    vi.mocked(db.markDouglasCard.findMany).mockResolvedValue([DRIFT_CARD] as never);
    vi.mocked(db.markDouglasDelivery.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.markDouglasDelivery.findMany).mockResolvedValue([] as never);
    vi.mocked(db.markDouglasDelivery.create).mockResolvedValue({ id: 'x' } as never);
    vi.mocked(db.behavioralScore.findMany).mockResolvedValue(
      DECLINING_HISTORY.map((p) => ({ ...p, emotionalStabilityScore: 70 })) as never,
    );

    const r = await evaluateAndDispatchForUser('user-1', { now: NOW });

    expect(r.delivered).toBeNull();
    expect(db.markDouglasDelivery.create).not.toHaveBeenCalled();
  });
});
