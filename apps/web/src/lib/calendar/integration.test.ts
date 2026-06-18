import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session 6 — DoD §32 #1 « testé » : the questionnaire → calendar CHAIN.
 *
 * Unlike `batch.test.ts` (which mocks `./service` to isolate the orchestrator),
 * this integration test runs the REAL service layer + the REAL MockCalendarClient
 * over a STATEFUL in-memory `@/lib/db` mock, so the full pipeline genuinely
 * flows end-to-end :
 *
 *   1. an active member submitted a `WeeklyScheduleQuestionnaire` for week S ;
 *   2. `loadAllSnapshotsForCalendarGeneration` emits THAT member in `entries`
 *      (and a member WITHOUT a questionnaire is excluded) ;
 *   3. `MockCalendarClient.generate(snapshot)` produces a Zod-valid output ;
 *   4. `persistGeneratedCalendars(...)` with that output → `persisted: 1` ;
 *   5. after persist, `getCalendarForUser(...)` returns non-null for the member.
 *
 * Plus the DoD#1 defect-D freshness gate (batch.ts:214-220) : a member whose
 * questionnaire has NOT changed since generation is EXCLUDED (idempotence), but
 * a re-submission (`updatedAt > generatedAt`) RE-INCLUDES them.
 *
 * detectCrisis / detectAMFViolation / Zod / parseLocalDate run REAL — only the
 * DB rows are faked. Carbone the batch.test.ts mock style (vi.mock @/lib/db,
 * @/lib/auth/audit, @/lib/observability) but keeps `./service` live.
 */

// ---------------------------------------------------------------------------
// Stateful in-memory store — keyed by userId. Only the methods/filters the
// real chain actually exercises are implemented.
// ---------------------------------------------------------------------------

const WEEK_START = '2026-06-08'; // a Monday (Europe/Paris)
/** Same UTC-midnight Date `parseLocalDate('2026-06-08')` yields. */
const WEEK_START_DB = new Date(Date.UTC(2026, 5, 8));

