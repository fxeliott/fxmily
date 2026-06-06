import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks must be hoisted BEFORE importing the module under test.
//
// detectCrisis (@/lib/safety/crisis-detection) and detectAMFViolation
// (@/lib/onboarding-interview/safety) are PURE and run REAL so the crisis +
// AMF gates are genuinely exercised. parseLocalDate + Zod run real too.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn() },
    weeklyScheduleQuestionnaire: { findMany: vi.fn() },
    adaptiveCalendar: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

// The J-C1 service is mocked — the batch orchestrates it, the data-layer
// upsert + count-only reads are J-C1's own tested concern.
vi.mock('./service', () => ({
  loadCalendarSnapshotForUser: vi.fn(),
  persistAdaptiveCalendar: vi.fn(),
}));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportError, reportWarning } from '@/lib/observability';

import { loadAllSnapshotsForCalendarGeneration, persistGeneratedCalendars } from './batch';
import { loadCalendarSnapshotForUser, persistAdaptiveCalendar } from './service';
import type { CalendarSnapshot } from './snapshot';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEEK_START = '2026-06-08'; // a Monday (Europe/Paris) — only the YYYY-MM-DD shape matters to Zod
const WEEK_DATES = [
  '2026-06-08',
  '2026-06-09',
  '2026-06-10',
  '2026-06-11',
  '2026-06-12',
  '2026-06-13',
  '2026-06-14',
];

/** A Zod-valid `AdaptiveCalendarOutput` (7 days, overview 100-300, focus 50-200). */
function validOutput(
  overrides: { overview?: string; weeklyFocus?: string; warnings?: string[] } = {},
) {
  return {
    weekStart: WEEK_START,
    overview:
      overrides.overview ??
      'Voici ta semaine organisée autour de ta disponibilité et de ton objectif de sessions. Avance a ton rythme, sans pression : le plan suit tes creneaux reels.',
    days: WEEK_DATES.map((date) => ({
      date,
      dayLabel: 'Jour',
      blocks: [
        {
          slot: 'morning' as const,
          category: 'live_trading' as const,
          durationMin: 60,
          label: 'Session de trading',
          priority: 'high' as const,
        },
      ],
    })),
    weeklyFocus:
      overrides.weeklyFocus ??
      'Concentre-toi sur ton process cette semaine, pas sur le resultat de chaque session de pratique.',
    warnings: overrides.warnings ?? [],
  };
}

function fakeSnapshot(userId: string): CalendarSnapshot {
  return {
    pseudonymLabel: `member-${userId.slice(0, 8)}`,
    weekStart: WEEK_START,
    instrumentVersion: 1,
    profileSummary: null,
    responses: {
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
    },
    activity: {
      tradesLast30d: 4,
      checkinsLast14d: 6,
      trainingSessionsLast14d: 2,
      lastMindsetCheckDate: '2026-06-01',
    },
    availableSlotsCount: 8,
  };
}

// ===========================================================================
// persistGeneratedCalendars
// ===========================================================================

