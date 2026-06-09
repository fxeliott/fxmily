import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    weeklyScheduleQuestionnaire: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    adaptiveCalendar: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    trade: { count: vi.fn() },
    dailyCheckin: { count: vi.fn() },
    mindsetCheck: { findFirst: vi.fn() },
    memberProfile: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/training/training-trade-service', () => ({
  countRecentTrainingActivity: vi.fn(),
}));

vi.mock('@/lib/weekly-report/builder', () => ({
  pseudonymizeMember: vi.fn(() => 'member-TEST1234'),
}));

import { Prisma } from '@/generated/prisma/client';

import { db } from '@/lib/db';
import { countRecentTrainingActivity } from '@/lib/training/training-trade-service';
import type { AdaptiveCalendarOutput } from '@/lib/schemas/adaptive-calendar';
import type { SubmitWeeklyScheduleInput } from '@/lib/schemas/weekly-schedule-questionnaire';

import {
  getCalendarForUser,
  getQuestionnaireForUser,
  loadCalendarSnapshotForUser,
  markAdaptiveCalendarDisclosureShown,
  persistAdaptiveCalendar,
  submitWeeklyScheduleQuestionnaire,
} from './service';

const ON = { morning: true, afternoon: false, evening: true };
const OFF = { morning: false, afternoon: false, evening: false };

function input(overrides: Partial<SubmitWeeklyScheduleInput> = {}): SubmitWeeklyScheduleInput {
  return {
    weekStart: '2026-06-08',
    responses: {
      profile: 'salarie',
      sessionGoal: 3,
      weekdayAvailability: { monday: ON, tuesday: OFF, wednesday: ON, thursday: OFF, friday: ON },
      weekendAvailability: { saturday: ON, sunday: OFF },
      sleep: 'standard',
      energyPeak: 'afternoon',
      meetingCommitment: 'occasional',
      practiceFocus: 'balanced',
      constraint: 'none',
    },
    ...overrides,
  };
}

function questionnaireRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wsq-1',
    userId: 'user-1',
    weekStart: new Date('2026-06-08T00:00:00.000Z'),
    instrumentVersion: 1,
    energyPeakSlot: 'afternoon',
    responses: input().responses,
    createdAt: new Date('2026-06-07T10:00:00.000Z'),
    updatedAt: new Date('2026-06-07T10:00:00.000Z'),
    ...overrides,
  };
}

function calendarOutput(category = 'backtest'): AdaptiveCalendarOutput {
  return {
    weekStart: '2026-06-08',
    overview: 'x'.repeat(120),
    days: Array.from({ length: 7 }, (_v, i) => ({
      date: `2026-06-${String(8 + i).padStart(2, '0')}`,
      dayLabel: `Jour ${i + 1}`,
      blocks: [{ slot: 'morning', category, durationMin: 60, label: 'Bloc', priority: 'medium' }],
    })),
    weeklyFocus: 'y'.repeat(80),
    warnings: [],
  } as AdaptiveCalendarOutput;
}

function calendarRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cal-1',
    userId: 'user-1',
    weekStart: new Date('2026-06-08T00:00:00.000Z'),
    schedule: calendarOutput(),
    primaryCategory: 'backtest',
    claudeModel: 'claude-opus-4-8',
    inputTokens: 3200,
    outputTokens: 950,
    costEur: new Prisma.Decimal('0.022200'),
    aiDisclosureShownAt: null,
    calendarInstrumentVersion: 1,
    generatedAt: new Date('2026-06-08T08:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('submitWeeklyScheduleQuestionnaire', () => {
  it('upserts with a UTC-midnight weekStart and the projected energy slot; wasNew=true on first submit', async () => {
    vi.mocked(db.weeklyScheduleQuestionnaire.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.weeklyScheduleQuestionnaire.upsert).mockResolvedValue(questionnaireRow() as never);

    const res = await submitWeeklyScheduleQuestionnaire('user-1', input());

    expect(res.wasNew).toBe(true);
    const call = vi.mocked(db.weeklyScheduleQuestionnaire.upsert).mock.calls[0];
    if (!call) throw new Error('expected upsert');
    const arg = call[0] as {
      where: { userId_weekStart: { weekStart: Date } };
      create: { energyPeakSlot: string; instrumentVersion: number };
    };
    // parseLocalDate('2026-06-08') → UTC midnight (anti-flake PR#96).
    expect(arg.where.userId_weekStart.weekStart.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(arg.create.energyPeakSlot).toBe('afternoon');
    expect(arg.create.instrumentVersion).toBe(1);
    expect(res.questionnaire.weekStart).toBe('2026-06-08');
  });

  it('reports wasNew=false when a questionnaire already exists for that week', async () => {
    vi.mocked(db.weeklyScheduleQuestionnaire.findUnique).mockResolvedValue({
      id: 'wsq-1',
    } as never);
    vi.mocked(db.weeklyScheduleQuestionnaire.upsert).mockResolvedValue(questionnaireRow() as never);

    const res = await submitWeeklyScheduleQuestionnaire('user-1', input());
    expect(res.wasNew).toBe(false);
  });
});

