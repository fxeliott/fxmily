import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOnboardingInstrument } from './instrument-v1';

/**
 * V2.4 — Onboarding interview service unit tests (Session α, M3 directive).
 *
 * Pattern carbone V2.3 `lib/pre-trade/service.test.ts` : mock db singleton
 * BEFORE importing SUT to avoid Prisma adapter init at unit-test time.
 *
 * Covers Phase A.1 minimal CRUD :
 *   - startInterview (idempotent create)
 *   - appendAnswer (upsert + status flip + crisis detection signal)
 *   - finalizeInterview (idempotent on completed rows + null on missing)
 *   - getInterviewForUser / getProfileForUser (read paths)
 *
 * Phase A.2 (next session) will add Claude integration tests + admin batch
 * route tests.
 */

const interviewCreateMock = vi.fn();
const interviewFindUniqueMock = vi.fn();
const interviewUpdateMock = vi.fn();
const answerUpsertMock = vi.fn();
const profileFindUniqueMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    onboardingInterview: {
      create: interviewCreateMock,
      findUnique: interviewFindUniqueMock,
      update: interviewUpdateMock,
    },
    onboardingInterviewAnswer: {
      upsert: answerUpsertMock,
    },
    memberProfile: {
      findUnique: profileFindUniqueMock,
    },
  },
}));

vi.mock('@/lib/safety/crisis-detection', () => ({
  detectCrisis: vi.fn((text: string) => ({
    level: text.toLowerCase().includes('crisis-mock') ? 'high' : 'none',
    matches: [],
  })),
}));

vi.mock('@/lib/ai/injection-detector', () => ({
  detectInjection: vi.fn((text: string) => ({
    suspected: text.toLowerCase().includes('inject-mock'),
    matchedLabels: [],
  })),
}));

const {
  startInterview,
  appendAnswer,
  finalizeInterview,
  getInterviewForUser,
  getProfileForUser,
  DEFAULT_INSTRUMENT_VERSION,
} = await import('./service');

afterEach(() => {
  interviewCreateMock.mockReset();
  interviewFindUniqueMock.mockReset();
  interviewUpdateMock.mockReset();
  answerUpsertMock.mockReset();
  profileFindUniqueMock.mockReset();
});

const NOW = new Date('2026-05-27T17:00:00.000Z');

function makeInterviewRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'oi_1',
    userId: 'user_1',
    status: 'started' as const,
    startedAt: NOW,
    completedAt: null,
    claudeModelVersion: null,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    instrumentVersion: 'v1',
    ...overrides,
  };
}

describe('startInterview', () => {
  it('creates new row with status started when none exists', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(null);
    interviewCreateMock.mockResolvedValueOnce(makeInterviewRow());

    const result = await startInterview('user_1', { instrumentVersion: 'v1' });

    expect(interviewFindUniqueMock).toHaveBeenCalledWith({ where: { userId: 'user_1' } });
    expect(interviewCreateMock).toHaveBeenCalledWith({
      data: { userId: 'user_1', instrumentVersion: 'v1' },
    });
    expect(result.status).toBe('started');
    expect(result.id).toBe('oi_1');
    expect(result.startedAt).toBe('2026-05-27T17:00:00.000Z');
  });

  it('is idempotent — returns existing row if found, no create call', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(makeInterviewRow({ status: 'in_progress' }));

    const result = await startInterview('user_1', { instrumentVersion: 'v1' });

    expect(interviewCreateMock).not.toHaveBeenCalled();
    expect(result.status).toBe('in_progress');
  });

  it('exports DEFAULT_INSTRUMENT_VERSION constant for callers', () => {
    expect(DEFAULT_INSTRUMENT_VERSION).toBe('v1');
  });
});

