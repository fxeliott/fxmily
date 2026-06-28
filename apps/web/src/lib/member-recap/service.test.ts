import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCoachingInsight } from '@/lib/coaching/service';
import { getMethodMirror } from '@/lib/method-mirror/service';
import { listMeetingsForMember } from '@/lib/meeting/service';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';
import { getLatestConstancyScore } from '@/lib/verification/constancy';
import { getVerificationOverview } from '@/lib/verification/service';
import { getMemberWeeklyRecap } from '@/lib/weekly-report/member-recap';

import { getMember5AxisRecap } from './service';

/**
 * S10(b) — member 5-axis recap view-model. The seam is a PURE assembly of
 * existing read-only loaders, so the test mocks each loader and asserts the
 * projection: graceful `null` axes (never coerced to 0), the meeting union's
 * `insufficient_data` surfaced as `kind: 'insufficient_data'` (no fake 0 %), and
 * the count-only / no-P&L invariant. Carbone the daily-guidance/service.test mock
 * style (only the DB-backed loaders are mocked).
 */

vi.mock('@/lib/scoring/service', () => ({
  getLatestBehavioralScore: vi.fn(),
  getBehavioralScoreHistory: vi.fn(),
}));
vi.mock('@/lib/meeting/service', () => ({ listMeetingsForMember: vi.fn() }));
vi.mock('@/lib/method-mirror/service', () => ({ getMethodMirror: vi.fn() }));
vi.mock('@/lib/coaching/service', () => ({ getCoachingInsight: vi.fn() }));
vi.mock('@/lib/verification/constancy', () => ({ getLatestConstancyScore: vi.fn() }));
vi.mock('@/lib/verification/service', () => ({ getVerificationOverview: vi.fn() }));
vi.mock('@/lib/weekly-report/member-recap', () => ({ getMemberWeeklyRecap: vi.fn() }));

const USER = 'user_1';
const TZ = 'Europe/Paris';

/** Minimal SerializedBehavioralScore — the seam reads only `disciplineScore`. */
function latestScore(disciplineScore: number | null) {
  return { disciplineScore } as unknown as Awaited<ReturnType<typeof getLatestBehavioralScore>>;
}

/** Minimal trend points — the seam reads only `discipline`. */
function history(...disciplines: Array<number | null>) {
  return disciplines.map((discipline, i) => ({
    date: `2026-06-0${i + 1}`,
    discipline,
    emotionalStability: null,
    consistency: null,
    engagement: null,
  })) as unknown as Awaited<ReturnType<typeof getBehavioralScoreHistory>>;
}

/** Minimal MemberMeetingsResult — the seam reads only `.rate`. */
function meetingsRateOk(rate: number, scheduled: number, completed: number) {
  return {
    meetings: [],
    rate: { kind: 'ok', rate, scheduledCount: scheduled, completedCount: completed },
  } as unknown as Awaited<ReturnType<typeof listMeetingsForMember>>;
}
function meetingsRateInsufficient() {
  return {
    meetings: [],
    rate: {
      kind: 'insufficient_data',
      scheduledCount: 0,
      completedCount: 0,
      reason: 'no_meetings',
    },
  } as unknown as Awaited<ReturnType<typeof listMeetingsForMember>>;
}

/** Minimal MethodMirror — the seam reads `hasEnough` + each rule's `rate`. */
function mirror(hasEnough: boolean, ...rates: Array<number | null>) {
  return {
    rules: rates.map((rate, i) => ({ key: `r${i}`, rate })),
    sampleEntered: hasEnough ? 10 : 0,
    windowDays: 30,
    hasEnough,
  } as unknown as Awaited<ReturnType<typeof getMethodMirror>>;
}

/** Minimal CoachingInsight — the seam reads only `headline`. */
function coaching(headline: string | null) {
  return headline === null
    ? null
    : ({ headline } as unknown as Awaited<ReturnType<typeof getCoachingInsight>>);
}

/** Minimal ConstancyScoreView — the seam reads only `value`. */
function constancy(value: number | null) {
  return value === null
    ? null
    : ({ value } as unknown as Awaited<ReturnType<typeof getLatestConstancyScore>>);
}

/** Minimal VerificationOverview — the seam reads `proofs.length` + `accounts.length`. */
function verification(proofs: number, accounts: number) {
  return {
    accounts: Array.from({ length: accounts }),
    proofs: Array.from({ length: proofs }),
    pendingProofsCount: 0,
  } as unknown as Awaited<ReturnType<typeof getVerificationOverview>>;
}

/** Minimal MemberWeeklyRecapData — the seam reads `current.{tradesTotal,streakDays}`. */
function weekly(tradesTotal: number, streakDays: number) {
  return {
    current: { tradesTotal, planRespectRate: null, streakDays, eveningCheckinsCount: 0 },
    previous: null,
  } as unknown as Awaited<ReturnType<typeof getMemberWeeklyRecap>>;
}

/** Default: everything "not measured" — every axis should be null/insufficient. */
beforeEach(() => {
  vi.mocked(getLatestBehavioralScore).mockResolvedValue(latestScore(null));
  vi.mocked(getBehavioralScoreHistory).mockResolvedValue(history());
  vi.mocked(listMeetingsForMember).mockResolvedValue(meetingsRateInsufficient());
  vi.mocked(getMethodMirror).mockResolvedValue(mirror(false));
  vi.mocked(getCoachingInsight).mockResolvedValue(coaching(null));
  vi.mocked(getLatestConstancyScore).mockResolvedValue(constancy(null));
  vi.mocked(getVerificationOverview).mockResolvedValue(verification(0, 0));
  vi.mocked(getMemberWeeklyRecap).mockResolvedValue(null);
});