describe('getQuestionnaireForUser', () => {
  it('serializes a row (Date → YYYY-MM-DD / ISO)', async () => {
    vi.mocked(db.weeklyScheduleQuestionnaire.findUnique).mockResolvedValue(
      questionnaireRow() as never,
    );
    const res = await getQuestionnaireForUser('user-1', '2026-06-08');
    expect(res?.weekStart).toBe('2026-06-08');
    expect(res?.energyPeakSlot).toBe('afternoon');
    expect(res?.createdAt).toBe('2026-06-07T10:00:00.000Z');
  });

  it('returns null when there is no questionnaire', async () => {
    vi.mocked(db.weeklyScheduleQuestionnaire.findUnique).mockResolvedValue(null as never);
    expect(await getQuestionnaireForUser('user-1', '2026-06-08')).toBeNull();
  });
});

describe('persistAdaptiveCalendar', () => {
  it('derives primaryCategory, wraps costEur in Decimal, and upserts', async () => {
    vi.mocked(db.adaptiveCalendar.upsert).mockResolvedValue(calendarRow() as never);

    const res = await persistAdaptiveCalendar({
      userId: 'user-1',
      weekStart: '2026-06-08',
      output: calendarOutput('backtest'),
      claudeModel: 'claude-opus-4-8',
      inputTokens: 3200,
      outputTokens: 950,
      costEur: '0.022200',
      calendarInstrumentVersion: 1,
    });

    const call = vi.mocked(db.adaptiveCalendar.upsert).mock.calls[0];
    if (!call) throw new Error('expected upsert');
    const arg = call[0] as {
      create: { primaryCategory: string | null; costEur: unknown };
      update: { generatedAt: unknown };
    };
    expect(arg.create.primaryCategory).toBe('backtest');
    expect(arg.create.costEur).toBeInstanceOf(Prisma.Decimal);
    // Prisma.Decimal('0.022200').toString() normalises trailing zeros → '0.0222'.
    expect(res.costEur).toBe('0.0222');
    expect(res.primaryCategory).toBe('backtest');
  });

  it('refreshes `generatedAt` on the UPDATE branch (DoD#1 defect-D — freshness convergence)', async () => {
    // `generatedAt` is `@default(now())` → only set on INSERT. A regeneration
    // (upsert UPDATE) MUST bump it, otherwise the batch loader's freshness gate
    // (`questionnaire.updatedAt > calendar.generatedAt`) would stay true forever
    // and re-generate the member on every run. The UPDATE branch must therefore
    // carry a fresh `generatedAt` Date so `generatedAt > updatedAt` holds after a
    // regeneration → the member is excluded on the next run (idempotence).
    vi.mocked(db.adaptiveCalendar.upsert).mockResolvedValue(calendarRow() as never);
    const before = Date.now();

    await persistAdaptiveCalendar({
      userId: 'user-1',
      weekStart: '2026-06-08',
      output: calendarOutput('backtest'),
      claudeModel: 'claude-opus-4-8',
      inputTokens: 3200,
      outputTokens: 950,
      costEur: '0.022200',
      calendarInstrumentVersion: 1,
    });

    const call = vi.mocked(db.adaptiveCalendar.upsert).mock.calls[0];
    if (!call) throw new Error('expected upsert');
    const arg = call[0] as { update: { generatedAt: unknown } };
    expect(arg.update.generatedAt).toBeInstanceOf(Date);
    expect((arg.update.generatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('loadCalendarSnapshotForUser', () => {
  it('returns null when the member has no questionnaire for that week', async () => {
    vi.mocked(db.weeklyScheduleQuestionnaire.findUnique).mockResolvedValue(null as never);
    expect(await loadCalendarSnapshotForUser('user-1', '2026-06-08')).toBeNull();
  });

  it('assembles a count-only snapshot from the activity reads', async () => {
    vi.mocked(db.weeklyScheduleQuestionnaire.findUnique).mockResolvedValue(
      questionnaireRow() as never,
    );
    vi.mocked(db.trade.count).mockResolvedValue(12 as never);
    vi.mocked(db.dailyCheckin.count).mockResolvedValue(9 as never);
    vi.mocked(countRecentTrainingActivity).mockResolvedValue({ count: 4, lastEnteredAt: null });
    vi.mocked(db.mindsetCheck.findFirst).mockResolvedValue({
      weekStart: new Date('2026-06-01T00:00:00.000Z'),
    } as never);
    vi.mocked(db.memberProfile.findUnique).mockResolvedValue({
      summary: 'Profil discipline.',
    } as never);

    const snap = await loadCalendarSnapshotForUser(
      'user-1',
      '2026-06-08',
      new Date('2026-06-08T09:00:00.000Z'),
    );

    expect(snap).not.toBeNull();
    expect(snap?.pseudonymLabel).toBe('member-TEST1234');
    expect(snap?.activity).toEqual({
      tradesLast30d: 12,
      checkinsLast14d: 9,
      trainingSessionsLast14d: 4,
      lastMindsetCheckDate: '2026-06-01',
    });
    expect(snap?.profileSummary).toBe('Profil discipline.');
    // The §21.5 sanctioned training read got the right 14-day window boundary.
    const tcall = vi.mocked(countRecentTrainingActivity).mock.calls[0];
    if (!tcall) throw new Error('expected count call');
    expect(tcall[0]).toBe('user-1');
    expect((tcall[1] as Date).toISOString()).toBe('2026-05-25T09:00:00.000Z');
  });

  it('tolerates a member with no mindset check and no profile (nulls)', async () => {
    vi.mocked(db.weeklyScheduleQuestionnaire.findUnique).mockResolvedValue(
      questionnaireRow() as never,
    );
    vi.mocked(db.trade.count).mockResolvedValue(0 as never);
    vi.mocked(db.dailyCheckin.count).mockResolvedValue(0 as never);
    vi.mocked(countRecentTrainingActivity).mockResolvedValue({ count: 0, lastEnteredAt: null });
    vi.mocked(db.mindsetCheck.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.memberProfile.findUnique).mockResolvedValue(null as never);

    const snap = await loadCalendarSnapshotForUser('user-1', '2026-06-08');
    expect(snap?.activity.lastMindsetCheckDate).toBeNull();
    expect(snap?.profileSummary).toBeNull();
  });
});

describe('markAdaptiveCalendarDisclosureShown', () => {
  it('stamps the disclosure via updateMany and returns the calendar', async () => {
    vi.mocked(db.adaptiveCalendar.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.adaptiveCalendar.findUnique).mockResolvedValue(
      calendarRow({ aiDisclosureShownAt: new Date('2026-06-08T08:30:00.000Z') }) as never,
    );

    const res = await markAdaptiveCalendarDisclosureShown('user-1', '2026-06-08');
    expect(db.adaptiveCalendar.updateMany).toHaveBeenCalledTimes(1);
    expect(res?.aiDisclosureShownAt).toBe('2026-06-08T08:30:00.000Z');
  });
});

describe('getCalendarForUser', () => {
  it('returns null when there is no calendar for the week', async () => {
    vi.mocked(db.adaptiveCalendar.findUnique).mockResolvedValue(null as never);
    expect(await getCalendarForUser('user-1', '2026-06-08')).toBeNull();
  });
});
