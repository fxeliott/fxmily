import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { CLAUDE_LOCAL_SENTINEL, KNOWN_CLAUDE_MODEL_SLUGS } from '@/lib/ai/claude-response';
import {
  memberProfileOutputSchema,
  type MemberProfileOutput,
  type OnboardingInterviewSnapshot,
} from '@/lib/schemas/onboarding-interview';

// V1.5.2 pseudonymLabel helper — carbone weekly-report (single canonical
// `pseudonymizeMember(userId)` SHA-256+salt 8-char hex). Reusing this avoids
// pseudonym drift between weekly-report and onboarding outputs.
import { pseudonymizeMember } from '@/lib/weekly-report/builder';

import { CURRENT_ONBOARDING_INSTRUMENT, type OnboardingInstrument } from './instrument-v1';
import { composeOutputCorpus, runSafetyGate } from './safety';
import {
  MEMBER_PROFILE_OUTPUT_JSON_SCHEMA,
  buildOnboardingInterviewSystemPrompt,
  buildOnboardingInterviewUserPrompt,
} from './prompt';

/**
 * V2.4 Phase A.2 — Onboarding interview batch local Claude pipeline
 * (Session β, M3 directive 2026-05-28).
 *
 * Architecture (carbone V1.7 `weekly-report/batch.ts` 525 LOC strict) :
 *
 *   Eliott local Windows                 Hetzner prod (Caddy → fxmily-web)
 *   ════════════════════                ════════════════════════════════════
 *      /onboarding-batch (slash)
 *      │
 *      bash ops/scripts/onboarding-batch-local.sh
 *      │
 *      curl POST X-Admin-Token ─→  /api/admin/onboarding-batch/pull
 *                                  │ requireAdminToken (rate-limit + 401/503)
 *                                  │ loadAllSnapshotsForCompletedInterviews
 *                                  │ (Promise.allSettled batch=5)
 *      ◄─── JSON envelope ─────────┘ pseudonymizeMember V1.5.2
 *      │
 *      │  Loop N completed interviews :
 *      │  ┌─────────────────────────────────────┐
 *      │  │ claude --print --max-turns 1        │ × N, 60-120s jittered
 *      │  │ --system-prompt = base posture      │
 *      │  │   + 2 few-shot examples (envelope)  │
 *      │  └─────────────────────────────────────┘
 *      │
 *      │  jq -s NDJSON → results.json (atomic single write)
 *      ▼  curl POST X-Admin-Token ─→  /api/admin/onboarding-batch/persist
 *                                     │ requireAdminToken
 *                                     │ MAX_BODY_BYTES = 16 MiB
 *                                     │ persistGeneratedProfiles :
 *                                     │  - Zod.strict() post-parse (layer 2)
 *                                     │  - active-user findMany check
 *                                     │  - parseLocalDate try-catch
 *                                     │  - **detectCrisis SKIP-PERSIST** (V1.7.1)
 *                                     │  - **runSafetyGate** (layer 3+AMF+clinical)
 *                                     │  - idempotent upsert MemberProfile
 *                                     │    on (userId) unique
 *      ◄─── { persisted, skipped, errors, total }
 *
 * Differences vs V1.7 weekly-report :
 *   - Onboarding is **one-shot per member** (no weekly cadence), idempotent
 *     on `(userId)` unique (vs `(userId, weekStart)` for weekly).
 *   - **3 layers anti-hallu** mandatory (vs 2 for weekly) : Zod + AMF regex
 *     + evidence substring NFC (§J Anthropic profilage 2026).
 *   - **Crisis routing mirror V1.7.1** SKIP-PERSIST on output IA HIGH/MEDIUM
 *     (vs REFLECT persist-anyway).
 *   - **Anti-clinical wording HARD REJECT** (vs weekly which doesn't have
 *     this gate — onboarding profile is descriptif-comportemental, pas
 *     clinique §J).
 *
 * Ban-risk mitigation rules (carbone V1.7) :
 *   1. Eliott's machine (TON IP, TON fingerprint, TON Max account)
 *   2. 60-120s RANDOM-jittered sleeps (local script)
 *   3. One `claude --print` per member = fresh context
 *   4. Snapshots pseudonymized V1.5.2 8-char hex
 *   5. System prompt + JSON schema travel WITH the envelope from repo
 *   6. Only official `claude` binary
 *   7. Human-in-the-loop manual trigger
 *   8. Double-net validation server-side (Zod.strict + safety gate)
 *   9. Audit log `onboarding.batch.*` records counts + ranAt (PII-free)
 */

