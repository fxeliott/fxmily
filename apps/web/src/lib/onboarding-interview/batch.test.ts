import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2.4 Phase A.2 — `persistGeneratedProfiles` 6-gate fail-fast tests.
 *
 * Pattern carbone V1.7 `weekly-report/batch.test.ts` — mock Prisma client +
 * audit + observability + crisis detection BEFORE importing the SUT.
 *
 * The 6 gates tested here (in order, fail-fast) :
 *   Gate 1 — active user check (reject forged userId)
 *   Gate 2 — interview owner match (BOLA-resistant)
 *   Gate 3 — Zod strict re-parse (defense-in-depth)
 *   Gate 4 — Crisis routing SKIP-PERSIST (mirror V1.7.1)
 *   Gate 5 — Safety gate composite (AMF + clinical + evidence substring NFC)
 *   Gate 6 — Prisma upsert MemberProfile (idempotent on userId)
 */

// =============================================================================
// Mocks (must be declared BEFORE importing SUT)
// =============================================================================

const userFindManyMock = vi.fn();
const interviewFindManyMock = vi.fn();
const interviewFindUniqueMock = vi.fn();
const interviewUpdateMock = vi.fn();
const answerFindManyMock = vi.fn();
const profileFindManyMock = vi.fn();
const profileUpsertMock = vi.fn();
const auditLogCreateMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: userFindManyMock },
    onboardingInterview: {
      findMany: interviewFindManyMock,
      findUnique: interviewFindUniqueMock,
      update: interviewUpdateMock,
    },
    onboardingInterviewAnswer: { findMany: answerFindManyMock },
    memberProfile: {
      findMany: profileFindManyMock,
      upsert: profileUpsertMock,
    },
    auditLog: { create: auditLogCreateMock },
  },
}));

const logAuditMock = vi.fn();
vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

const reportErrorMock = vi.fn();
const reportWarningMock = vi.fn();
vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  reportWarning: reportWarningMock,
}));

const detectCrisisMock = vi.fn();
vi.mock('@/lib/safety/crisis-detection', () => ({
  detectCrisis: detectCrisisMock,
}));

// Mock pseudonymizeMember to avoid loading the full weekly-report module
vi.mock('@/lib/weekly-report/builder', () => ({
  pseudonymizeMember: (userId: string) => `member-${userId.slice(0, 8)}`,
}));

const {
  persistGeneratedProfiles,
  canonicalizeBatchErrorCategory,
  loadAllSnapshotsForCompletedInterviews,
} = await import('./batch');

import type { BatchPersistRequest, BatchResultEntry } from './batch';
import type { MemberProfileOutput } from '@/lib/schemas/onboarding-interview';
import { CURRENT_ONBOARDING_INSTRUMENT } from './instrument-v1';

// =============================================================================
// Test fixtures
// =============================================================================

function makeValidOutput(overrides: Partial<MemberProfileOutput> = {}): MemberProfileOutput {
  return {
    summary:
      'Profil descriptif standard du membre — process-focus présent, work in progress sur la discipline plan-adherence. Routine matinale stable. Awareness somatique sous stress.',
    highlights: [
      {
        key: 'pattern-one',
        label: 'Pattern un',
        evidence: ["J'ai démarré le trading"],
      },
      {
        key: 'pattern-two',
        label: 'Pattern deux',
        evidence: ['Honnêtement 4 sur 10'],
      },
      {
        key: 'pattern-three',
        label: 'Pattern trois',
        evidence: ['Tension dans les épaules'],
      },
    ],
    axes_prioritaires: [
      'Travailler la consistance du plan personnel',
      'Capitaliser sur les routines déjà solides',
      'Approfondir la self-awareness somatique',
    ],
    ...overrides,
  };
}

