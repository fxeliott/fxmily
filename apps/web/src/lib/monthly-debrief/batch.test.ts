import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks must be hoisted BEFORE importing the module under test. Carbon of
// `weekly-report/batch.test.ts` adapted to the §25 monthly shapes.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
    monthlyDebrief: {
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
// Fixtures — must satisfy the strict `monthlyDebriefOutputSchema`
// (progressionNarrative ≥120, summaryReal/summaryTraining ≥80, ≥1 reco).
// ---------------------------------------------------------------------------

function validOutput(overrides: { progressionNarrative?: string } = {}) {
  return {
    progressionNarrative:
      overrides.progressionNarrative ??
      'Sur le mois, la discipline a progressé : le respect du plan est passé de soixante-cinq à quatre-vingts pour cent, signe d’une exécution plus posée et régulière.',
    summaryReal:
      'Douze trades réels ce mois, huit alignés au plan, deux pertes maîtrisées sous la zone de risque définie.',
    summaryTraining:
      'Pratique d’entraînement régulière ce mois : le volume de backtests reste constant, un bon rythme d’effort.',
    risks: ['Surveille la fatigue accumulée en fin de mois sur les sessions du soir.'],
    recommendations: [
      'Maintiens ta routine du matin (check-in puis revue du plan) chaque jour de trading.',
    ],
    patterns: {},
  };
}

describe('persistGeneratedReports (monthly)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: 'user-active-1' } as never,
      { id: 'user-active-2' } as never,
    ]);
    vi.mocked(db.monthlyDebrief.upsert).mockResolvedValue({} as never);
    vi.mocked(logAudit).mockResolvedValue(undefined);
  });

  it('happy path : persists 1 valid entry + emits monthly_debrief.batch.persisted audit', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [{ userId: 'user-active-1', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 1, skipped: 0, errors: 0 });
    expect(db.monthlyDebrief.upsert).toHaveBeenCalledOnce();
    const persistAudit = vi
      .mocked(logAudit)
      .mock.calls.find(([arg]) => arg.action === 'monthly_debrief.batch.persisted');
    expect(persistAudit).toBeDefined();
    expect(persistAudit?.[0].metadata).toMatchObject({
      persisted: 1,
      skipped: 0,
      errors: 0,
      total: 1,
    });
  });

  it('rejects malformed output via Zod safeParse (progressionNarrative too short)', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [
        { userId: 'user-active-1', output: validOutput({ progressionNarrative: 'too short' }) },
      ],
    });

    expect(result.errors).toBe(1);
    expect(result.persisted).toBe(0);
    expect(db.monthlyDebrief.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(([arg]) => arg.action === 'monthly_debrief.batch.invalid_output'),
    ).toBe(true);
  });

  it('returns errors=N + audit row when the month window is invalid (parseLocalDate throws)', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-02-30', // not a real calendar date
      monthEnd: '2026-03-31',
      results: [
        { userId: 'user-active-1', output: validOutput() },
        { userId: 'user-active-2', output: validOutput() },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 0, errors: 2 });
    expect(db.monthlyDebrief.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'monthly_debrief.batch.invalid_output' &&
            (arg.metadata as { reason?: string })?.reason === 'invalid_month_window',
        ),
    ).toBe(true);
  });

  it('skips entries targeting unknown or inactive users (forged userId defense)', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [{ userId: 'user-ghost', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.monthlyDebrief.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'monthly_debrief.batch.skipped' &&
            (arg.metadata as { reason?: string })?.reason === 'unknown_or_inactive_user',
        ),
    ).toBe(true);
  });

  it('skips entries with crisis HIGH signal in the AI output and emits reportError', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            progressionNarrative:
              'Ce mois a été difficile pour le membre, qui a clairement évoqué vouloir en finir face aux pertes répétées, un signal préoccupant à traiter sans délai.',
          }),
        },
      ],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.monthlyDebrief.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'monthly_debrief.batch.crisis_detected' &&
            (arg.metadata as { level?: string })?.level === 'high',
        ),
    ).toBe(true);
    expect(reportError).toHaveBeenCalled();
  });

  it('skips entries with crisis MEDIUM signal in the AI output and emits reportWarning', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            progressionNarrative:
              'Le membre se dit profondément désespéré face aux pertes répétées du mois écoulé, état à recadrer rapidement avant un effet boule de neige durable.',
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
            arg.action === 'monthly_debrief.batch.crisis_detected' &&
            (arg.metadata as { level?: string })?.level === 'medium',
        ),
    ).toBe(true);
    expect(reportWarning).toHaveBeenCalled();
  });

  it('does NOT trigger crisis on trading slang ("tout perdre sur ce trade")', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [
        {
          userId: 'user-active-1',
          output: validOutput({
            progressionNarrative:
              'Mauvaise gestion du risque en milieu de mois : le membre a failli tout perdre sur ce trade GBPUSD, à recadrer dès la reprise pour éviter la répétition.',
          }),
        },
      ],
    });

    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(db.monthlyDebrief.upsert).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
  });

  it('passes through entries with explicit error field (claude --print failure)', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [{ userId: 'user-active-1', error: 'claude_exit_1' }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.monthlyDebrief.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(([arg]) => arg.action === 'monthly_debrief.batch.skipped'),
    ).toBe(true);
  });

  it('falls back to claude-code-local sentinel when a forged model name is provided', async () => {
    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
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
    const upsertCall = vi.mocked(db.monthlyDebrief.upsert).mock.calls[0]?.[0] as
      | { create: { claudeModel: string; costEur: string } }
      | undefined;
    expect(upsertCall?.create.claudeModel).toBe('claude-code-local');
    expect(upsertCall?.create.costEur).toBe('0.000000');
  });

  it('counts upsert exceptions as errors + emits persist_failed audit (no propagation)', async () => {
    vi.mocked(db.monthlyDebrief.upsert).mockRejectedValueOnce(new Error('Postgres pool exhausted'));

    const result = await persistGeneratedReports({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [{ userId: 'user-active-1', output: validOutput() }],
    });

    expect(result).toEqual({ persisted: 0, skipped: 0, errors: 1 });
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(([arg]) => arg.action === 'monthly_debrief.batch.persist_failed'),
    ).toBe(true);
  });
});