// =============================================================================
// Public types — wire contract between Hetzner and the local script
// =============================================================================

/**
 * One member's snapshot ready to be handed to `claude --print`. Designed
 * to be JSON-serialized over the HTTP envelope.
 */
export interface BatchSnapshotEntry {
  /** Real internal user id. NEVER exposed to Anthropic — kept here only
   *  so the local script can route the eventual MemberProfile back to the
   *  right row. */
  readonly userId: string;
  /** Real internal interview id — for upsert routing on persist. */
  readonly interviewId: string;
  /** Pseudonym label V1.5.2 (8-char hex). Safe to log + safe to include
   *  in the prompt sent to Claude. */
  readonly pseudonymLabel: string;
  /** Snapshot ready for `buildOnboardingInterviewUserPrompt`. */
  readonly snapshot: OnboardingInterviewSnapshot;
  /** **Pre-rendered user prompt** (server-side via
   *  `buildOnboardingInterviewUserPrompt`). The local bash script writes
   *  this string verbatim to `prompt-$i.txt` and pipes to `claude --print`.
   *  Elimines la nécessité d'un import TypeScript dans le script bash.
   *  Wire byte cost : ~5 KB/entry × 30 = ~150 KB cohorte (negligible). */
  readonly userPrompt: string;
}

/**
 * The envelope returned by the pull endpoint to the local script.
 *
 * `systemPrompt` and `outputJsonSchema` ride along so the local script
 * does not need to import any Fxmily TypeScript code — `bash | jq | curl
 * | claude --print` is enough to run a batch.
 */
export interface BatchPullEnvelope {
  readonly ranAt: string;
  readonly instrumentVersion: string;
  readonly systemPrompt: string;
  readonly outputJsonSchema: unknown;
  readonly entries: readonly BatchSnapshotEntry[];
}

/**
 * One entry of the result POSTed back from the local script.
 *
 * `output` is the parsed/validated MemberProfileOutput. If the local
 * script could not generate a valid output (Claude error, schema
 * mismatch), it sets `error` instead. The persist step silently skips
 * entries with `error` set but logs an audit row.
 */
export type BatchResultEntry =
  | {
      readonly userId: string;
      readonly interviewId: string;
      readonly output: MemberProfileOutput;
      readonly usage?: {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly cacheReadTokens?: number;
      };
      readonly model?: string;
    }
  | {
      readonly userId: string;
      readonly interviewId: string;
      readonly error: string;
    };

export interface BatchPersistRequest {
  readonly results: readonly BatchResultEntry[];
}

export interface BatchPersistResult {
  readonly persisted: number;
  readonly skipped: number;
  readonly errors: number;
}

// =============================================================================
// Pull side — collect snapshots for every completed interview not yet analyzed
// =============================================================================

const SNAPSHOT_BATCH_CONCURRENCY = 5;

/**
 * Load every completed onboarding interview that has NOT yet been analyzed
 * (no MemberProfile row exists). Used by
 * `app/api/admin/onboarding-batch/pull/route.ts` (CHECKPOINT 6 future).
 * Pure read; no side effects.
 *
 * Filters :
 *   - `OnboardingInterview.status === 'completed'`
 *   - User `status === 'active'` (skip suspended/deleted)
 *   - No existing `MemberProfile` row for this interview (idempotency —
 *     if Eliott re-runs the batch, only un-analyzed interviews are picked)
 *
 * Performance : `SNAPSHOT_BATCH_CONCURRENCY`-by-5 Promise.allSettled
 * carbone V1.7. At 30 completed interviews ~1.8s expected. At 1000 ~60s.
 */