function makeRequestEntry(
  variant: 'output' | 'error',
  userId = 'user_123',
  interviewId = 'iv_abc',
): BatchResultEntry {
  if (variant === 'error') {
    return { userId, interviewId, error: 'claude_exit_1' };
  }
  return {
    userId,
    interviewId,
    output: makeValidOutput(),
    model: 'claude-sonnet-4-6',
  };
}

function setupSuccessMocks(opts: { userIds?: string[]; interviewIds?: string[] } = {}): void {
  const userIds = opts.userIds ?? ['user_123'];
  const interviewIds = opts.interviewIds ?? ['iv_abc'];
  userFindManyMock.mockResolvedValue(userIds.map((id) => ({ id })));
  interviewFindManyMock.mockResolvedValue(
    interviewIds.map((id, idx) => ({
      id,
      userId: userIds[idx] ?? userIds[0],
    })),
  );
  // For Gate 5 (rederive snapshot for evidence validation)
  interviewFindUniqueMock.mockResolvedValue({
    id: interviewIds[0],
    userId: userIds[0],
    instrumentVersion: 'v1',
    startedAt: new Date('2026-05-28T10:00:00Z'),
    completedAt: new Date('2026-05-28T10:30:00Z'),
  });
  answerFindManyMock.mockResolvedValue([
    {
      questionIndex: 0,
      questionKey: 'parcours_origin',
      questionText: 'Question',
      answerText:
        "J'ai démarré le trading en 2022. Honnêtement 4 sur 10 trades selon plan. Tension dans les épaules.",
    },
  ]);
  profileUpsertMock.mockResolvedValue({});
  interviewUpdateMock.mockResolvedValue({});
  detectCrisisMock.mockReturnValue({ level: 'none', matches: [] });
}

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Tests — 6 gates fail-fast coverage
// =============================================================================

describe('persistGeneratedProfiles — happy path + error variant', () => {
  beforeEach(() => {
    setupSuccessMocks();
  });

  it('persists a valid entry + emits member_profile.analyzed audit', async () => {
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(profileUpsertMock).toHaveBeenCalledTimes(1);

    // member_profile.analyzed audit row
    const analyzedCall = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'member_profile.analyzed',
    );
    expect(analyzedCall).toBeDefined();
  });

  it('skips entry.error variant (claude exit non-zero)', async () => {
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('error')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(profileUpsertMock).not.toHaveBeenCalled();

    const skippedCall = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'onboarding.batch.skipped',
    );
    expect(skippedCall).toBeDefined();

    // Anti-skip guardrail — a completed interview that produced no profile
    // (Claude refusal / non-zero exit) escalates to Sentry for human review.
    const warnCall = reportWarningMock.mock.calls.find(
      (c) => c[1] === 'entry_error_no_profile_review_needed',
    );
    expect(warnCall).toBeDefined();

    // PII boundary — the Sentry extra carries a canonical category, never the
    // raw orchestrator-supplied error string.
    expect(warnCall?.[2]).toMatchObject({ errorCategory: 'claude_exit' });
    expect(warnCall?.[2]).not.toHaveProperty('reason');
  });
});