describe('persistGeneratedCalendars', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: 'user-active-1' } as never,
      { id: 'user-active-2' } as never,
    ]);
    // Both active users have a questionnaire for the target week (gate 3).
    vi.mocked(db.weeklyScheduleQuestionnaire.findMany).mockResolvedValue([
      { userId: 'user-active-1', instrumentVersion: 1 } as never,
      { userId: 'user-active-2', instrumentVersion: 1 } as never,
    ]);
    vi.mocked(persistAdaptiveCalendar).mockResolvedValue({} as never);
    vi.mocked(logAudit).mockResolvedValue(undefined as never);
  });

  it('happy path : persists 1 valid entry + emits calendar.batch.persisted + derives via persistAdaptiveCalendar', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'user-active-1', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 1, skipped: 0, errors: 0 });
    expect(persistAdaptiveCalendar).toHaveBeenCalledOnce();
    const persistAudit = vi
      .mocked(logAudit)
      .mock.calls.find(([arg]) => arg.action === 'calendar.batch.persisted');
    expect(persistAudit).toBeDefined();
    expect(persistAudit?.[0].metadata).toMatchObject({
      persisted: 1,
      skipped: 0,
      errors: 0,
      total: 1,
    });
  });

  it('rejects malformed output via Zod safeParse (overview too short)', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'user-active-1', output: validOutput({ overview: 'trop court' }) }],
    });

    expect(result.errors).toBe(1);
    expect(result.persisted).toBe(0);
    expect(persistAdaptiveCalendar).not.toHaveBeenCalled();
    expect(
      vi.mocked(logAudit).mock.calls.some(([a]) => a.action === 'calendar.batch.invalid_output'),
    ).toBe(true);
  });

  it('returns errors=N + audit row when the week window is invalid (parseLocalDate throws)', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: '2026-02-30', // not a real calendar date
      results: [
        { userId: 'user-active-1', output: validOutput() },
        { userId: 'user-active-2', output: validOutput() },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 0, errors: 2 });
    expect(persistAdaptiveCalendar).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([a]) =>
            a.action === 'calendar.batch.invalid_output' &&
            (a.metadata as { reason?: string })?.reason === 'invalid_week_window',
        ),
    ).toBe(true);
  });

  it('skips entries targeting unknown or inactive users (forged userId defense)', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'user-ghost', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(persistAdaptiveCalendar).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([a]) =>
            a.action === 'calendar.batch.skipped' &&
            (a.metadata as { reason?: string })?.reason === 'unknown_or_inactive_user',
        ),
    ).toBe(true);
  });

  it('skips an active user who has NO questionnaire for the week (calendar-only gate 3)', async () => {
    // user-active-1 is active but absent from the questionnaire set this week.
    vi.mocked(db.weeklyScheduleQuestionnaire.findMany).mockResolvedValue([
      { userId: 'user-active-2', instrumentVersion: 1 } as never,
    ]);

    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'user-active-1', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(persistAdaptiveCalendar).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([a]) =>
            a.action === 'calendar.batch.skipped' &&
            (a.metadata as { reason?: string })?.reason === 'no_questionnaire',
        ),
    ).toBe(true);
  });

  it('skips entries with a crisis HIGH signal in the AI output and emits reportError', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            overview:
              'Ta semaine est organisee mais tu as exprime vouloir en finir, ce que je prends tres au serieux et qu il faut accompagner sans tarder maintenant.',
          }),
        },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(persistAdaptiveCalendar).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([a]) =>
            a.action === 'calendar.batch.crisis_detected' &&
            (a.metadata as { level?: string })?.level === 'high',
        ),
    ).toBe(true);
    expect(reportError).toHaveBeenCalled();
  });

  it('skips entries with a crisis MEDIUM signal in the AI output and emits reportWarning', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            overview:
              'Tu sembles profondément désespéré face à ta semaine, ce signal je le prends au sérieux et il faut en parler sans tarder ensemble dès maintenant.',
          }),
        },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([a]) =>
            a.action === 'calendar.batch.crisis_detected' &&
            (a.metadata as { level?: string })?.level === 'medium',
        ),
    ).toBe(true);
    expect(reportWarning).toHaveBeenCalled();
  });

  it('does NOT trigger crisis on trading slang ("tout perdre sur ce trade")', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            overview:
              'Semaine cote risque a recadrer : tu as failli tout perdre sur ce trade jeudi, on remet un plan clair et calme des lundi prochain ensemble.',
          }),
        },
      ],
    });

    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(persistAdaptiveCalendar).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
  });

  it('skips + emits calendar.batch.amf_violation when the AI output carries market advice (§2 posture)', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            weeklyFocus:
              'Cette semaine je te conseille d acheter des l ouverture de Londres pour viser le sommet, le marche est porteur.',
          }),
        },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(persistAdaptiveCalendar).not.toHaveBeenCalled();
    expect(
      vi.mocked(logAudit).mock.calls.some(([a]) => a.action === 'calendar.batch.amf_violation'),
    ).toBe(true);
    expect(reportWarning).toHaveBeenCalled();
  });

  it('passes through entries with an explicit error field (claude --print failure)', async () => {
    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'user-active-1', error: 'claude_exit_1' }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(persistAdaptiveCalendar).not.toHaveBeenCalled();
    expect(
      vi.mocked(logAudit).mock.calls.some(([a]) => a.action === 'calendar.batch.skipped'),
    ).toBe(true);
  });

  it('falls back to the claude-code-local sentinel (cost 0) when a forged model name is provided', async () => {
    await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [
        {
          userId: 'user-active-1',
          output: validOutput(),
          model: 'claude-opus-5-megabuck', // not in allowlist
          usage: { inputTokens: 999_999, outputTokens: 999_999 },
        },
      ],
    });

    const call = vi.mocked(persistAdaptiveCalendar).mock.calls[0]?.[0];
    expect(call?.claudeModel).toBe('claude-code-local');
    expect(call?.costEur).toBe('0.000000');
    expect(call?.calendarInstrumentVersion).toBe(1);
  });

  it('counts persistAdaptiveCalendar exceptions as errors + emits persist_failed (no propagation)', async () => {
    vi.mocked(persistAdaptiveCalendar).mockRejectedValueOnce(new Error('Postgres pool exhausted'));

    const result = await persistGeneratedCalendars({
      weekStart: WEEK_START,
      results: [{ userId: 'user-active-1', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 0, errors: 1 });
    expect(
      vi.mocked(logAudit).mock.calls.some(([a]) => a.action === 'calendar.batch.persist_failed'),
    ).toBe(true);
  });
});