export async function loadAllSnapshotsForCompletedInterviews(
  options: { now?: Date } = {},
): Promise<BatchPullEnvelope> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();
  const instrumentVersion = CURRENT_ONBOARDING_INSTRUMENT.version;

  // Step 1 — Find all completed interviews owned by active users.
  const interviews = await db.onboardingInterview.findMany({
    where: {
      status: 'completed',
      user: { status: 'active' },
    },
    select: {
      id: true,
      userId: true,
      instrumentVersion: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: { completedAt: 'asc' },
  });

  if (interviews.length === 0) {
    await logAudit({
      action: 'onboarding.batch.pulled',
      metadata: {
        ranAt,
        entriesCount: 0,
        instrumentVersion,
        reason: 'no_completed_interviews',
      },
    });
    return {
      ranAt,
      instrumentVersion,
      systemPrompt: buildOnboardingInterviewSystemPrompt(),
      outputJsonSchema: MEMBER_PROFILE_OUTPUT_JSON_SCHEMA,
      entries: [],
    };
  }

  // Step 2 — Filter out interviews already analyzed (MemberProfile exists).
  const interviewIds = interviews.map((i) => i.id);
  const analyzed = await db.memberProfile.findMany({
    where: { interviewId: { in: interviewIds } },
    select: { interviewId: true },
  });
  const analyzedSet = new Set(analyzed.map((p) => p.interviewId));
  const toProcess = interviews.filter((i) => !analyzedSet.has(i.id));

  if (toProcess.length === 0) {
    await logAudit({
      action: 'onboarding.batch.pulled',
      metadata: {
        ranAt,
        entriesCount: 0,
        instrumentVersion,
        reason: 'all_completed_already_analyzed',
        totalCompleted: interviews.length,
      },
    });
    return {
      ranAt,
      instrumentVersion,
      systemPrompt: buildOnboardingInterviewSystemPrompt(),
      outputJsonSchema: MEMBER_PROFILE_OUTPUT_JSON_SCHEMA,
      entries: [],
    };
  }

  // Step 3 — Build snapshots in concurrent batches of 5 (pool-friendly).
  const entries: BatchSnapshotEntry[] = [];
  for (let i = 0; i < toProcess.length; i += SNAPSHOT_BATCH_CONCURRENCY) {
    const chunk = toProcess.slice(i, i + SNAPSHOT_BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((interview) => buildSnapshotForInterview(interview, CURRENT_ONBOARDING_INSTRUMENT)),
    );
    for (let j = 0; j < results.length; j += 1) {
      const r = results[j];
      if (r === undefined) continue;
      if (r.status === 'fulfilled') {
        if (r.value !== null) entries.push(r.value);
        continue;
      }
      // Rejected promise — a single interview's snapshot build threw (DB error,
      // etc.). We still don't fail the whole batch, but we no longer drop it
      // silently : a completed interview that yields no snapshot must surface
      // for human review, not vanish. PII-FREE metadata only (§16) — the
      // rejection reason can carry a stack/DB string, so we audit a bounded
      // 200-char slice internally and send NOTHING reason-derived to the
      // external Sentry sink (mirror the persist-side anti-skip guardrail).
      const interview = chunk[j];
      await logAudit({
        action: 'onboarding.batch.skipped',
        userId: interview?.userId ?? null,
        metadata: {
          ranAt,
          interviewId: interview?.id ?? null,
          reason: 'snapshot_build_rejected',
          error: r.reason instanceof Error ? r.reason.message.slice(0, 200) : 'unknown',
        },
      });
      reportWarning('onboarding-interview.batch', 'snapshot_build_rejected_review_needed', {
        interviewId: interview?.id ?? null,
      });
    }
  }

  await logAudit({
    action: 'onboarding.batch.pulled',
    metadata: {
      ranAt,
      entriesCount: entries.length,
      instrumentVersion,
      totalCompleted: interviews.length,
      alreadyAnalyzed: analyzedSet.size,
    },
  });

  return {
    ranAt,
    instrumentVersion,
    systemPrompt: buildOnboardingInterviewSystemPrompt(),
    outputJsonSchema: MEMBER_PROFILE_OUTPUT_JSON_SCHEMA,
    entries,
  };
}