describe('persistGeneratedProfiles — model attribution pin (mirror weekly BLOQUANT 5)', () => {
  beforeEach(() => {
    setupSuccessMocks();
  });

  it('records a known wire-provided model verbatim (claude-opus-4-8)', async () => {
    const entry = makeRequestEntry('output');
    const request: BatchPersistRequest = {
      results: [{ ...entry, model: 'claude-opus-4-8' } as BatchResultEntry],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.persisted).toBe(1);
    expect(profileUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ claudeModelVersion: 'claude-opus-4-8' }),
      }),
    );
  });

  it('pins a FORGED wire-provided model to the honest local sentinel (untrusted laptop)', async () => {
    const entry = makeRequestEntry('output');
    const request: BatchPersistRequest = {
      results: [{ ...entry, model: 'evil-injected-model-string' } as BatchResultEntry],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.persisted).toBe(1);
    const call = profileUpsertMock.mock.calls[0]?.[0] as {
      create: { claudeModelVersion: string };
    };
    // Never a named model that did not generate the content — the sentinel
    // says "local Max binary, model unattributed" (mirror weekly BLOQUANT 5).
    expect(call.create.claudeModelVersion).toBe('claude-code-local');
  });

  it('preserves a mock:* wire model (the mocked audit flag depends on it)', async () => {
    const entry = makeRequestEntry('output');
    const request: BatchPersistRequest = {
      results: [{ ...entry, model: 'mock:onboarding-v1' } as BatchResultEntry],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.persisted).toBe(1);
    const call = profileUpsertMock.mock.calls[0]?.[0] as {
      create: { claudeModelVersion: string };
    };
    expect(call.create.claudeModelVersion).toBe('mock:onboarding-v1');
  });

  it('keeps the env-derived default when model is ABSENT (historical mock path)', async () => {
    const entry = makeRequestEntry('output') as Extract<BatchResultEntry, { output: unknown }>;
    const { model: _dropped, ...withoutModel } = entry;
    const request: BatchPersistRequest = {
      results: [withoutModel as BatchResultEntry],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.persisted).toBe(1);
    const call = profileUpsertMock.mock.calls[0]?.[0] as {
      create: { claudeModelVersion: string };
    };
    expect(call.create.claudeModelVersion).toBe(process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6');
  });
});

describe('persistGeneratedProfiles — Gate 1: active user check', () => {
  it('skips entry when userId is not in active users set', async () => {
    setupSuccessMocks({ userIds: ['user_other'] }); // SUT requestUserIds will pre-fetch this
    userFindManyMock.mockResolvedValue([]); // override: empty active set
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output', 'user_forged', 'iv_abc')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();
  });
});

describe('persistGeneratedProfiles — Gate 2: interview owner match', () => {
  it('skips entry when interview belongs to a different userId', async () => {
    setupSuccessMocks({ userIds: ['user_123'], interviewIds: ['iv_abc'] });
    interviewFindManyMock.mockResolvedValue([
      { id: 'iv_abc', userId: 'user_OTHER' }, // owner mismatch
    ]);
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output', 'user_123', 'iv_abc')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();
    expect(reportWarningMock).toHaveBeenCalled(); // suspicious mismatch
  });

  it('skips entry when interview does not exist (forged interviewId)', async () => {
    setupSuccessMocks({ userIds: ['user_123'] });
    interviewFindManyMock.mockResolvedValue([]); // interview not found
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output', 'user_123', 'iv_nope')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();
  });
});

describe('persistGeneratedProfiles — Gate 3: Zod strict re-parse', () => {
  it('rejects malformed output (Zod fail) → onboarding.batch.invalid_output', async () => {
    setupSuccessMocks();
    const request: BatchPersistRequest = {
      results: [
        {
          userId: 'user_123',
          interviewId: 'iv_abc',
          // @ts-expect-error — intentionally invalid output (missing fields)
          output: { summary: 'too short' }, // < 100 chars + no highlights
        },
      ],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.errors).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();

    const invalidCall = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'onboarding.batch.invalid_output',
    );
    expect(invalidCall).toBeDefined();
  });
});

