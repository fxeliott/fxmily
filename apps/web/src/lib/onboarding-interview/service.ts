import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { InterviewStatus } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import type {
  OnboardingAnswerInput,
  OnboardingStartInput,
} from '@/lib/schemas/onboarding-interview';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { detectInjection } from '@/lib/ai/injection-detector';
import { getOnboardingInstrument } from './instrument-v1';

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
// Errors
// =============================================================================

/**
 * Thrown by `appendAnswer` when the submitted `(instrumentVersion,
 * questionIndex, questionKey)` triple does not match the frozen instrument
 * catalog. The Zod schema only validates SHAPE/bounds — the catalog is the
 * single source of truth for which (index, key) pairs exist. Without this gate
 * a forged or buggy authenticated request could persist an out-of-catalog
 * `questionIndex`, which `batch.ts` then silently drops from the Claude
 * snapshot (it matches answers by `questionIndex`) — the member believes they
 * answered, the profile ignores it. The Server Action maps this to a
 * `invalid_input` field error (never a 500). */
export class OnboardingInstrumentMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingInstrumentMismatchError';
  }
}

/**
 * Thrown by `appendAnswer` when the interview is already `completed`. NARROWS
 * (does not eliminate) a micro-TOCTOU : `finalizeInterview` flips status
 * started/in_progress → completed, but the answer upsert never gated on status,
 * so a crafted POST could edit an answer AFTER finalize. Because the batch
 * re-derives the evidence corpus from the DB at persist-time (deliberate
 * laptop-untrusted SECURITY choice), a post-finalize answer edit could shift
 * which member text a Claude `evidence[]` substring validates against between
 * the snapshot pull and the persist re-derive. This guard rejects the
 * ALREADY-completed-at-read case at write-time; it does NOT close the window
 * fully — the read (`startInterview` findUnique) and the upsert are NOT atomic
 * (no transaction / row-lock), so a finalize landing BETWEEN this read and the
 * upsert still races on a stale status. The residual window is sub-ms and
 * requires a concurrent crafted POST; the legitimate wizard never POSTs
 * concurrently, so the guard is a worthwhile narrowing in practice.
 * The Server Action maps this to an `invalid_input` field error (never a 500). */
export class OnboardingInterviewCompletedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingInterviewCompletedError';
  }
}

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
  // J-A/J-C — 4 optional deep-AI dimensions, passed through as `unknown` (same
  // posture as highlights/axesPrioritaires : nullable Prisma Json?, parsed
  // defensively at render). NULL on legacy/partial rows. DISPLAY-ONLY, never a
  // scoring input (firewall §21.5). weakSignals is admin-surface only.
  coachingTone: unknown;
  learningStage: unknown;
  axesStructured: unknown;
  weakSignals: unknown;
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
  try {
    const row = await db.onboardingInterview.create({
      data: {
        userId,
        instrumentVersion: input.instrumentVersion,
      },
    });
    return serializeInterview(row);
  } catch (err) {
    // `userId` is @unique (schema.prisma) : a concurrent start (double-click on
    // the wizard CTA, or the defensive re-entry from `appendAnswer` below)
    // races us to the single row and the loser's `create` raises P2002. Fold it
    // into the idempotent contract by re-reading the winner — never surface a
    // false "server fault" to Sentry / the full-screen error page. Carbone of
    // the access-request / micro-objective / cards P2002 dedup pattern.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await db.onboardingInterview.findUnique({ where: { userId } });
      if (winner) {
        return serializeInterview(winner);
      }
    }
    throw err;
  }
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
  // Server-authority validation against the frozen instrument catalog. The Zod
  // schema only bounds SHAPE — the catalog is the single source of truth for
  // which (index, key) pairs exist. Reject unknown version / out-of-catalog
  // index / key↔index mismatch so a forged or buggy client can never persist
  // an answer that `batch.ts` would silently drop (it matches by questionIndex).
  const instrument = getOnboardingInstrument(input.instrumentVersion);
  if (!instrument) {
    throw new OnboardingInstrumentMismatchError(
      `Version d'instrument inconnue : ${input.instrumentVersion}.`,
    );
  }
  const item = instrument.items.find((i) => i.questionIndex === input.questionIndex);
  if (!item) {
    throw new OnboardingInstrumentMismatchError(
      `Question ${input.questionIndex} hors du catalogue ${input.instrumentVersion}.`,
    );
  }
  if (item.id !== input.questionKey) {
    throw new OnboardingInstrumentMismatchError(
      `Clé de question incohérente avec le catalogue (index ${input.questionIndex}).`,
    );
  }

  const crisis = detectCrisis(input.answerText);
  const injection = detectInjection(input.answerText);

  // Defensive : ensure interview exists. Idempotent via startInterview.
  const interview = await startInterview(userId, {
    instrumentVersion: input.instrumentVersion,
  });

  // Status guard (micro-TOCTOU NARROW, not a full close). `finalizeInterview`
  // is directly POST-invocable, so an answer edit can race a finalize : without
  // this gate a crafted request could upsert an answer AFTER the interview is
  // completed, shifting the DB corpus that the batch re-derives at persist-time
  // for evidence-substring validation. This rejects edits that are
  // ALREADY-completed at read; it does NOT eliminate the race — `startInterview`
  // read above and this upsert are NOT atomic (no transaction / row-lock), so a
  // finalize landing in the sub-ms gap between them still passes on a stale
  // status. Residual exposure requires a concurrent crafted POST; the legitimate
  // wizard never POSTs concurrently. Happy-path (started/in_progress) is untouched.
  if (interview.status === 'completed') {
    throw new OnboardingInterviewCompletedError(
      'Cet entretien est déjà finalisé : les réponses ne sont plus modifiables.',
    );
  }

  // Upsert answer on the unique (interviewId, questionIndex) constraint. Both
  // questionKey and questionText come from the catalog item (server authority)
  // — this also closes the historical `questionText: ''` debt: the column is
  // now populated at write-time from the frozen instrument wording.
  const answerRow = await db.onboardingInterviewAnswer.upsert({
    where: {
      interviewId_questionIndex: {
        interviewId: interview.id,
        questionIndex: item.questionIndex,
      },
    },
    update: {
      questionKey: item.id,
      questionText: item.text,
      answerText: input.answerText,
    },
    create: {
      interviewId: interview.id,
      userId,
      questionIndex: item.questionIndex,
      questionKey: item.id,
      questionText: item.text,
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
 * Completeness gate for finalize (§30 — « ~30 questions »). The wizard already
 * enforces all-questions-before-finalize client-side (`currentStep >= TOTAL`),
 * but the finalize Server Action is directly invocable (POST), so a crafted
 * request could finalize a near-empty interview → an empty MemberProfile (the
 * batch even mocks « aucune réponse exploitable »). This is the SERVER-side
 * guard the Action consults before finalizing.
 *
 * - `alreadyCompleted` → `complete: true` (idempotent finalize must still pass).
 * - Unknown instrument version → `required: 0` → `complete: true` (FAIL-OPEN:
 *   never brick finalize on a version mismatch; `appendAnswer` already rejects
 *   unknown versions at write-time, so such a row can't hold answers anyway).
 */
export interface InterviewCompleteness {
  exists: boolean;
  alreadyCompleted: boolean;
  answered: number;
  required: number;
  complete: boolean;
}

export async function getInterviewCompleteness(userId: string): Promise<InterviewCompleteness> {
  const interview = await db.onboardingInterview.findUnique({ where: { userId } });
  if (!interview) {
    return { exists: false, alreadyCompleted: false, answered: 0, required: 0, complete: false };
  }
  if (interview.status === 'completed') {
    return { exists: true, alreadyCompleted: true, answered: 0, required: 0, complete: true };
  }
  const instrument = getOnboardingInstrument(interview.instrumentVersion);
  const required = instrument?.items.length ?? 0;
  const answered = await db.onboardingInterviewAnswer.count({
    where: { interviewId: interview.id },
  });
  return {
    exists: true,
    alreadyCompleted: false,
    answered,
    required,
    // required===0 (unknown version) → fail-open: don't block finalize.
    complete: required === 0 ? true : answered >= required,
  };
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
    coachingTone: row.coachingTone,
    learningStage: row.learningStage,
    axesStructured: row.axesStructured,
    weakSignals: row.weakSignals,
  };
}