interface InterviewRowMinimal {
  readonly id: string;
  readonly userId: string;
  readonly instrumentVersion: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

async function buildSnapshotForInterview(
  interview: InterviewRowMinimal,
  instrument: OnboardingInstrument,
): Promise<BatchSnapshotEntry | null> {
  // Skip interviews on a different instrument version than current — would
  // require loading the legacy instrument from registry (not supported V1).
  if (interview.instrumentVersion !== instrument.version) {
    reportWarning('onboarding-interview.batch', 'snapshot_skipped_instrument_version_mismatch', {
      interviewId: interview.id,
      userId: interview.userId,
      rowVersion: interview.instrumentVersion,
      currentVersion: instrument.version,
    });
    return null;
  }

  // Fetch answers ordered by questionIndex.
  const answers = await db.onboardingInterviewAnswer.findMany({
    where: { interviewId: interview.id },
    select: {
      questionIndex: true,
      questionKey: true,
      questionText: true,
      answerText: true,
    },
    orderBy: { questionIndex: 'asc' },
  });

  if (answers.length === 0) {
    // Defensive — completed status but no answers shouldn't happen, but
    // skip rather than crash.
    return null;
  }

  // Enrich answers with phase + dimensionId from the instrument.
  const enrichedAnswers = answers
    .map((ans) => {
      const item = instrument.items.find((i) => i.questionIndex === ans.questionIndex);
      if (!item) {
        // Question index not in current instrument — instrument-version
        // drift detected. Skip this answer.
        return null;
      }
      return {
        questionIndex: ans.questionIndex,
        questionKey: ans.questionKey,
        questionText: ans.questionText || item.text, // fallback to instrument if empty
        answerText: ans.answerText,
        dimensionId: item.dimensionId,
        phase: item.phase,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const snapshot: OnboardingInterviewSnapshot = {
    pseudonymLabel: pseudonymizeMember(interview.userId),
    instrumentVersion: interview.instrumentVersion,
    startedAt: interview.startedAt.toISOString(),
    completedAt: (interview.completedAt ?? interview.startedAt).toISOString(),
    answers: enrichedAnswers,
  };

  return {
    userId: interview.userId,
    interviewId: interview.id,
    pseudonymLabel: snapshot.pseudonymLabel,
    snapshot,
    userPrompt: buildOnboardingInterviewUserPrompt(snapshot),
  };
}

/**
 * Convenience for the local script — build the per-member user prompt
 * from the entry. Same logic as the live path used internally by
 * `LiveOnboardingProfileClient`, but exposed here for reuse.
 */
export function buildBatchUserPrompt(entry: BatchSnapshotEntry): string {
  return buildOnboardingInterviewUserPrompt(entry.snapshot);
}

// =============================================================================
// Persist side — accept Claude-generated profiles + write to DB
// =============================================================================

/**
 * Canonicalize the orchestrator-supplied `error` string to a bounded label
 * before it leaves the perimeter (external Sentry telemetry). The wire `error`
 * field is produced by the local batch script and the server does NOT trust
 * the laptop (cf. Gate 1-2 forged-userId defenses). Propagating it verbatim
 * to a third-party sink could leak member free-text if a future orchestrator
 * change — or a compromised laptop — put answer text there. The internal
 * audit log keeps the raw slice; external Sentry gets this canonical label.
 */
export function canonicalizeBatchErrorCategory(error: string): string {
  if (error.startsWith('claude_exit_')) return 'claude_exit';
  if (error === 'invalid_json_response') return 'invalid_json_response';
  return 'unknown';
}

/**
 * Validate + persist a batch of locally-generated MemberProfiles.
 * Idempotent on `(userId)` unique (upsert).
 *
 * Validation gates (order = fail-fast) :
 *   1. Active user check (reject forged userId from compromised laptop)
 *   2. Interview exists + matches `interviewId` in result entry
 *   3. Zod `memberProfileOutputSchema.strict()` (layer 2 anti-hallu §J)
 *   4. `detectCrisis(corpus)` mirror V1.7.1 — HIGH/MEDIUM = SKIP-PERSIST
 *   5. `runSafetyGate` (layer 3 — AMF regex + anti-clinical + evidence
 *      substring NFC validation §J)
 *   6. Prisma upsert on `MemberProfile.userId` unique
 *
 * Audit slugs séquence :
 *   - `member_profile.analyzed` per-entry on success (PII-free)
 *   - `onboarding.batch.persisted` summary (counts + ranAt)
 *   - `onboarding.batch.skipped` per skip (reason canonical)
 *   - `onboarding.batch.invalid_output` per Zod fail
 *   - `onboarding.batch.persist_failed` per Prisma exception
 *   - `onboarding.batch.crisis_detected` per crisis HIGH/MEDIUM
 *   - `onboarding.batch.amf_violation` per AMF reject
 *   - `onboarding.batch.evidence_invalid` per evidence-substring fail
 *
 * The function NEVER throws on a single bad entry — counts + moves on.
 * Returns aggregate `{persisted, skipped, errors}`.
 */
export async function persistGeneratedProfiles(
  request: BatchPersistRequest,
): Promise<BatchPersistResult> {
  const ranAt = new Date().toISOString();
  const claudeModelVersion = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'; // sentinel for mock path
  const instrumentVersion = CURRENT_ONBOARDING_INSTRUMENT.version;

  // Step 1 — Pre-fetch active user ids + completed interview ids for O(1)
  // validation lookups. Defends against compromised laptop forging arbitrary
  // userIds / interviewIds.
  const requestUserIds = Array.from(new Set(request.results.map((r) => r.userId)));
  const requestInterviewIds = Array.from(new Set(request.results.map((r) => r.interviewId)));

  const [activeUsers, validInterviews] = await Promise.all([
    db.user.findMany({
      where: { id: { in: requestUserIds }, status: 'active' },
      select: { id: true },
    }),
    db.onboardingInterview.findMany({
      where: {
        id: { in: requestInterviewIds },
        status: 'completed',
      },
      select: { id: true, userId: true },
    }),
  ]);

  const activeUserSet = new Set(activeUsers.map((u) => u.id));
  const interviewByid = new Map(validInterviews.map((i) => [i.id, i.userId]));

  let persisted = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of request.results) {
    if ('error' in entry) {
      skipped += 1;
      await logAudit({
        action: 'onboarding.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          reason: entry.error.slice(0, 200),
        },
      });
      // Anti-skip guardrail (model-independent) — a completed interview that
      // produced NO profile (Claude refusal / non-zero exit / empty output)
      // must surface for human review, not vanish into an audit-only row.
      // Covers the residual over-refusal rate + any future model drift.
      // PII-free metadata only (RGPD §16) — the orchestrator-supplied `error`
      // string is canonicalized to a bounded label before reaching the
      // external Sentry sink (the laptop is untrusted, cf. Gate 1-2). The raw
      // slice stays in the internal audit log above.
      reportWarning('onboarding-interview.batch', 'entry_error_no_profile_review_needed', {
        userId: entry.userId,
        interviewId: entry.interviewId,
        errorCategory: canonicalizeBatchErrorCategory(entry.error),
      });
      continue;
    }

    // Gate 1 — Active user check
    if (!activeUserSet.has(entry.userId)) {
      skipped += 1;
      await logAudit({
        action: 'onboarding.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          reason: 'unknown_or_inactive_user',
        },
      });
      continue;
    }

    // Gate 2 — Interview exists + belongs to claimed userId
    const interviewOwner = interviewByid.get(entry.interviewId);
    if (interviewOwner === undefined) {
      skipped += 1;
      await logAudit({
        action: 'onboarding.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          reason: 'interview_not_found_or_not_completed',
        },
      });
      continue;
    }
    if (interviewOwner !== entry.userId) {
      skipped += 1;
      await logAudit({
        action: 'onboarding.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          reason: 'interview_owner_mismatch',
        },
      });
      reportWarning('onboarding-interview.batch', 'interview_owner_mismatch_suspicious', {
        userId: entry.userId,
        interviewId: entry.interviewId,
        actualOwner: interviewOwner,
      });
      continue;
    }

