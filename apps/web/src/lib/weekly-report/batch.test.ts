import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks must be hoisted BEFORE importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
    weeklyReport: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportError, reportWarning } from '@/lib/observability';

import { persistGeneratedReports } from './batch';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Valid `WeeklyReportOutput` that satisfies the strict Zod schema. Summary
 * is 130 chars (over SUMMARY_MIN_CHARS=100), risks/recos are >=20 chars each.
 */
function validOutput(
  overrides: { summary?: string; risks?: string[]; recommendations?: string[] } = {},
) {
  return {
    summary:
      overrides.summary ??
      'Semaine globalement régulière, sept trades alignés au plan dont quatre clos en profit modéré, deux pertes maîtrisées sous la zone risque.',
    risks: overrides.risks ?? ['Surveille la fatigue accumulée sur la session de jeudi soir.'],
    recommendations: overrides.recommendations ?? [
      'Maintiens ta routine matin (check-in + revue du plan).',
    ],
    patterns: {},
  };
}

describe('persistGeneratedReports', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: 'user-active-1' } as never,
      { id: 'user-active-2' } as never,
    ]);
    vi.mocked(db.weeklyReport.upsert).mockResolvedValue({} as never);
    vi.mocked(logAudit).mockResolvedValue(undefined);
  });

  it('happy path : persists 1 valid entry + emits weekly_report.batch.persisted audit', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [{ userId: 'user-active-1', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 1, skipped: 0, errors: 0 });
    expect(db.weeklyReport.upsert).toHaveBeenCalledOnce();
    // The aggregate persisted audit row is emitted last
    const persistAudit = vi
      .mocked(logAudit)
      .mock.calls.find(([arg]) => arg.action === 'weekly_report.batch.persisted');
    expect(persistAudit).toBeDefined();
    expect(persistAudit?.[0].metadata).toMatchObject({
      persisted: 1,
      skipped: 0,
      errors: 0,
      total: 1,
    });
  });

  it('rejects malformed output via Zod safeParse (summary too short)', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [{ userId: 'user-active-1', output: validOutput({ summary: 'too short' }) }],
    });

    expect(result.errors).toBe(1);
    expect(result.persisted).toBe(0);
    expect(db.weeklyReport.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(([arg]) => arg.action === 'weekly_report.batch.invalid_output'),
    ).toBe(true);
  });

  it('returns errors=N + audit row when the week window is invalid (parseLocalDate throws)', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-02-30', // not a real calendar date
      weekEnd: '2026-03-06',
      results: [
        { userId: 'user-active-1', output: validOutput() },
        { userId: 'user-active-2', output: validOutput() },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 0, errors: 2 });
    expect(db.weeklyReport.upsert).not.toHaveBeenCalled();
    const auditCalls = vi.mocked(logAudit).mock.calls;
    expect(
      auditCalls.some(
        ([arg]) =>
          arg.action === 'weekly_report.batch.invalid_output' &&
          (arg.metadata as { reason?: string })?.reason === 'invalid_week_window',
      ),
    ).toBe(true);
  });

  it('skips entries targeting unknown or inactive users (defense against forged userId)', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [{ userId: 'user-ghost', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.weeklyReport.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'weekly_report.batch.skipped' &&
            (arg.metadata as { reason?: string })?.reason === 'unknown_or_inactive_user',
        ),
    ).toBe(true);
  });

  it('skips entries with crisis HIGH signal and emits reportError', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            summary:
              'Cette semaine, le membre a clairement évoqué vouloir en finir, signal préoccupant. Surveiller au plus vite.',
          }),
        },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.weeklyReport.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'weekly_report.batch.crisis_detected' &&
            (arg.metadata as { level?: string })?.level === 'high',
        ),
    ).toBe(true);
    expect(reportError).toHaveBeenCalled();
  });

  it('skips entries with crisis MEDIUM signal and emits reportWarning', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            summary:
              "Le membre se dit profondément désespéré face aux pertes répétées de la semaine, à recadrer immédiatement avant l'effet boule de neige.",
          }),
        },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'weekly_report.batch.crisis_detected' &&
            (arg.metadata as { level?: string })?.level === 'medium',
        ),
    ).toBe(true);
    expect(reportWarning).toHaveBeenCalled();
  });

  it('does NOT trigger crisis on trading slang ("tout perdre sur ce trade")', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            summary:
              'Mauvaise gestion de risque jeudi : le membre a failli tout perdre sur ce trade GBPUSD, à recadrer dès lundi matin pour éviter la répétition.',
          }),
        },
      ],
    });

    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(db.weeklyReport.upsert).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
  });

  it('passes through entries with explicit error field (claude --print failure)', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [{ userId: 'user-active-1', error: 'claude_exit_1' }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.weeklyReport.upsert).not.toHaveBeenCalled();
    expect(
      vi.mocked(logAudit).mock.calls.some(([arg]) => arg.action === 'weekly_report.batch.skipped'),
    ).toBe(true);
  });

  it('falls back to claude-code-local sentinel when a forged model name is provided', async () => {
    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [
        {
          userId: 'user-active-1',
          output: validOutput(),
          model: 'claude-opus-5-megabuck', // not in allowlist
          usage: { inputTokens: 999_999, outputTokens: 999_999 },
        },
      ],
    });

    expect(result.persisted).toBe(1);
    const upsertCall = vi.mocked(db.weeklyReport.upsert).mock.calls[0]?.[0] as
      | { create: { claudeModel: string; costEur: string } }
      | undefined;
    expect(upsertCall?.create.claudeModel).toBe('claude-code-local');
    expect(upsertCall?.create.costEur).toBe('0.000000');
  });

  it('counts upsert exceptions as errors + emits persist_failed audit (no propagation)', async () => {
    vi.mocked(db.weeklyReport.upsert).mockRejectedValueOnce(new Error('Postgres pool exhausted'));

    const result = await persistGeneratedReports({
      weekStart: '2026-05-05',
      weekEnd: '2026-05-11',
      results: [{ userId: 'user-active-1', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 0, errors: 1 });
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(([arg]) => arg.action === 'weekly_report.batch.persist_failed'),
    ).toBe(true);
  });
});