interface QuestionnaireRow {
  id: string;
  userId: string;
  weekStart: Date;
  instrumentVersion: number;
  energyPeakSlot: string;
  responses: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface CalendarRow {
  id: string;
  userId: string;
  weekStart: Date;
  schedule: unknown;
  primaryCategory: string | null;
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  costEur: { toString(): string };
  aiDisclosureShownAt: Date | null;
  calendarInstrumentVersion: number;
  generatedAt: Date;
}

const store = {
  users: [] as Array<{ id: string; status: string; joinedAt: Date }>,
  questionnaires: [] as QuestionnaireRow[],
  calendars: [] as CalendarRow[],
};

function resetStore(): void {
  store.users = [];
  store.questionnaires = [];
  store.calendars = [];
}

function sameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

/** Minimal WeeklyScheduleResponses — same shape as batch.test.ts's fixture. */
function responsesFixture() {
  return {
    profile: 'salarie',
    sessionGoal: 3,
    weekdayAvailability: {
      monday: { morning: true, afternoon: false, evening: true },
      tuesday: { morning: false, afternoon: false, evening: true },
      wednesday: { morning: true, afternoon: false, evening: false },
      thursday: { morning: false, afternoon: false, evening: true },
      friday: { morning: true, afternoon: false, evening: false },
    },
    weekendAvailability: {
      saturday: { morning: true, afternoon: true, evening: false },
      sunday: { morning: false, afternoon: false, evening: false },
    },
    sleep: 'standard',
    energyPeak: 'morning',
    meetingCommitment: 'occasional',
    practiceFocus: 'balanced',
    constraint: 'none',
  };
}

function seedUser(id: string): void {
  store.users.push({ id, status: 'active', joinedAt: new Date('2026-01-01T00:00:00Z') });
}

function seedQuestionnaire(userId: string, updatedAt: Date): void {
  store.questionnaires.push({
    id: `q-${userId}`,
    userId,
    weekStart: WEEK_START_DB,
    instrumentVersion: 1,
    energyPeakSlot: 'morning',
    responses: responsesFixture(),
    createdAt: updatedAt,
    updatedAt,
  });
}

function seedCalendar(userId: string, generatedAt: Date): void {
  store.calendars.push({
    id: `c-${userId}`,
    userId,
    weekStart: WEEK_START_DB,
    schedule: { weekStart: WEEK_START, days: [], overview: '', weeklyFocus: '', warnings: [] },
    primaryCategory: 'live_trading',
    claudeModel: 'claude-code-local',
    inputTokens: 0,
    outputTokens: 0,
    costEur: { toString: () => '0.000000' },
    aiDisclosureShownAt: null,
    calendarInstrumentVersion: 1,
    generatedAt,
  });
}

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(async (args: { where?: { status?: string } } = {}) => {
        const wantActive = args.where?.status === 'active';
        return store.users
          .filter((u) => (wantActive ? u.status === 'active' : true))
          .map((u) => ({ id: u.id }));
      }),
    },
    weeklyScheduleQuestionnaire: {
      findMany: vi.fn(async (args: { where?: { weekStart?: Date } } = {}) =>
        store.questionnaires
          .filter((q) =>
            args.where?.weekStart ? sameDay(q.weekStart, args.where.weekStart) : true,
          )
          .map((q) => ({
            userId: q.userId,
            updatedAt: q.updatedAt,
            instrumentVersion: q.instrumentVersion,
          })),
      ),
      findUnique: vi.fn(
        async (args: { where: { userId_weekStart: { userId: string; weekStart: Date } } }) => {
          const { userId, weekStart } = args.where.userId_weekStart;
          return (
            store.questionnaires.find(
              (q) => q.userId === userId && sameDay(q.weekStart, weekStart),
            ) ?? null
          );
        },
      ),
    },
    adaptiveCalendar: {
      findMany: vi.fn(async (args: { where?: { weekStart?: Date } } = {}) =>
        store.calendars
          .filter((c) =>
            args.where?.weekStart ? sameDay(c.weekStart, args.where.weekStart) : true,
          )
          .map((c) => ({ userId: c.userId, generatedAt: c.generatedAt })),
      ),
      findUnique: vi.fn(
        async (args: { where: { userId_weekStart: { userId: string; weekStart: Date } } }) => {
          const { userId, weekStart } = args.where.userId_weekStart;
          return (
            store.calendars.find((c) => c.userId === userId && sameDay(c.weekStart, weekStart)) ??
            null
          );
        },
      ),
      upsert: vi.fn(
        async (args: {
          where: { userId_weekStart: { userId: string; weekStart: Date } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const { userId, weekStart } = args.where.userId_weekStart;
          const existing = store.calendars.find(
            (c) => c.userId === userId && sameDay(c.weekStart, weekStart),
          );
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          const row: CalendarRow = {
            id: `c-${userId}`,
            aiDisclosureShownAt: null,
            generatedAt: new Date(),
            ...(args.create as object),
          } as CalendarRow;
          // The create payload stores `costEur` as a Prisma.Decimal-like; the
          // serializer calls `.toString()`, so normalize any value to that shape.
          if (typeof (row.costEur as unknown) !== 'object') {
            const raw = String(row.costEur);
            row.costEur = { toString: () => raw };
          }
          store.calendars.push(row);
          return row;
        },
      ),
    },
    // Count-only reads the snapshot loader fans out — every member is inactive
    // on these so the snapshot carries plausible zeros (the chain only needs
    // the questionnaire to exist).
    trade: { count: vi.fn(async () => 0) },
    dailyCheckin: { count: vi.fn(async () => 0) },
    trainingTrade: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
    },
    mindsetCheck: { findFirst: vi.fn(async () => null) },
    memberProfile: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { MockCalendarClient } from './claude-client';
import { getCalendarForUser } from './service';
import { loadAllSnapshotsForCalendarGeneration, persistGeneratedCalendars } from './batch';

beforeEach(() => {
  resetStore();
});

describe('calendar pipeline — questionnaire → calendar chain (DoD §32 #1)', () => {
  it('should_run_the_full_chain_when_a_member_submitted_a_questionnaire (load → generate → persist → read)', async () => {
    // Arrange — u1 submitted a questionnaire this week, u2 did NOT.
    seedUser('u1');
    seedUser('u2');
    seedQuestionnaire('u1', new Date('2026-06-08T08:00:00Z'));

    // Act 1 — pull snapshots eligible for generation.
    const envelope = await loadAllSnapshotsForCalendarGeneration({ weekStart: WEEK_START });

    // Assert 2 — only u1 (with a questionnaire) is a candidate; u2 is excluded.
    expect(envelope.weekStart).toBe(WEEK_START);
    expect(envelope.entries.map((e) => e.userId)).toEqual(['u1']);
    const entry = envelope.entries[0];
    expect(entry?.hasQuestionnaire).toBe(true);

    // Act 3 — generate a Zod-valid output via the real MockCalendarClient.
    const generation = await new MockCalendarClient().generate(entry!.snapshot);
    expect(generation.output.weekStart).toBe(WEEK_START);
    expect(generation.output.days).toHaveLength(7);

    // Act 4 — persist the generated calendar.
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'u1', output: generation.output }],
    });

    // Assert 4 — exactly one calendar persisted, nothing skipped/errored.
    expect(result).toEqual({ persisted: 1, skipped: 0, errors: 0 });

    // Act + Assert 5 — the calendar is now readable for u1, absent for u2.
    const u1Calendar = await getCalendarForUser('u1', WEEK_START);
    expect(u1Calendar).not.toBeNull();
    expect(u1Calendar?.userId).toBe('u1');
    expect(u1Calendar?.weekStart).toBe(WEEK_START);
    expect(u1Calendar?.schedule.days).toHaveLength(7);

    const u2Calendar = await getCalendarForUser('u2', WEEK_START);
    expect(u2Calendar).toBeNull();
  });

  it('should_exclude_a_member_whose_calendar_is_fresh_when_questionnaire_unchanged (freshness gate idempotence)', async () => {
    // Arrange — u1's questionnaire was submitted at 08:00, the calendar was
    // generated AFTER (08:30) and the questionnaire has not changed since →
    // updatedAt <= generatedAt → the plan is up to date → no re-generation.
    seedUser('u1');
    seedQuestionnaire('u1', new Date('2026-06-08T08:00:00Z'));
    seedCalendar('u1', new Date('2026-06-08T08:30:00Z'));

    // Act
    const envelope = await loadAllSnapshotsForCalendarGeneration({ weekStart: WEEK_START });

    // Assert — excluded from candidates (zero needless Claude re-cost).
    expect(envelope.entries).toHaveLength(0);
  });

  it('should_re_include_a_member_when_questionnaire_re_submitted_after_generation (freshness gate defect-D)', async () => {
    // Arrange — the calendar was generated Monday 08:30, but the member
    // re-submitted the questionnaire Tuesday 14:00 (dispo changed) →
    // updatedAt > generatedAt → the plan is stale → must regenerate.
    seedUser('u1');
    seedQuestionnaire('u1', new Date('2026-06-09T14:00:00Z'));
    seedCalendar('u1', new Date('2026-06-08T08:30:00Z'));

    // Act 1 — the stale member is re-included as a candidate.
    const envelope = await loadAllSnapshotsForCalendarGeneration({ weekStart: WEEK_START });
    expect(envelope.entries.map((e) => e.userId)).toEqual(['u1']);

    // Act 2 — regenerate + persist; the upsert overwrites the stale row.
    const generation = await new MockCalendarClient().generate(envelope.entries[0]!.snapshot);
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'u1', output: generation.output }],
    });
    expect(result).toEqual({ persisted: 1, skipped: 0, errors: 0 });

    // Assert — after regeneration `generatedAt` is refreshed past `updatedAt`
    // (persistAdaptiveCalendar bumps it), so the next pull excludes u1 again.
    const second = await loadAllSnapshotsForCalendarGeneration({ weekStart: WEEK_START });
    expect(second.entries).toHaveLength(0);
  });
});