describe('appendAnswer', () => {
  it('upserts answer + flips status started → in_progress on first answer', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(makeInterviewRow({ status: 'started' }));
    answerUpsertMock.mockResolvedValueOnce({
      id: 'oia_1',
      interviewId: 'oi_1',
      userId: 'user_1',
      questionIndex: 0,
      questionKey: 'experience',
      questionText: '',
      answerText: 'Hello world deep introspection',
      createdAt: NOW,
    });
    interviewUpdateMock.mockResolvedValueOnce(makeInterviewRow({ status: 'in_progress' }));

    const result = await appendAnswer('user_1', {
      instrumentVersion: 'v1',
      questionIndex: 0,
      questionKey: 'experience',
      answerText: 'Hello world deep introspection',
    });

    expect(answerUpsertMock).toHaveBeenCalledTimes(1);
    // Fix: questionText is now resolved from the versioned instrument at
    // write-time (was persisted as '' under a never-shipped "Phase A.2").
    const expectedQuestionText = getOnboardingInstrument('v1')?.items.find(
      (item) => item.questionIndex === 0,
    )?.text;
    expect(expectedQuestionText).toBeTruthy();
    expect(answerUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ questionText: expectedQuestionText }),
        update: expect.objectContaining({ questionText: expectedQuestionText }),
      }),
    );
    expect(interviewUpdateMock).toHaveBeenCalledWith({
      where: { id: 'oi_1' },
      data: { status: 'in_progress' },
    });
    expect(result.interview.status).toBe('in_progress');
    expect(result.answer.answerText).toBe('Hello world deep introspection');
    expect(result.crisisDetected).toBe(false);
    expect(result.injectionDetected).toBe(false);
  });

  it('does NOT flip status if already in_progress (idempotent)', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(makeInterviewRow({ status: 'in_progress' }));
    answerUpsertMock.mockResolvedValueOnce({
      id: 'oia_2',
      interviewId: 'oi_1',
      userId: 'user_1',
      questionIndex: 1,
      questionKey: 'motivation',
      questionText: '',
      answerText: 'Trader since 2 years working on discipline',
      createdAt: NOW,
    });

    await appendAnswer('user_1', {
      instrumentVersion: 'v1',
      questionIndex: 1,
      questionKey: 'motivation',
      answerText: 'Trader since 2 years working on discipline',
    });

    expect(interviewUpdateMock).not.toHaveBeenCalled();
  });

  it('flags crisisDetected=true when answerText matches crisis pattern', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(makeInterviewRow({ status: 'in_progress' }));
    answerUpsertMock.mockResolvedValueOnce({
      id: 'oia_3',
      interviewId: 'oi_1',
      userId: 'user_1',
      questionIndex: 2,
      questionKey: 'emotions',
      questionText: '',
      answerText: 'I feel crisis-mock and overwhelmed lately',
      createdAt: NOW,
    });

    const result = await appendAnswer('user_1', {
      instrumentVersion: 'v1',
      questionIndex: 2,
      questionKey: 'emotions',
      answerText: 'I feel crisis-mock and overwhelmed lately',
    });

    expect(result.crisisDetected).toBe(true);
    expect(result.injectionDetected).toBe(false);
  });
});

describe('finalizeInterview', () => {
  it('flips status started/in_progress → completed and sets completedAt', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(makeInterviewRow({ status: 'in_progress' }));
    interviewUpdateMock.mockResolvedValueOnce(
      makeInterviewRow({ status: 'completed', completedAt: NOW }),
    );

    const result = await finalizeInterview('user_1');

    expect(interviewUpdateMock).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { status: 'completed', completedAt: expect.any(Date) as Date },
    });
    expect(result?.status).toBe('completed');
    expect(result?.completedAt).toBe('2026-05-27T17:00:00.000Z');
  });

  it('is idempotent — returns existing completed row without update', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(
      makeInterviewRow({ status: 'completed', completedAt: NOW }),
    );

    const result = await finalizeInterview('user_1');

    expect(interviewUpdateMock).not.toHaveBeenCalled();
    expect(result?.status).toBe('completed');
  });

  it('returns null when no interview exists for userId', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(null);

    const result = await finalizeInterview('user_404');

    expect(result).toBeNull();
    expect(interviewUpdateMock).not.toHaveBeenCalled();
  });
});

describe('getInterviewForUser', () => {
  it('returns serialized interview when found', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(makeInterviewRow());

    const result = await getInterviewForUser('user_1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('oi_1');
  });

  it('returns null when no interview', async () => {
    interviewFindUniqueMock.mockResolvedValueOnce(null);

    const result = await getInterviewForUser('user_404');

    expect(result).toBeNull();
  });
});

describe('getProfileForUser', () => {
  it('returns null until Phase A.2 batch local Claude analysis creates row', async () => {
    profileFindUniqueMock.mockResolvedValueOnce(null);

    const result = await getProfileForUser('user_1');

    expect(result).toBeNull();
  });

  it('returns serialized profile when row exists', async () => {
    profileFindUniqueMock.mockResolvedValueOnce({
      id: 'mp_1',
      userId: 'user_1',
      interviewId: 'oi_1',
      summary: 'Profil orienté discipline, axes prioritaires patience + acceptance',
      highlights: [{ key: 'discipline', label: 'fort', evidence: [] }],
      axesPrioritaires: ['patience', 'acceptance', 'process-focus'],
      claudeModelVersion: 'claude-sonnet-4-6',
      instrumentVersion: 'v1',
      analyzedAt: NOW,
    });

    const result = await getProfileForUser('user_1');

    expect(result?.id).toBe('mp_1');
    expect(result?.summary).toMatch(/discipline/);
    expect(result?.analyzedAt).toBe('2026-05-27T17:00:00.000Z');
  });
});