// ===========================================================================
// loadAllSnapshotsForCalendarGeneration
// ===========================================================================

describe('loadAllSnapshotsForCalendarGeneration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logAudit).mockResolvedValue(undefined as never);
  });

  it('emits only members WITH a questionnaire AND WITHOUT a calendar (idempotency double-net)', async () => {
    // u1 : questionnaire, no calendar → eligible.
    // u2 : questionnaire, ALREADY has a calendar → idempotency skip.
    // u3 : no questionnaire → skip.
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: 'u1' } as never,
      { id: 'u2' } as never,
      { id: 'u3' } as never,
    ]);
    vi.mocked(db.weeklyScheduleQuestionnaire.findMany).mockResolvedValue([
      { userId: 'u1' } as never,
      { userId: 'u2' } as never,
    ]);
    vi.mocked(db.adaptiveCalendar.findMany).mockResolvedValue([{ userId: 'u2' } as never]);
    vi.mocked(loadCalendarSnapshotForUser).mockImplementation(async (userId: string) =>
      fakeSnapshot(userId),
    );

    const envelope = await loadAllSnapshotsForCalendarGeneration({ weekStart: WEEK_START });

    expect(envelope.weekStart).toBe(WEEK_START);
    expect(envelope.entries).toHaveLength(1);
    expect(envelope.entries[0]?.userId).toBe('u1');
    expect(envelope.entries[0]?.hasQuestionnaire).toBe(true);
    expect(envelope.systemPrompt.length).toBeGreaterThan(0);
    // u2 (already generated) + u3 (no questionnaire) are never read.
    expect(loadCalendarSnapshotForUser).toHaveBeenCalledTimes(1);
    expect(loadCalendarSnapshotForUser).toHaveBeenCalledWith('u1', WEEK_START, expect.any(Date));
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([a]) =>
            a.action === 'calendar.batch.pulled' &&
            (a.metadata as { entriesCount?: number })?.entriesCount === 1,
        ),
    ).toBe(true);
  });

  it('drops a member whose snapshot vanished mid-run (defensive null)', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: 'u1' } as never]);
    vi.mocked(db.weeklyScheduleQuestionnaire.findMany).mockResolvedValue([
      { userId: 'u1' } as never,
    ]);
    vi.mocked(db.adaptiveCalendar.findMany).mockResolvedValue([]);
    vi.mocked(loadCalendarSnapshotForUser).mockResolvedValue(null);

    const envelope = await loadAllSnapshotsForCalendarGeneration({ weekStart: WEEK_START });

    expect(envelope.entries).toHaveLength(0);
  });
});
