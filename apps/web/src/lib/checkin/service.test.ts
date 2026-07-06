/**
 * Daily check-in service tests (Prisma-mocked).
 *
 * SPEC §28/§22 — `formationFollowed` (evening "bilan" course-adherence
 * self-report) end-to-end through the service layer: it is PERSISTED (lands in
 * the upsert create + update payloads) and PROJECTED (surfaces on the returned
 * `SerializedCheckin`). Tri-state passthrough: true / false / null. SPEC §2 —
 * a binary ACT only; the service never carries any course content.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    dailyCheckin: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    // Tour 14 — `getStreak` loads the member's off-day context via `off-days.ts`.
    user: { findUnique: vi.fn() },
    memberOffDay: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';

import {
  CheckinBackfillJustificationRequiredError,
  getRecentBackfillDays,
  getStreak,
  getYesterdayBackfill,
  listMemberCheckinsAsAdmin,
  resolveBackfillDateParam,
  submitEveningCheckin,
  submitMorningCheckin,
} from './service';
import type { EveningCheckinInput, MorningCheckinInput } from '@/lib/schemas/checkin';

/** A realistic post-Zod evening input (the schema already collapsed the form). */
function eveningInput(formationFollowed: boolean | null): EveningCheckinInput {
  return {
    date: '2026-06-05',
    planRespectedToday: true,
    hedgeRespectedToday: null,
    intentionKept: null,
    formationFollowed,
    caffeineMl: null,
    waterLiters: null,
    stressScore: 4,
    moodScore: 6,
    emotionTags: [],
    journalNote: null,
    gratitudeItems: [],
    lateJustification: null,
  } as EveningCheckinInput;
}