describe('persistGeneratedProfiles — Gate 4: Crisis routing SKIP-PERSIST', () => {
  it('skips on crisis HIGH + reportError (mirror V1.7.1)', async () => {
    setupSuccessMocks();
    detectCrisisMock.mockReturnValue({
      level: 'high',
      matches: [{ label: 'me_suicider', value: 'mock', index: 0 }],
    });
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalled();

    const crisisCall = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'onboarding.batch.crisis_detected',
    );
    expect(crisisCall).toBeDefined();
    expect(crisisCall?.[0].metadata.level).toBe('high');
  });

  it('skips on crisis MEDIUM + reportWarning (not error)', async () => {
    setupSuccessMocks();
    detectCrisisMock.mockReturnValue({
      level: 'medium',
      matches: [{ label: 'tout_perdre', value: 'mock', index: 0 }],
    });
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(reportWarningMock).toHaveBeenCalled();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});

describe('persistGeneratedProfiles — Gate 5: Safety gate (AMF + clinical + evidence)', () => {
  it('skips on AMF violation in summary + audit onboarding.batch.amf_violation', async () => {
    setupSuccessMocks();
    const request: BatchPersistRequest = {
      results: [
        {
          userId: 'user_123',
          interviewId: 'iv_abc',
          output: makeValidOutput({
            summary:
              'Profil membre avec recommandation marché : achetez LONG sur EURUSD à 1.0850 TP 1.0900. Workflow process-driven en construction. Travail discipline à approfondir. Routine matinale solide. Excellent process-focus.',
          }),
        },
      ],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();

    const amfCall = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'onboarding.batch.amf_violation',
    );
    expect(amfCall).toBeDefined();
  });

  it('skips on clinical language in summary', async () => {
    setupSuccessMocks();
    const request: BatchPersistRequest = {
      results: [
        {
          userId: 'user_123',
          interviewId: 'iv_abc',
          output: makeValidOutput({
            summary:
              'Le membre montre une dépression sévère avec idéation suicidaire récurrente. Profil clinique préoccupant nécessitant consultation immédiate. Pas un sujet de coaching standard — escalade requise. Profil descriptif au-delà du process trading.',
          }),
        },
      ],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();
  });

  it('skips on evidence not present in answers (hallucinated citation)', async () => {
    setupSuccessMocks();
    // Override the rederived snapshot to have answers that DON'T contain the
    // evidence strings used in makeValidOutput()
    answerFindManyMock.mockResolvedValue([
      {
        questionIndex: 0,
        questionKey: 'parcours_origin',
        questionText: 'Question',
        answerText: 'Texte totalement différent qui ne contient AUCUNE des evidence du highlight.',
      },
    ]);
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output')], // uses makeValidOutput evidence (verbatim from setupSuccessMocks default)
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.skipped).toBe(1);
    expect(profileUpsertMock).not.toHaveBeenCalled();

    const evidenceCall = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'onboarding.batch.evidence_invalid',
    );
    expect(evidenceCall).toBeDefined();

    // Symmetric Sentry escalation with amf/clinical siblings — surfaces the
    // fabricated-citation skip for human review.
    const warnCall = reportWarningMock.mock.calls.find(
      (c) => c[1] === 'evidence_invalid_in_ai_output',
    );
    expect(warnCall).toBeDefined();
  });
});

describe('persistGeneratedProfiles — Gate 6: Prisma upsert', () => {
  it('counts errors+1 + audit onboarding.batch.persist_failed on Prisma exception', async () => {
    setupSuccessMocks();
    profileUpsertMock.mockRejectedValue(new Error('DB connection lost'));
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output')],
    };
    const result = await persistGeneratedProfiles(request);
    expect(result.errors).toBe(1);
    expect(reportErrorMock).toHaveBeenCalled();

    const persistFailedCall = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'onboarding.batch.persist_failed',
    );
    expect(persistFailedCall).toBeDefined();
  });
});

describe('persistGeneratedProfiles — summary audit', () => {
  it('emits onboarding.batch.persisted summary at end of batch', async () => {
    setupSuccessMocks();
    const request: BatchPersistRequest = {
      results: [makeRequestEntry('output'), makeRequestEntry('error')],
    };
    await persistGeneratedProfiles(request);

    const persistedSummary = logAuditMock.mock.calls.find(
      (c) => c[0].action === 'onboarding.batch.persisted',
    );
    expect(persistedSummary).toBeDefined();
    expect(persistedSummary?.[0].metadata.total).toBe(2);
  });
});