    // Gate 3 — Zod strict post-parse (defense-in-depth, anti enum-fuzzing)
    const parsed = memberProfileOutputSchema.safeParse(entry.output);
    if (!parsed.success) {
      errors += 1;
      await logAudit({
        action: 'onboarding.batch.invalid_output',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          issuesCount: parsed.error.issues.length,
        },
      });
      continue;
    }
    const output = parsed.data;

    // Gate 4 — Crisis routing on Claude output mirror V1.7.1.
    // Uses the SAME single corpus as the AMF/clinical scan (composeOutputCorpus)
    // so the J-A dimensions are covered by crisis detection too, with no risk of
    // the two scans drifting apart.
    const crisisCorpus = composeOutputCorpus(output);
    const crisis = detectCrisis(crisisCorpus);
    if (crisis.level === 'high' || crisis.level === 'medium') {
      skipped += 1;
      await logAudit({
        action: 'onboarding.batch.crisis_detected',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          level: crisis.level,
          matchedLabels: crisis.matches.map((m) => m.label),
        },
      });
      // HIGH → reportError (page-out), MEDIUM → reportWarning (review next day)
      if (crisis.level === 'high') {
        reportError(
          'onboarding-interview.batch',
          new Error(
            `crisis_signal_high_in_ai_output: ${crisis.matches.map((m) => m.label).join(',')}`,
          ),
          { userId: entry.userId, interviewId: entry.interviewId },
        );
      } else {
        reportWarning('onboarding-interview.batch', 'crisis_signal_medium_in_ai_output', {
          userId: entry.userId,
          interviewId: entry.interviewId,
          matchedLabels: crisis.matches.map((m) => m.label),
        });
      }
      continue;
    }

    // Gate 5 — Safety gate (AMF + anti-clinical + evidence substring NFC)
    // We need the original snapshot for evidence validation — re-derive it
    // here. Could be optimized by passing snapshot through the batch result
    // entry, but that's an extra wire-byte cost; re-derive is cheap.
    const snapshotEntry = await rederiveSnapshotForValidation(entry.interviewId);
    if (snapshotEntry === null) {
      skipped += 1;
      await logAudit({
        action: 'onboarding.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          reason: 'snapshot_rederive_failed',
        },
      });
      continue;
    }
    const safety = runSafetyGate({ output, snapshot: snapshotEntry.snapshot });
    if (safety.status === 'reject') {
      skipped += 1;
      if (safety.reason === 'amf_violation') {
        await logAudit({
          action: 'onboarding.batch.amf_violation',
          userId: entry.userId,
          metadata: {
            ranAt,
            interviewId: entry.interviewId,
            matchedLabels: safety.matchedLabels,
          },
        });
        reportWarning('onboarding-interview.batch', 'amf_violation_in_ai_output', {
          userId: entry.userId,
          interviewId: entry.interviewId,
          matchedLabels: safety.matchedLabels,
        });
      } else if (safety.reason === 'clinical_language') {
        await logAudit({
          action: 'onboarding.batch.skipped',
          userId: entry.userId,
          metadata: {
            ranAt,
            interviewId: entry.interviewId,
            reason: 'clinical_language',
            matchedLabels: safety.matchedLabels,
          },
        });
        reportWarning('onboarding-interview.batch', 'clinical_language_in_ai_output', {
          userId: entry.userId,
          interviewId: entry.interviewId,
          matchedLabels: safety.matchedLabels,
        });
      } else if (safety.reason === 'evidence_invalid') {
        await logAudit({
          action: 'onboarding.batch.evidence_invalid',
          userId: entry.userId,
          metadata: {
            ranAt,
            interviewId: entry.interviewId,
            invalidHighlightIndexes: safety.invalidHighlightIndexes,
            invalidDimensionPaths: safety.invalidDimensionPaths ?? [],
          },
        });
        // Surface for human review — a completed interview produced no profile
        // because Claude fabricated a citation (highlight OR J-A dimension).
        // Symmetric with amf_violation / clinical_language siblings above
        // (which already escalate to Sentry).
        reportWarning('onboarding-interview.batch', 'evidence_invalid_in_ai_output', {
          userId: entry.userId,
          interviewId: entry.interviewId,
          invalidHighlightIndexes: safety.invalidHighlightIndexes,
          invalidDimensionPaths: safety.invalidDimensionPaths ?? [],
        });
      }
      continue;
    }

    // Gate 6 — Upsert MemberProfile (idempotent on userId unique)
    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    // Model attribution pin (mirror weekly/monthly/calendar "BLOQUANT 5") :
    // the orchestrator laptop is untrusted (cf. Gates 1-2), so a wire-provided
    // `model` is only recorded verbatim when it is a known executable slug,
    // the local sentinel, or a `mock:*` marker (the mock path's `mocked` audit
    // flag below depends on it). A FORGED string falls back to the honest
    // sentinel — never to a named model that did not generate the content.
    // Absent `model` keeps the historical env-derived default (mock path).
    // Onboarding computes no cost ; the pin protects audit-traceability only.
    const model = entry.model
      ? KNOWN_CLAUDE_MODEL_SLUGS.includes(entry.model) ||
        entry.model === CLAUDE_LOCAL_SENTINEL ||
        entry.model.startsWith('mock:')
        ? entry.model
        : CLAUDE_LOCAL_SENTINEL
      : claudeModelVersion;

    // J-A dimensions — include ONLY fields the model actually produced. An
    // absent field is omitted from the write : NULL on create (nullable column),
    // left unchanged on the rare re-analysis update path. No Prisma.JsonNull
    // sentinel needed, and recoveryProtocol (member-written, set elsewhere) is
    // never touched here.
    const aiDimensions = {
      ...(output.coaching_tone !== undefined ? { coachingTone: output.coaching_tone } : {}),
      ...(output.learning_stage !== undefined ? { learningStage: output.learning_stage } : {}),
      ...(output.axes_structured !== undefined ? { axesStructured: output.axes_structured } : {}),
      ...(output.weak_signals !== undefined ? { weakSignals: output.weak_signals } : {}),
    };

    try {
      await db.memberProfile.upsert({
        where: { userId: entry.userId },
        create: {
          userId: entry.userId,
          interviewId: entry.interviewId,
          summary: output.summary,
          highlights: output.highlights,
          axesPrioritaires: output.axes_prioritaires,
          claudeModelVersion: model,
          instrumentVersion,
          ...aiDimensions,
        },
        update: {
          interviewId: entry.interviewId,
          summary: output.summary,
          highlights: output.highlights,
          axesPrioritaires: output.axes_prioritaires,
          claudeModelVersion: model,
          instrumentVersion,
          ...aiDimensions,
        },
      });

      // Also bump the interview row's claudeModelVersion + token counters
      // for audit traceability (the interview is the source-of-truth event,
      // the profile is the derived artifact).
      try {
        await db.onboardingInterview.update({
          where: { id: entry.interviewId },
          data: {
            claudeModelVersion: model,
            // TXN-2 (RC#8) — ABSOLUTE set, not `increment`. The persist has no
            // idempotency gate (the interview never flips to a terminal
            // post-analysis status), so a retried/double-submitted results.json
            // would re-run this update; a relative `increment` would inflate the
            // per-interview token totals without bound on every re-delivery.
            // These counters describe the cost of the CURRENT profile
            // generation (one analysis run), not an accumulation, so an absolute
            // write is the correct idempotent semantic.
            totalTokensInput: usage.inputTokens,
            totalTokensOutput: usage.outputTokens,
          },
        });
      } catch (err) {
        // Non-blocking — the profile is persisted, only token tracking
        // didn't update. Sentry warning for observability.
        reportWarning('onboarding-interview.batch', 'interview_token_stamp_failed', {
          userId: entry.userId,
          interviewId: entry.interviewId,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
      }

      persisted += 1;
      await logAudit({
        action: 'member_profile.analyzed',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          claudeModelVersion: model,
          instrumentVersion,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          mocked: model.startsWith('mock:'),
        },
      });
    } catch (err) {
      errors += 1;
      await logAudit({
        action: 'onboarding.batch.persist_failed',
        userId: entry.userId,
        metadata: {
          ranAt,
          interviewId: entry.interviewId,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      });
      reportError(
        'onboarding-interview.batch',
        err instanceof Error ? err : new Error('persist_failed_unknown'),
        { userId: entry.userId, interviewId: entry.interviewId },
      );
    }
  }

  await logAudit({
    action: 'onboarding.batch.persisted',
    metadata: {
      ranAt,
      persisted,
      skipped,
      errors,
      total: request.results.length,
      instrumentVersion,
    },
  });

  return { persisted, skipped, errors };
}

/**
 * Re-derive the snapshot for a given interviewId — used by the safety gate
 * for evidence substring validation. Returns null if the interview can't be
 * found or has no answers.
 */
async function rederiveSnapshotForValidation(
  interviewId: string,
): Promise<BatchSnapshotEntry | null> {
  const interview = await db.onboardingInterview.findUnique({
    where: { id: interviewId },
    select: {
      id: true,
      userId: true,
      instrumentVersion: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!interview) return null;
  return buildSnapshotForInterview(interview, CURRENT_ONBOARDING_INSTRUMENT);
}