describe('getMember5AxisRecap — graceful null axes (never coerced to 0)', () => {
  it('a brand-new member with no data → every axis null / insufficient', async () => {
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.discipline).toBeNull();
    expect(recap.progression).toBeNull();
    expect(recap.selfWork).toBeNull();
    expect(recap.constance).toBeNull();
    // The presence axis is a discriminated union, never a fake 0 %.
    expect(recap.presence).toEqual({ kind: 'insufficient_data' });
  });

  it('a null disciplineScore is NOT coerced to 0 — the discipline axis stays null', async () => {
    vi.mocked(getLatestBehavioralScore).mockResolvedValue(latestScore(null));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.discipline).toBeNull();
  });

  it('a measured disciplineScore (even 0) surfaces the axis honestly', async () => {
    vi.mocked(getLatestBehavioralScore).mockResolvedValue(latestScore(0));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.discipline).toEqual({ score: 0 });
  });
});

describe('getMember5AxisRecap — presence respects the insufficient_data union', () => {
  it('a zero-denominator window → insufficient_data (no fake 0 %)', async () => {
    vi.mocked(listMeetingsForMember).mockResolvedValue(meetingsRateInsufficient());
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.presence).toEqual({ kind: 'insufficient_data' });
    // Structurally impossible to read a rate off the insufficient branch.
    expect(recap.presence).not.toHaveProperty('rate');
  });

  it('an ok rate is passed through with its counts', async () => {
    vi.mocked(listMeetingsForMember).mockResolvedValue(meetingsRateOk(0.5, 4, 2));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.presence).toEqual({
      kind: 'ok',
      rate: 0.5,
      scheduledCount: 4,
      completedCount: 2,
    });
  });
});

describe('getMember5AxisRecap — progression', () => {
  it('< 2 measured points → disciplineDelta null (never fabricated)', async () => {
    vi.mocked(getBehavioralScoreHistory).mockResolvedValue(history(70));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.progression).not.toBeNull();
    expect(recap.progression?.disciplineDelta).toBeNull();
    expect(recap.progression?.points).toBe(1);
  });

  it('≥ 2 measured points → signed delta from first to last', async () => {
    vi.mocked(getBehavioralScoreHistory).mockResolvedValue(history(60, null, 75));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.progression?.disciplineDelta).toBe(15);
    expect(recap.progression?.points).toBe(2);
  });

  it('a weekly recap surfaces count-only fields (no P&L)', async () => {
    vi.mocked(getMemberWeeklyRecap).mockResolvedValue(weekly(8, 5));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.progression?.weeklyTrades).toBe(8);
    expect(recap.progression?.weeklyCheckinDays).toBe(5);
    // Count-only projection — the view-model never carries a P&L key.
    expect(JSON.stringify(recap)).not.toMatch(/realizedR|pnl|outcome/i);
  });

  it('no history AND no weekly recap → progression axis null', async () => {
    vi.mocked(getBehavioralScoreHistory).mockResolvedValue(history());
    vi.mocked(getMemberWeeklyRecap).mockResolvedValue(null);
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.progression).toBeNull();
  });
});

describe('getMember5AxisRecap — self-work (method + coaching)', () => {
  it('not enough trades → methodRate null even with rule rates present', async () => {
    vi.mocked(getMethodMirror).mockResolvedValue(mirror(false, 80, 90));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.selfWork).toBeNull();
  });

  it('enough trades → methodRate is the rounded mean of MEASURED rules only', async () => {
    // 80, null, 100 → mean of [80,100] = 90 (the null rule is skipped, not 0).
    vi.mocked(getMethodMirror).mockResolvedValue(mirror(true, 80, null, 100));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.selfWork?.methodRate).toBe(90);
  });

  it('enough trades but every rule unmeasured → methodRate null (no fake 0)', async () => {
    vi.mocked(getMethodMirror).mockResolvedValue(mirror(true, null, null));
    const recap = await getMember5AxisRecap(USER, TZ);
    // Only the coaching side could keep the axis alive; here it is null too.
    expect(recap.selfWork).toBeNull();
  });

  it('a coaching headline alone keeps the axis alive (methodRate null)', async () => {
    vi.mocked(getMethodMirror).mockResolvedValue(mirror(false));
    vi.mocked(getCoachingInsight).mockResolvedValue(coaching('Ton focus mental : la discipline'));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.selfWork).toEqual({
      methodRate: null,
      coachingHeadline: 'Ton focus mental : la discipline',
    });
  });
});

describe('getMember5AxisRecap — constancy & verification', () => {
  it('a constancy score alone surfaces the axis', async () => {
    vi.mocked(getLatestConstancyScore).mockResolvedValue(constancy(72));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.constance).toEqual({ score: 72, proofsCount: 0, accountsCount: 0 });
  });

  it('proofs / accounts alone (no score yet) keep the axis alive with score null', async () => {
    vi.mocked(getLatestConstancyScore).mockResolvedValue(constancy(null));
    vi.mocked(getVerificationOverview).mockResolvedValue(verification(3, 2));
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.constance).toEqual({ score: null, proofsCount: 3, accountsCount: 2 });
  });

  it('no score AND no proofs/accounts → axis null', async () => {
    const recap = await getMember5AxisRecap(USER, TZ);
    expect(recap.constance).toBeNull();
  });
});