describe('loadAllSnapshotsForCompletedInterviews — TASK G rejected-promise observability', () => {
  it('audits + Sentry-warns a rejected snapshot build instead of dropping it silently', async () => {
    const version = CURRENT_ONBOARDING_INSTRUMENT.version;
    // Step 1 — one completed interview, on the CURRENT instrument version (so
    // buildSnapshotForInterview proceeds past the version-skip early return).
    interviewFindManyMock.mockResolvedValueOnce([
      {
        id: 'iv_reject',
        userId: 'user_reject',
        instrumentVersion: version,
        startedAt: new Date('2026-05-28T10:00:00Z'),
        completedAt: new Date('2026-05-28T10:30:00Z'),
      },
    ]);
    // Step 2 — not yet analyzed.
    profileFindManyMock.mockResolvedValueOnce([]);
    // Step 3 — force buildSnapshotForInterview to REJECT (answers fetch throws).
    answerFindManyMock.mockRejectedValueOnce(new Error('DB connection lost mid-snapshot'));

    const envelope = await loadAllSnapshotsForCompletedInterviews();

    // The rejected entry is excluded from the wire envelope (still no crash).
    expect(envelope.entries).toHaveLength(0);

    // It is NO LONGER silently dropped : a PII-free audit row surfaces it.
    const skippedCall = logAuditMock.mock.calls.find(
      (c) =>
        c[0].action === 'onboarding.batch.skipped' &&
        c[0].metadata.reason === 'snapshot_build_rejected',
    );
    expect(skippedCall).toBeDefined();
    expect(skippedCall?.[0].userId).toBe('user_reject');
    expect(skippedCall?.[0].metadata.interviewId).toBe('iv_reject');
    expect(skippedCall?.[0].metadata.error).toContain('DB connection lost');

    // Sentry warning carries NO reason-derived free-text (only the interviewId).
    const warnCall = reportWarningMock.mock.calls.find(
      (c) => c[1] === 'snapshot_build_rejected_review_needed',
    );
    expect(warnCall).toBeDefined();
    expect(warnCall?.[2]).toEqual({ interviewId: 'iv_reject' });
    expect(warnCall?.[2]).not.toHaveProperty('error');
  });

  it('does not warn when all snapshot builds succeed (no false positives)', async () => {
    const version = CURRENT_ONBOARDING_INSTRUMENT.version;
    interviewFindManyMock.mockResolvedValueOnce([
      {
        id: 'iv_ok',
        userId: 'user_ok',
        instrumentVersion: version,
        startedAt: new Date('2026-05-28T10:00:00Z'),
        completedAt: new Date('2026-05-28T10:30:00Z'),
      },
    ]);
    profileFindManyMock.mockResolvedValueOnce([]);
    answerFindManyMock.mockResolvedValueOnce([
      {
        questionIndex: 0,
        questionKey: 'parcours_origin',
        questionText: 'Question',
        answerText: "J'ai démarré le trading en 2022 avec un compte démo.",
      },
    ]);

    const envelope = await loadAllSnapshotsForCompletedInterviews();

    expect(envelope.entries).toHaveLength(1);
    const warnCall = reportWarningMock.mock.calls.find(
      (c) => c[1] === 'snapshot_build_rejected_review_needed',
    );
    expect(warnCall).toBeUndefined();
  });
});

describe('canonicalizeBatchErrorCategory — PII boundary', () => {
  it('maps claude_exit_N to a bounded label', () => {
    expect(canonicalizeBatchErrorCategory('claude_exit_1')).toBe('claude_exit');
    expect(canonicalizeBatchErrorCategory('claude_exit_137')).toBe('claude_exit');
  });

  it('passes through the canonical invalid_json_response', () => {
    expect(canonicalizeBatchErrorCategory('invalid_json_response')).toBe('invalid_json_response');
  });

  it('collapses any unexpected string to "unknown" (no member text leaks to Sentry)', () => {
    expect(canonicalizeBatchErrorCategory("J'ai envie d'en finir avec tout ça")).toBe('unknown');
    expect(canonicalizeBatchErrorCategory('')).toBe('unknown');
  });
});