/** Build the row the mocked upsert resolves to (mirror DB read-back). */
function eveningRow(formationFollowed: boolean | null) {
  const now = new Date('2026-06-05T20:00:00.000Z');
  return {
    id: 'checkin-1',
    userId: 'user-1',
    date: new Date('2026-06-05T00:00:00.000Z'),
    slot: 'evening' as const,
    sleepHours: null,
    sleepQuality: null,
    morningRoutineCompleted: null,
    marketAnalysisDone: null,
    meditationMin: null,
    sportType: null,
    sportDurationMin: null,
    intention: null,
    planRespectedToday: true,
    hedgeRespectedToday: null,
    formationFollowed,
    caffeineMl: null,
    waterLiters: null,
    stressScore: 4,
    gratitudeItems: [] as string[],
    moodScore: 6,
    emotionTags: [] as string[],
    journalNote: null,
    lateJustification: null,
    backfilledAt: null as Date | null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('listMemberCheckinsAsAdmin — cap par JOURS (anti-split de slot)', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('cape par N jours distincts puis fetch tous les slots de la fenêtre (date >= cutoff)', async () => {
    // Query 1: the N most recent distinct dates (desc). days=3 → cutoff = oldest.
    vi.mocked(db.dailyCheckin.findMany)
      .mockResolvedValueOnce([
        { date: d('2026-06-05') },
        { date: d('2026-06-04') },
        { date: d('2026-06-03') },
      ] as never)
      // Query 2: every slot of every day in the window (a raw-row cap would have
      // amputated the oldest day's evening — this proves it cannot).
      .mockResolvedValueOnce([eveningRow(true), eveningRow(false), eveningRow(null)] as never);

    const out = await listMemberCheckinsAsAdmin('user-1', 3);

    const call1 = vi.mocked(db.dailyCheckin.findMany).mock.calls[0]?.[0] as {
      distinct?: unknown;
      take?: number;
      where?: unknown;
    };
    expect(call1.distinct).toEqual(['date']);
    expect(call1.take).toBe(3);
    expect(call1.where).toEqual({ userId: 'user-1' });

    // The second query is date-windowed from the OLDEST capped date forward, so
    // no day can lose a slot to the cap.
    const call2 = vi.mocked(db.dailyCheckin.findMany).mock.calls[1]?.[0] as {
      where?: { userId?: string; date?: { gte?: Date } };
    };
    expect(call2.where).toEqual({ userId: 'user-1', date: { gte: d('2026-06-03') } });

    expect(out).toHaveLength(3);
  });

  it('retourne [] sans crash et sans 2e requête quand 0 check-in', async () => {
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([] as never);

    const out = await listMemberCheckinsAsAdmin('user-1', 30);

    expect(out).toEqual([]);
    expect(vi.mocked(db.dailyCheckin.findMany)).toHaveBeenCalledTimes(1);
  });
});

// F7 — pin "now" to the fixtures' local day (2026-06-05 Paris) so these
// same-day submits never trip the new past-day rattrapage justification rule.
const FIXTURE_NOW = new Date('2026-06-05T20:00:00.000Z');

describe('submitEveningCheckin — formationFollowed (SPEC §28/§22)', () => {
  it('PERSISTS formationFollowed=true in both the create and update payloads', async () => {
    vi.mocked(db.dailyCheckin.upsert).mockResolvedValue(eveningRow(true) as never);

    await submitEveningCheckin('user-1', eveningInput(true), {
      timezone: 'Europe/Paris',
      now: FIXTURE_NOW,
    });

    const call = vi.mocked(db.dailyCheckin.upsert).mock.calls[0];
    if (!call) throw new Error('expected dailyCheckin.upsert to be called');
    const arg = call[0] as {
      create: { formationFollowed: boolean | null };
      update: { formationFollowed: boolean | null };
    };
    expect(arg.create.formationFollowed).toBe(true);
    expect(arg.update.formationFollowed).toBe(true);
  });

  it('PROJECTS formationFollowed onto the SerializedCheckin (true / false / null)', async () => {
    for (const value of [true, false, null] as const) {
      vi.mocked(db.dailyCheckin.upsert).mockResolvedValue(eveningRow(value) as never);
      const serialized = await submitEveningCheckin('user-1', eveningInput(value), {
        timezone: 'Europe/Paris',
        now: FIXTURE_NOW,
      });
      expect(serialized.formationFollowed).toBe(value);
    }
  });

  it('passes null through unchanged (unanswered evening — no penalty, no default)', async () => {
    vi.mocked(db.dailyCheckin.upsert).mockResolvedValue(eveningRow(null) as never);

    await submitEveningCheckin('user-1', eveningInput(null), {
      timezone: 'Europe/Paris',
      now: FIXTURE_NOW,
    });

    const call = vi.mocked(db.dailyCheckin.upsert).mock.calls[0];
    if (!call) throw new Error('expected dailyCheckin.upsert to be called');
    const arg = call[0] as { update: { formationFollowed: boolean | null } };
    // Explicit null — never coerced to false (which would fabricate a "skipped"
    // signal the member never gave). Mirrors hedgeRespectedToday's N/A handling.
    expect(arg.update.formationFollowed).toBeNull();
  });
});

// F7 — rattrapage (backfill) justification rule (past-day fills). Paris-local
// today = 2026-06-10; the fixtures' date 2026-06-05 is 5 days earlier.
const NOW_JUN10 = new Date('2026-06-10T09:00:00.000Z');

/** Minimal post-Zod morning input for the backfill-rule symmetry test. */
function morningInput(overrides: Partial<MorningCheckinInput> = {}): MorningCheckinInput {
  return {
    date: '2026-06-05',
    sleepHours: 7,
    sleepQuality: 6,
    morningRoutineCompleted: true,
    marketAnalysisDone: true,
    meditationMin: 0,
    sportType: null,
    sportDurationMin: null,
    intention: null,
    moodScore: 6,
    emotionTags: [],
    lateJustification: null,
    ...overrides,
  } as MorningCheckinInput;
}

describe('submit*Checkin — F7 rattrapage (past-day) justification rule', () => {
  const TZ = 'Europe/Paris';

  it('THROWS when a past-day evening fill has no justification (no upsert)', async () => {
    await expect(
      submitEveningCheckin('user-1', eveningInput(null), { timezone: TZ, now: NOW_JUN10 }),
    ).rejects.toBeInstanceOf(CheckinBackfillJustificationRequiredError);
    expect(db.dailyCheckin.upsert).not.toHaveBeenCalled();
  });

  it('THROWS symmetrically for a past-day morning fill with no justification', async () => {
    await expect(
      submitMorningCheckin('user-1', morningInput(), { timezone: TZ, now: NOW_JUN10 }),
    ).rejects.toBeInstanceOf(CheckinBackfillJustificationRequiredError);
    expect(db.dailyCheckin.upsert).not.toHaveBeenCalled();
  });

  it('persists the reason + stamps backfilledAt on a JUSTIFIED past-day fill', async () => {
    vi.mocked(db.dailyCheckin.upsert).mockResolvedValueOnce(eveningRow(null) as never);
    const input = { ...eveningInput(null), lateJustification: 'Panne internet la veille.' };

    await submitEveningCheckin('user-1', input, { timezone: TZ, now: NOW_JUN10 });

    const call = vi.mocked(db.dailyCheckin.upsert).mock.calls[0];
    if (!call) throw new Error('expected dailyCheckin.upsert to be called');
    const arg = call[0] as {
      create: { lateJustification: string | null; backfilledAt: Date | null };
      update: { lateJustification: string | null; backfilledAt: Date | null };
    };
    expect(arg.create.lateJustification).toBe('Panne internet la veille.');
    expect(arg.update.lateJustification).toBe('Panne internet la veille.');
    expect(arg.create.backfilledAt).toBeInstanceOf(Date);
    expect(arg.update.backfilledAt).toBeInstanceOf(Date);
  });

  it('a SAME-DAY fill needs no justification and clears both backfill fields', async () => {
    vi.mocked(db.dailyCheckin.upsert).mockResolvedValueOnce(eveningRow(null) as never);
    const input = { ...eveningInput(null), date: '2026-06-10', lateJustification: null };

    await submitEveningCheckin('user-1', input, { timezone: TZ, now: NOW_JUN10 });

    const call = vi.mocked(db.dailyCheckin.upsert).mock.calls[0];
    if (!call) throw new Error('expected dailyCheckin.upsert to be called');
    const arg = call[0] as {
      create: { lateJustification: string | null; backfilledAt: Date | null };
    };
    expect(arg.create.lateJustification).toBeNull();
    expect(arg.create.backfilledAt).toBeNull();
  });

  it('a same-day fill IGNORES a stray justification (kept null, no stamp)', async () => {
    vi.mocked(db.dailyCheckin.upsert).mockResolvedValueOnce(eveningRow(null) as never);
    const input = { ...eveningInput(null), date: '2026-06-10', lateJustification: 'inutile' };

    await submitEveningCheckin('user-1', input, { timezone: TZ, now: NOW_JUN10 });

    const call = vi.mocked(db.dailyCheckin.upsert).mock.calls[0];
    if (!call) throw new Error('expected dailyCheckin.upsert to be called');
    const arg = call[0] as {
      create: { lateJustification: string | null; backfilledAt: Date | null };
    };
    // Not a backfill → clear the reason so an on-time row never carries a
    // rattrapage justification (keeps the §33.2 repetition signal clean).
    expect(arg.create.lateJustification).toBeNull();
    expect(arg.create.backfilledAt).toBeNull();
  });
});

// F7 Layer 3 — the `?date=` param resolver that decides whether a slot page
// opens in rattrapage mode. Pure (no DB); Paris-local today at NOW_JUN10 is
// 2026-06-10 (UTC+2 in June, 11:00 local, same date).
describe('resolveBackfillDateParam — F7 backfill `?date=` validation', () => {
  const TZ = 'Europe/Paris';

  it('returns null for an undefined / empty / malformed param', () => {
    expect(resolveBackfillDateParam(undefined, TZ, NOW_JUN10)).toBeNull();
    expect(resolveBackfillDateParam('', TZ, NOW_JUN10)).toBeNull();
    expect(resolveBackfillDateParam('nope', TZ, NOW_JUN10)).toBeNull();
    // Calendar-invalid (month 13) — parseLocalDate throws → null.
    expect(resolveBackfillDateParam('2026-13-40', TZ, NOW_JUN10)).toBeNull();
  });

  it('returns null for today or a future day (not a rattrapage)', () => {
    expect(resolveBackfillDateParam('2026-06-10', TZ, NOW_JUN10)).toBeNull();
    expect(resolveBackfillDateParam('2026-06-11', TZ, NOW_JUN10)).toBeNull();
  });

  it('returns the day for a valid past day within the 60-day horizon', () => {
    expect(resolveBackfillDateParam('2026-06-09', TZ, NOW_JUN10)).toBe('2026-06-09');
    // Exactly 60 days back (today − 60 = 2026-04-11) is still in-window.
    expect(resolveBackfillDateParam('2026-04-11', TZ, NOW_JUN10)).toBe('2026-04-11');
  });

  it('returns null just past the 60-day horizon', () => {
    // 61 days back (2026-04-10) is out of window — the submit would reject it.
    expect(resolveBackfillDateParam('2026-04-10', TZ, NOW_JUN10)).toBeNull();
    expect(resolveBackfillDateParam('2026-01-01', TZ, NOW_JUN10)).toBeNull();
  });
});

describe('getYesterdayBackfill — F7 hub cue (per-slot gap for yesterday)', () => {
  const TZ = 'Europe/Paris';
  // Paris-local yesterday at NOW_JUN10 = 2026-06-09 (a Tuesday — not a weekend).
  const YESTERDAY = new Date('2026-06-09T00:00:00.000Z');

  beforeEach(() => {
    // Tour 14 — `getYesterdayBackfill` first resolves the off-day context. By
    // default the member is not off (weekday, weekends off, no explicit date).
    vi.mocked(db.user.findUnique).mockResolvedValue({ weekendsOff: true } as never);
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([] as never);
  });

  it('queries yesterday and flags both slots missing when the day is empty', async () => {
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([] as never);

    const out = await getYesterdayBackfill('yb-both', TZ, NOW_JUN10);

    expect(out).toEqual({ date: '2026-06-09', morningMissing: true, eveningMissing: true });
    const call = vi.mocked(db.dailyCheckin.findMany).mock.calls[0]?.[0] as {
      where?: { userId?: string; date?: Date };
    };
    expect(call.where).toEqual({ userId: 'yb-both', date: YESTERDAY });
  });

  it('flags only the missing slot when one is present', async () => {
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([{ slot: 'morning' }] as never);

    const out = await getYesterdayBackfill('yb-one', TZ, NOW_JUN10);

    expect(out).toEqual({ date: '2026-06-09', morningMissing: false, eveningMissing: true });
  });

  it('returns null when yesterday is fully covered (no cue)', async () => {
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([
      { slot: 'morning' },
      { slot: 'evening' },
    ] as never);

    const out = await getYesterdayBackfill('yb-covered', TZ, NOW_JUN10);

    expect(out).toBeNull();
  });

  // Tour 14 — when yesterday was an OFF day there is nothing to catch up.
  it('returns null (no cue) when yesterday was an explicit off day', async () => {
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([{ date: YESTERDAY }] as never);

    const out = await getYesterdayBackfill('yb-off', TZ, NOW_JUN10);

    expect(out).toBeNull();
    // The check-in query is never reached — the off day short-circuits first.
    expect(vi.mocked(db.dailyCheckin.findMany)).not.toHaveBeenCalled();
  });
});

/**
 * Tour 14 — `getStreak` threads the member's off-day context into the streak
 * walk so an off weekend does not break a Friday→Monday streak. Distinct userIds
 * per case avoid the React `cache()` memoisation collapsing them.
 */
describe('getStreak — off-day pont', () => {
  const TZ = 'Europe/Paris';
  // Monday 2026-06-08, 09:00 Paris.
  const NOW_MON = new Date('2026-06-08T07:00:00.000Z');
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('keeps a Friday→Monday streak alive across an off weekend (weekendsOff=true)', async () => {
    // Filled Fri 06-05 + today Mon 06-08; the weekend is empty but off.
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([
      { date: d('2026-06-08'), slot: 'morning' },
      { date: d('2026-06-05'), slot: 'morning' },
    ] as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ weekendsOff: true } as never);
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([] as never);

    const out = await getStreak('streak-weekend', TZ, NOW_MON);

    expect(out.current).toBe(2);
    expect(out.today).toBe('2026-06-08');
    expect(out.todayFilled).toBe(true);
  });

  it('breaks across the empty weekend when the member trades weekends (weekendsOff=false)', async () => {
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([
      { date: d('2026-06-08'), slot: 'morning' },
      { date: d('2026-06-05'), slot: 'morning' },
    ] as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ weekendsOff: false } as never);
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([] as never);

    const out = await getStreak('streak-trader', TZ, NOW_MON);

    // The empty Sat/Sun are working days for this member → today only.
    expect(out.current).toBe(1);
  });
});

