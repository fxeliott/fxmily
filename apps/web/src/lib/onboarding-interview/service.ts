import 'server-only';

import type { InterviewStatus } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import type {
  OnboardingAnswerInput,
  OnboardingStartInput,
} from '@/lib/schemas/onboarding-interview';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { detectInjection } from '@/lib/ai/injection-detector';

/**
 * V2.4 — Onboarding interview service layer (Session α, M3 directive 2026-05-27).
 *
 * User-scoped strict. Pattern carbone V2.3 `lib/pre-trade/service.ts` :
 * pure async functions over Prisma client, never touches `auth()` (Server Action
 * boundary), never touches `headers()`. Serialization Date → ISO for client RSC.
 *
 * Lifecycle :
 *   1. `startInterview(userId, input)` — creates row with status='started'.
 *      Idempotent : if row exists for userId, returns existing (no duplicate).
 *   2. `appendAnswer(userId, input)` — sanitizes free-text + persists answer +
 *      flips interview status started → in_progress on first answer.
 *   3. `finalizeInterview(userId)` — flips status started/in_progress →
 *      completed + sets completedAt. Idempotent on already-completed rows.
 *   4. `getInterviewForUser(userId)` — read current interview state.
 *   5. `getProfileForUser(userId)` — read MemberProfile (null until Phase A.2
 *      batch local Claude analysis ships).
 *
 * Phase A.2 (next session) will add :
 *   - claude-client.ts (mock + live) carbone weekly-report pattern
 *   - finalizeInterview → trigger batch local Claude analysis
 *   - generateProfile() consumed by admin batch route stub
 *   - audit slugs `member_profile.analyzed`/`.published`
 *
 * Posture §2 strict — answers stored as-is (free-text), but Claude analysis
 * (Phase A.2) will run regex AMF post-gen filter on outputs. Crisis detection
 * runs synchronously in `appendAnswer` (carbone V1.8 REFLECT).
 */

// =============================================================================
// Constants
// =============================================================================

/** Default instrument version used when caller omits it. Bumped on questionnaire
 *  semver change. */
export const DEFAULT_INSTRUMENT_VERSION = 'v1';

// =============================================================================
// Serialization types
// =============================================================================

export interface SerializedOnboardingInterview {
  id: string;
  userId: string;
  status: InterviewStatus;
  startedAt: string;
  completedAt: string | null;
  claudeModelVersion: string | null;
  instrumentVersion: string;
  totalTokensInput: number;
  totalTokensOutput: number;
}

export interface SerializedOnboardingInterviewAnswer {
  id: string;
  interviewId: string;
  userId: string;
  questionIndex: number;
  questionKey: string;
  questionText: string;
  answerText: string;
  createdAt: string;
}

export interface SerializedMemberProfile {
  id: string;
  userId: string;
  interviewId: string;
  summary: string;
  highlights: unknown;
  axesPrioritaires: unknown;
  claudeModelVersion: string;
  instrumentVersion: string;
  analyzedAt: string;
}

// =============================================================================
// Internal serializers
// =============================================================================

interface InterviewRow {
  id: string;
  userId: string;
  status: InterviewStatus;
  startedAt: Date;
  completedAt: Date | null;
  claudeModelVersion: string | null;
  instrumentVersion: string;
  totalTokensInput: number;
  totalTokensOutput: number;
}

function serializeInterview(row: InterviewRow): SerializedOnboardingInterview {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    claudeModelVersion: row.claudeModelVersion,
    instrumentVersion: row.instrumentVersion,
    totalTokensInput: row.totalTokensInput,
    totalTokensOutput: row.totalTokensOutput,
  };
}

interface AnswerRow {
  id: string;
  interviewId: string;
  userId: string;
  questionIndex: number;
  questionKey: string;
  questionText: string;
  answerText: string;
  createdAt: Date;
}

function serializeAnswer(row: AnswerRow): SerializedOnboardingInterviewAnswer {
  return {
    id: row.id,
    interviewId: row.interviewId,
    userId: row.userId,
    questionIndex: row.questionIndex,
    questionKey: row.questionKey,
    questionText: row.questionText,
    answerText: row.answerText,
    createdAt: row.createdAt.toISOString(),
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Start a new onboarding interview for `userId`, OR return the existing one
 * if any (idempotent). Caller (Server Action) MUST have Zod-validated `input`.
 *
 * Posture §2 : ZERO Claude API call here — claudeModelVersion stays null
 * until Phase A.2 batch local analysis runs (carbone V1.4 monthly-debrief).
 */
export async function startInterview(
  userId: string,
  input: OnboardingStartInput,
): Promise<SerializedOnboardingInterview> {
  const existing = await db.onboardingInterview.findUnique({ where: { userId } });
  if (existing) {
    return serializeInterview(existing);
  }
  const row = await db.onboardingInterview.create({
    data: {
      userId,
      instrumentVersion: input.instrumentVersion,
    },
  });
  return serializeInterview(row);
}

/**
 * Result of `appendAnswer` — flags crisis/injection so the Server Action can
 * surface appropriate UI banners without re-running detection.
 */
export interface AppendAnswerResult {
  answer: SerializedOnboardingInterviewAnswer;
  interview: SerializedOnboardingInterview;
  /** True if crisis keywords detected in answerText (V1.8 REFLECT canon). */
  crisisDetected: boolean;
  /** True if prompt-injection patterns detected in answerText. */
  injectionDetected: boolean;
}

/**
 * Append an answer to the active interview. Auto-creates interview if missing
 * (defensive : Server Action wizard should have called startInterview already).
 *
 * Side effects :
 *   - Sanitizes answerText (schema's `safeFreeText` transform already ran at
 *     Server Action validation boundary, but we re-detect crisis/injection
 *     here at the service layer per V1.8 REFLECT canon)
 *   - Flips interview status started → in_progress on first answer
 *   - Upserts on `(interviewId, questionIndex)` unique constraint — re-submit
 *     same question = overwrite previous answer (membre peut corriger)
 */
export async function appendAnswer(
  userId: string,
  input: OnboardingAnswerInput,
): Promise<AppendAnswerResult> {
  const crisis = detectCrisis(input.answerText);
  const injection = detectInjection(input.answerText);

  // Defensive : ensure interview exists. Idempotent via startInterview.
  const interview = await startInterview(userId, {
    instrumentVersion: input.instrumentVersion,
  });

  // Upsert answer on the unique (interviewId, questionIndex) constraint.
  const answerRow = await db.onboardingInterviewAnswer.upsert({
    where: {
      interviewId_questionIndex: {
        interviewId: interview.id,
        questionIndex: input.questionIndex,
      },
    },
    update: {
      questionKey: input.questionKey,
      questionText: '', // populated by service from instrument catalog Phase A.2
      answerText: input.answerText,
    },
    create: {
      interviewId: interview.id,
      userId,
      questionIndex: input.questionIndex,
      questionKey: input.questionKey,
      questionText: '', // populated by service from instrument catalog Phase A.2
      answerText: input.answerText,
    },
  });

  // Flip status started → in_progress if needed (idempotent if already).
  let updatedInterview = interview;
  if (interview.status === 'started') {
    const flipped = await db.onboardingInterview.update({
      where: { id: interview.id },
      data: { status: 'in_progress' },
    });
    updatedInterview = serializeInterview(flipped);
  }

  return {
    answer: serializeAnswer(answerRow),
    interview: updatedInterview,
    crisisDetected: crisis.level !== 'none',
    injectionDetected: injection.suspected,
  };
}

/**
 * Finalize the onboarding interview for `userId`. Flips status
 * started/in_progress → completed + sets completedAt. Idempotent on
 * already-completed rows (returns row unchanged).
 *
 * Returns null if no interview exists (caller should have ensured one via
 * startInterview).
 *
 * Posture §2 : ZERO Claude API call here. Phase A.2 batch local analysis
 * picks up `WHERE status='completed' AND completedAt IS NOT NULL` rows.
 */
export async function finalizeInterview(
  userId: string,
): Promise<SerializedOnboardingInterview | null> {
  const existing = await db.onboardingInterview.findUnique({ where: { userId } });
  if (!existing) return null;
  if (existing.status === 'completed') {
    return serializeInterview(existing);
  }
  const row = await db.onboardingInterview.update({
    where: { userId },
    data: {
      status: 'completed',
      completedAt: new Date(),
    },
  });
  return serializeInterview(row);
}

/**
 * Read the current onboarding interview state for `userId`. Returns null if
 * no interview started yet.
 */
export async function getInterviewForUser(
  userId: string,
): Promise<SerializedOnboardingInterview | null> {
  const row = await db.onboardingInterview.findUnique({ where: { userId } });
  return row ? serializeInterview(row) : null;
}

/**
 * Read the member profile for `userId`. Returns null until Phase A.2 batch
 * local Claude analysis has run and created the MemberProfile row.
 */
export async function getProfileForUser(userId: string): Promise<SerializedMemberProfile | null> {
  const row = await db.memberProfile.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    interviewId: row.interviewId,
    summary: row.summary,
    highlights: row.highlights,
    axesPrioritaires: row.axesPrioritaires,
    claudeModelVersion: row.claudeModelVersion,
    instrumentVersion: row.instrumentVersion,
    analyzedAt: row.analyzedAt.toISOString(),
  };
}