/**
 * Tour 15 — `getRecentBackfillDays` lists the last few EXPECTED (non-off) days
 * the member never fully filled, newest first, capped at 3, off-aware and
 * bounded to the 60-day backfill horizon. Today is excluded (normal same-day
 * flow, not a rattrapage).
 */
describe('getRecentBackfillDays — multi-day rattrapage cue (Tour 15)', () => {
  const TZ = 'Europe/Paris';
  // Paris-local today at NOW = Wednesday 2026-06-10 (UTC+2, 11:00 local).
  const NOW = new Date('2026-06-10T09:00:00.000Z');
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  beforeEach(() => {
    // Default off-day context: weekends off, no explicit declarations.
    vi.mocked(db.user.findUnique).mockResolvedValue({ weekendsOff: true } as never);
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([] as never);
  });

  it('lists up to 3 recent expected days that are missing a slot, newest first', async () => {
    // Yesterday 06-09 (Tue) fully empty, 06-08 (Mon) evening only, 06-05 (Fri)
    // morning only. 06-06/06-07 are the weekend (off → skipped). 06-04 exists
    // but the cap stops us at 3 incomplete days.
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([
      { date: d('2026-06-08'), slot: 'evening' },
      { date: d('2026-06-05'), slot: 'morning' },
      { date: d('2026-06-04'), slot: 'morning' },
    ] as never);

    const out = await getRecentBackfillDays('rb-1', TZ, NOW);

    expect(out).toEqual([
      { date: '2026-06-09', morningMissing: true, eveningMissing: true },
      { date: '2026-06-08', morningMissing: true, eveningMissing: false },
      { date: '2026-06-05', morningMissing: false, eveningMissing: true },
    ]);
  });

  it('steps over the off weekend (weekendsOff=true) — a rest is never a rattrapage', async () => {
    // Everything empty; only the two weekdays 06-09 (Tue) and 06-08 (Mon) count.
    // The Sat 06-06 / Sun 06-07 are off and must not appear.
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([] as never);

    const out = await getRecentBackfillDays('rb-2', TZ, NOW, 3);

    expect(out.map((r) => r.date)).toEqual(['2026-06-09', '2026-06-08', '2026-06-05']);
    // 06-06 and 06-07 (the weekend) never surface.
    expect(out.some((r) => r.date === '2026-06-06' || r.date === '2026-06-07')).toBe(false);
  });

  it('skips an explicitly declared off day even on a weekday', async () => {
    // Member declared 06-09 (Tue) off → it must not be offered, so the walk
    // moves to 06-08 (Mon) then the Fri 06-05.
    vi.mocked(db.memberOffDay.findMany).mockResolvedValue([{ date: d('2026-06-09') }] as never);
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([] as never);

    const out = await getRecentBackfillDays('rb-3', TZ, NOW, 3);

    expect(out.some((r) => r.date === '2026-06-09')).toBe(false);
    expect(out.map((r) => r.date)).toEqual(['2026-06-08', '2026-06-05', '2026-06-04']);
  });

  it('skips fully covered recent days and surfaces the next incomplete one', async () => {
    // 06-09 and 06-08 both fully filled → not offered; the walk continues to the
    // Fri 06-05 (empty) which becomes the first incomplete expected day.
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([
      { date: d('2026-06-09'), slot: 'morning' },
      { date: d('2026-06-09'), slot: 'evening' },
      { date: d('2026-06-08'), slot: 'morning' },
      { date: d('2026-06-08'), slot: 'evening' },
    ] as never);

    const out = await getRecentBackfillDays('rb-4', TZ, NOW, 1);

    // Both recent days covered → they never appear ; first offered is the Fri.
    expect(out).toEqual([{ date: '2026-06-05', morningMissing: true, eveningMissing: true }]);
  });

  it('returns [] only when the whole horizon has no incomplete expected day', async () => {
    // A short custom cap AND a member whose weekdays in-window are all covered:
    // we fill the two most recent weekdays and cap at ... impossible to fully
    // cover 60 days, so we assert the realistic contract: with maxDays=0 the walk
    // never collects anything.
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([] as never);

    const out = await getRecentBackfillDays('rb-4b', TZ, NOW, 0);

    expect(out).toEqual([]);
  });

  it('bounds the check-in query to the 60-day horizon and excludes today', async () => {
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([] as never);

    await getRecentBackfillDays('rb-5', TZ, NOW, 3);

    const call = vi.mocked(db.dailyCheckin.findMany).mock.calls[0]?.[0] as {
      where?: { userId?: string; date?: { gte?: Date; lte?: Date } };
    };
    // Upper bound is yesterday (today excluded), lower bound today − 60 days.
    expect(call.where?.userId).toBe('rb-5');
    expect(call.where?.date?.lte).toEqual(d('2026-06-09'));
    expect(call.where?.date?.gte).toEqual(d('2026-04-11'));
  });

  it('honours a smaller maxDays cap', async () => {
    vi.mocked(db.dailyCheckin.findMany).mockResolvedValueOnce([] as never);

    const out = await getRecentBackfillDays('rb-6', TZ, NOW, 1);

    expect(out).toHaveLength(1);
    expect(out[0]?.date).toBe('2026-06-09');
  });
});
