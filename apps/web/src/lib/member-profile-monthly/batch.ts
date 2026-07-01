import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { monthWindowFromMonthStart } from '@/lib/monthly-debrief/month-window';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import {
  memberProfileMonthlySnapshotOutputSchema,
  type MemberProfileMonthlySnapshotOutput,
} from '@/lib/schemas/member-profile-monthly-snapshot';

import { loadReflectionCorpusForMonth, loadReprofileSliceForUser } from './loader';
import { CLAUDE_CODE_LOCAL_MODEL, computeCostEur } from './pricing';
import {
  MEMBER_PROFILE_MONTHLY_OUTPUT_JSON_SCHEMA,
  buildMonthlyReprofileSystemPrompt,
  buildMonthlyReprofileUserPrompt,
} from './prompt';
import { composeMonthlyOutputCorpus, runMonthlyReprofileSafetyGate } from './safety';
import type { MonthlyReprofileSnapshot } from './types';

/**
 * J-E — ADMIN-ONLY monthly deep re-profiling batch (expansion IA §21.5).
 *
 * Carbon of `monthly-debrief/batch.ts` adapted to the re-profiling cadence, with
 * ONE structural simplification: this pipeline is ADMIN-ONLY. There is NO member
 * dispatch (no push, no email) — a monthly snapshot never crosses a member
 * surface (§21.5 / `weakSignals` admin-only), so the whole notify layer is gone.
 *
 * Architecture (mirror V1.4 §25 / the onboarding batch): Eliott refuses to pay
 * for Anthropic API tokens; the deep re-profiling runs via `claude --print`
 * (headless Claude Code CLI) on his local Windows machine using his Claude Max
 * subscription (0€ marginal). The workflow:
 *
 *   1. Eliott runs `ops/scripts/member-profile-monthly-local.sh` (1st of month)
 *   2. The script curl-POSTs `/api/admin/member-profile-batch/pull` →
 *      {@link loadAllReprofileSnapshots} → pseudonymized snapshots
 *   3. For each member the script invokes `claude --print` with the re-profiling
 *      system prompt (Douglas grid + few-shots) + the snapshot, jittered sleeps
 *   4. The script curl-POSTs `/api/admin/member-profile-batch/persist` →
 *      {@link persistGeneratedSnapshots}
 *
 * The ban-risk mitigations are identical to the weekly/monthly batches (jittered
 * sleeps, official `claude` binary only, pseudonymized data, system prompt +
 * schema travel WITH the envelope, double-net Zod, active-user re-check,
 * PII-free audit) and share the SAME batch-core (`claude-batch-core.sh`).
 *
 * 🚨 §21.5 / §27.7. The snapshot carries NO real-edge P&L token by construction
 * (loader touches no training surface). The crisis + AMF + anti-clinical scans
 * run on the AI OUTPUT text; the evidence gate re-derives the month's reflection
 * corpus SERVER-SIDE ({@link loadReflectionCorpusForMonth}) so a compromised
 * laptop cannot forge the citable source.
 */

// =============================================================================
// Public types — wire contract between Hetzner and the local script
// =============================================================================

export interface MemberProfileMonthlyBatchEntry {
  /** Real internal user id. NEVER exposed to Anthropic — kept only so the local
   *  script can route the eventual snapshot back to the right row. */
  userId: string;
  /** Pseudonym label (8-char hex) — pre-computed by the LOADER at the Claude
   *  boundary. Safe to log + include in the prompt. */
  pseudonymLabel: string;
  /** Member timezone (Europe/Paris by default V1). */
  timezone: string;
  /** Local 1st-of-month ISO date (YYYY-MM-DD). */
  monthStart: string;
  /** Local last-calendar-day ISO date (YYYY-MM-DD). */
  monthEnd: string;
  /** Pure builder output (compile-time typed; free text already sanitized via
   *  safeFreeText at the builder). Pseudonymised — carries no email/name/raw
   *  userId. The snapshot type is NOT `.parse()`d at runtime here. Retained for
   *  audit/debug; the wire prompt is the pre-rendered {@link userPrompt}. */
  snapshot: MonthlyReprofileSnapshot;
  /** The FULLY-RENDERED per-member user prompt (`buildMonthlyReprofileUserPrompt`)
   *  — the reference-vs-citable-source framing, the per-reflection untrusted
   *  wrapping and the indexed [i] labels TRAVEL to `claude --print` verbatim
   *  (J-B lesson: the enriched prompt is useless if it does not reach the
   *  engine). The local script sends THIS as the user content, NOT the raw
   *  snapshot JSON — so the system prompt's references to the "Réflexions du
   *  mois" block + `<member_reflection_untrusted>` tags stay accurate. */
  userPrompt: string;
}

/**
 * Envelope returned by the pull route. `systemPrompt` + `outputJsonSchema` ride
 * along so the local script needs no Fxmily TypeScript — `bash | jq | curl |
 * claude --print` is enough. `systemPrompt` already carries the few-shot block
 * (J-B lesson: an example only grounds behaviour if it TRAVELS to the engine).
 */
export interface MemberProfileMonthlyBatchPullEnvelope {
  ranAt: string;
  monthStart: string;
  monthEnd: string;
  systemPrompt: string;
  outputJsonSchema: unknown;
  entries: MemberProfileMonthlyBatchEntry[];
}

export type MemberProfileMonthlyBatchResultEntry =
  | {
      userId: string;
      output: MemberProfileMonthlySnapshotOutput;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
      };
      model?: string;
    }
  | {
      userId: string;
      error: string;
    };

export interface MemberProfileMonthlyBatchPersistRequest {
  monthStart: string; // YYYY-MM-DD, must match the pull envelope's monthStart
  monthEnd: string;
  results: MemberProfileMonthlyBatchResultEntry[];
}

export interface MemberProfileMonthlyBatchPersistResult {
  persisted: number;
  skipped: number;
  errors: number;
}

// =============================================================================
// Pull side — collect snapshots for every active member with month material
// =============================================================================

/**
 * Mirror the monthly-debrief `SNAPSHOT_BATCH_CONCURRENCY` (5). Each
 * `loadReprofileSliceForUser` opens ~4 connections; a chunk of 5 stays well
 * under the `db.ts` pool max and the 5s connectionTimeout.
 */
const SNAPSHOT_BATCH_CONCURRENCY = 5;

/**
 * Per-member pull outcome. UNLIKE the monthly-debrief batch (which emits a
 * "mois calme" for EVERY active member), re-profiling is only meaningful when
 * the member wrote NEW introspective material this month: a month with zero
 * reflections has nothing citable to re-profile, so we SKIP it rather than
 * invite the model to fabricate. The skip is COUNTED (never a silent cap) and
 * surfaced in the `pulled` audit.
 */
type PullOutcome =
  | { kind: 'entry'; value: MemberProfileMonthlyBatchEntry }
  | { kind: 'silent'; monthStart: string; monthEnd: string }
  | { kind: 'dropped' };

/**
 * Load every active member's civil-month slice + build a pseudonymized
 * re-profiling snapshot. Used by `app/api/admin/member-profile-batch/pull`.
 * Pure read.
 *
 * `currentMonth` defaults to `false` — the cadence is "1st of the month,
 * re-profile the month that just ended" (`computeReportingMonth`, robust to a
 * delayed manual run). Pass `true` to preview the in-progress month.
 *
 * Members with zero reflections this month are skipped (see {@link PullOutcome});
 * `null` slices (suspended / not-found) are dropped silently.
 */
export async function loadAllReprofileSnapshots(
  options: { now?: Date; currentMonth?: boolean } = {},
): Promise<MemberProfileMonthlyBatchPullEnvelope> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();
  const currentMonth = options.currentMonth ?? false;

  const users = await db.user.findMany({
    where: { status: 'active' },
    select: { id: true },
    orderBy: { joinedAt: 'asc' },
  });

  const entries: MemberProfileMonthlyBatchEntry[] = [];
  let monthStart: string | null = null;
  let monthEnd: string | null = null;
  let silentSkipped = 0;

  for (let i = 0; i < users.length; i += SNAPSHOT_BATCH_CONCURRENCY) {
    const chunk = users.slice(i, i + SNAPSHOT_BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (user): Promise<PullOutcome> => {
        const slice = await loadReprofileSliceForUser(user.id, { now, currentMonth });
        if (slice === null) return { kind: 'dropped' };
        if (slice.snapshot.reflections.length === 0) {
          return {
            kind: 'silent',
            monthStart: slice.window.monthStartLocal,
            monthEnd: slice.window.monthEndLocal,
          };
        }
        return {
          kind: 'entry',
          value: {
            userId: user.id,
            // The pseudonym is pre-computed by the loader (snapshot.pseudonymLabel).
            // The batch never re-derives it.
            pseudonymLabel: slice.snapshot.pseudonymLabel,
            timezone: slice.snapshot.timezone,
            monthStart: slice.window.monthStartLocal,
            monthEnd: slice.window.monthEndLocal,
            snapshot: slice.snapshot,
            // Render server-side so the rich, tested user prompt travels verbatim.
            userPrompt: buildMonthlyReprofileUserPrompt(slice.snapshot),
          },
        };
      }),
    );

    // `Promise.allSettled` preserves order → `results[j]` ↔ `chunk[j]`, so a
    // rejected load can be attributed to the failing member for observability.
    for (let j = 0; j < results.length; j += 1) {
      const res = results[j];
      if (res === undefined) continue;
      if (res.status === 'fulfilled') {
        const outcome = res.value;
        if (outcome.kind === 'entry') {
          monthStart ??= outcome.value.monthStart;
          monthEnd ??= outcome.value.monthEnd;
          entries.push(outcome.value);
        } else if (outcome.kind === 'silent') {
          monthStart ??= outcome.monthStart;
          monthEnd ??= outcome.monthEnd;
          silentSkipped += 1;
        }
        // 'dropped' (suspended / not-found) is an intentional silent drop.
        continue;
      }
      // A REJECTED per-member load (corrupt timezone, transient DB error) must
      // NOT fail the whole batch, but it must NOT be a SILENT drop either:
      // surface it (Sentry warning + PII-free audit). PII-minimised: reason =
      // error.message truncated to 200 chars (not guaranteed PII-free; the
      // truncation + read-only surface keep exposure low). Never the AI text.
      const memberId = chunk[j]?.id ?? null;
      const reason =
        res.reason instanceof Error
          ? res.reason.message.slice(0, 200)
          : String(res.reason).slice(0, 200);
      reportWarning('member_profile_monthly.batch', 'member_snapshot_load_failed', {
        userId: memberId,
        reason,
      });
      await logAudit({
        action: 'member_profile_monthly.batch.skipped',
        userId: memberId,
        metadata: { ranAt, monthStart: monthStart ?? null, reason },
      });
    }
  }

  await logAudit({
    action: 'member_profile_monthly.batch.pulled',
    metadata: {
      ranAt,
      entriesCount: entries.length,
      silentSkipped,
      monthStart: monthStart ?? null,
    },
  });

  return {
    ranAt,
    monthStart: monthStart ?? '',
    monthEnd: monthEnd ?? '',
    systemPrompt: buildMonthlyReprofileSystemPrompt(),
    outputJsonSchema: MEMBER_PROFILE_MONTHLY_OUTPUT_JSON_SCHEMA,
    entries,
  };
}

/**
 * Convenience for the local script — build the per-member user prompt from the
 * snapshot (same logic the live path would use internally).
 */
export function buildReprofileBatchUserPrompt(entry: MemberProfileMonthlyBatchEntry): string {
  return buildMonthlyReprofileUserPrompt(entry.snapshot);
}

// =============================================================================
// Persist side — accept Claude-generated snapshots + write to DB
// =============================================================================

/**
 * The model attribution allowlist (mirror weekly/monthly "BLOQUANT 5"): the
 * orchestrator laptop is untrusted, so a wire-provided `model` is recorded
 * verbatim only when it is a known executable slug or the local sentinel — a
 * forged string falls back to the honest sentinel (anti cost-inflation).
 */
const PRICING_KEYS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  CLAUDE_CODE_LOCAL_MODEL,
];

/**
 * Validate + persist a batch of locally-generated monthly re-profiling
 * snapshots. Idempotent on `(userId, monthStart)` (upsert). Carbon of the
 * monthly-debrief / onboarding persist paths.
 *
 * Validation gates (fail-fast, per entry — one bad entry never throws the batch):
 *   - the month boundary must parse via `parseLocalDate` (TZ-safe); `monthEnd`
 *     is ALWAYS service-recomputed from `monthStart` (anti-tamper, SPEC §25.3)
 *   - entries targeting an unknown/inactive user are skipped (forged-id defense)
 *   - each `output` must pass `memberProfileMonthlySnapshotOutputSchema.strict()`
 *   - a HIGH/MEDIUM crisis signal in the AI OUTPUT ⇒ skip persist (OUTPUT-IA
 *     skip path — nothing here is member-written, so NOT the persist-anyway path)
 *   - {@link runMonthlyReprofileSafetyGate}: AMF → anti-clinical → evidence
 *     grounded in the SERVER-re-derived reflection corpus (never the wire)
 *
 * Audit rows are PII-free (counts + monthStart + ranAt + canonical labels only).
 */
export async function persistGeneratedSnapshots(
  request: MemberProfileMonthlyBatchPersistRequest,
): Promise<MemberProfileMonthlyBatchPersistResult> {
  const ranAt = new Date().toISOString();

  let monthStartDb: Date;
  let monthEndDb: Date;
  try {
    // `monthStart` is the SSOT (UTC-midnight `@db.Date`). `monthEnd` is ALWAYS
    // service-computed from it — the route Zod validates only its FORMAT, not
    // its coherence, so an incoherent `request.monthEnd` is simply ignored
    // (mirror monthly-debrief anti-tamper). Europe/Paris is the V1 cohort TZ and
    // the last civil day is TZ-independent.
    monthStartDb = parseLocalDate(request.monthStart);
    const window = monthWindowFromMonthStart(request.monthStart, 'Europe/Paris');
    monthEndDb = parseLocalDate(window.monthEndLocal);
  } catch (err) {
    await logAudit({
      action: 'member_profile_monthly.batch.invalid_output',
      metadata: {
        ranAt,
        monthStart: request.monthStart,
        monthEnd: request.monthEnd,
        reason: 'invalid_month_window',
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    return { persisted: 0, skipped: 0, errors: request.results.length };
  }

  // Forged-id defense: a compromised laptop could otherwise inject a snapshot
  // against any userId.
  const activeUserIds = new Set(
    (
      await db.user.findMany({
        where: { status: 'active' },
        select: { id: true },
      })
    ).map((u) => u.id),
  );

  let persisted = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of request.results) {
    if ('error' in entry) {
      skipped += 1;
      await logAudit({
        action: 'member_profile_monthly.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, monthStart: request.monthStart, reason: entry.error.slice(0, 200) },
      });
      continue;
    }

    if (!activeUserIds.has(entry.userId)) {
      skipped += 1;
      await logAudit({
        action: 'member_profile_monthly.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, monthStart: request.monthStart, reason: 'unknown_or_inactive_user' },
      });
      continue;
    }

    // Double-net validation — re-validate server-side against the strict schema
    // even if the local script claims it validated.
    const parsed = memberProfileMonthlySnapshotOutputSchema.safeParse(entry.output);
    if (!parsed.success) {
      errors += 1;
      await logAudit({
        action: 'member_profile_monthly.batch.invalid_output',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          issuesCount: parsed.error.issues.length,
        },
      });
      continue;
    }
    const output = parsed.data;

    // Crisis routing on the Claude OUTPUT BEFORE persist (mirror V1.7.1). Uses
    // the SAME single corpus as the AMF/clinical scan (composeMonthlyOutputCorpus)
    // so the 4 dims + the narrative are all covered, with no risk of the two
    // scans drifting apart. OUTPUT-IA skip path (nothing here is member-written).
    const outputCorpus = composeMonthlyOutputCorpus(output);
    const crisis = detectCrisis(outputCorpus);
    if (crisis.level === 'high' || crisis.level === 'medium') {
      skipped += 1;
      await logAudit({
        action: 'member_profile_monthly.batch.crisis_detected',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          level: crisis.level,
          matchedLabels: crisis.matches.map((m) => m.label),
        },
      });
      if (crisis.level === 'high') {
        reportError(
          'member_profile_monthly.batch',
          new Error(
            `crisis_signal_high_in_ai_output: ${crisis.matches.map((m) => m.label).join(',')}`,
          ),
          { userId: entry.userId, monthStart: request.monthStart },
        );
      } else {
        reportWarning('member_profile_monthly.batch', 'crisis_signal_medium_in_ai_output', {
          userId: entry.userId,
          monthStart: request.monthStart,
          matchedLabels: crisis.matches.map((m) => m.label),
        });
      }
      continue;
    }

    // Safety gate — AMF + anti-clinical (on the output) + evidence grounding
    // (each dim's evidence[] must be a verbatim NFC substring of the month's
    // reflection corpus). The corpus is RE-DERIVED server-side from monthStart
    // so it can never be forged on the wire (mirror onboarding
    // `rederiveSnapshotForValidation`).
    const sourceCorpus = await loadReflectionCorpusForMonth(entry.userId, request.monthStart);
    if (sourceCorpus === null) {
      skipped += 1;
      await logAudit({
        action: 'member_profile_monthly.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, monthStart: request.monthStart, reason: 'corpus_rederive_failed' },
      });
      continue;
    }

    const safety = runMonthlyReprofileSafetyGate({ output, sourceCorpus });
    if (safety.status === 'reject') {
      skipped += 1;
      if (safety.reason === 'amf_violation') {
        await logAudit({
          action: 'member_profile_monthly.batch.amf_violation',
          userId: entry.userId,
          metadata: { ranAt, monthStart: request.monthStart, matchedLabels: safety.matchedLabels },
        });
        reportWarning('member_profile_monthly.batch', 'amf_violation_in_ai_output', {
          userId: entry.userId,
          monthStart: request.monthStart,
          matchedLabels: safety.matchedLabels,
        });
      } else if (safety.reason === 'clinical_language') {
        await logAudit({
          action: 'member_profile_monthly.batch.skipped',
          userId: entry.userId,
          metadata: {
            ranAt,
            monthStart: request.monthStart,
            reason: 'clinical_language',
            matchedLabels: safety.matchedLabels,
          },
        });
        reportWarning('member_profile_monthly.batch', 'clinical_language_in_ai_output', {
          userId: entry.userId,
          monthStart: request.monthStart,
          matchedLabels: safety.matchedLabels,
        });
      } else {
        await logAudit({
          action: 'member_profile_monthly.batch.evidence_invalid',
          userId: entry.userId,
          metadata: {
            ranAt,
            monthStart: request.monthStart,
            invalidDimensionPaths: safety.invalidDimensionPaths,
          },
        });
        reportWarning('member_profile_monthly.batch', 'evidence_invalid_in_ai_output', {
          userId: entry.userId,
          monthStart: request.monthStart,
          invalidDimensionPaths: safety.invalidDimensionPaths,
        });
      }
      continue;
    }

    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const claudeModel =
      entry.model && PRICING_KEYS.includes(entry.model) ? entry.model : CLAUDE_CODE_LOCAL_MODEL;
    const cost = computeCostEur(claudeModel, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheCreateTokens: 0,
    });

    // The 4 deep dims — include ONLY fields the model produced (mirror the
    // onboarding persist). Absent field ⇒ NULL on create (nullable column),
    // left unchanged on the rare re-run update path. No Prisma.JsonNull sentinel.
    const aiDimensions = {
      ...(output.coaching_tone !== undefined ? { coachingTone: output.coaching_tone } : {}),
      ...(output.learning_stage !== undefined ? { learningStage: output.learning_stage } : {}),
      ...(output.axes_structured !== undefined ? { axesStructured: output.axes_structured } : {}),
      ...(output.weak_signals !== undefined ? { weakSignals: output.weak_signals } : {}),
    };

    try {
      await db.memberProfileMonthlySnapshot.upsert({
        where: { userId_monthStart: { userId: entry.userId, monthStart: monthStartDb } },
        create: {
          userId: entry.userId,
          monthStart: monthStartDb,
          monthEnd: monthEndDb,
          evolutionNarrative: output.evolution_narrative,
          claudeModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheCreateTokens: 0,
          costEur: cost.costEur,
          ...aiDimensions,
        },
        update: {
          // A re-run replaces this month's reading. `generatedAt` is bumped so
          // the admin sees when the CURRENT reading was produced (the default
          // only applies on create).
          monthEnd: monthEndDb,
          generatedAt: new Date(),
          evolutionNarrative: output.evolution_narrative,
          claudeModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheCreateTokens: 0,
          costEur: cost.costEur,
          ...aiDimensions,
        },
      });
      persisted += 1;
      await logAudit({
        action: 'member_profile_monthly.analyzed',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          claudeModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
      });
    } catch (err) {
      errors += 1;
      await logAudit({
        action: 'member_profile_monthly.batch.persist_failed',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      });
      reportError(
        'member_profile_monthly.batch',
        err instanceof Error ? err : new Error('persist_failed_unknown'),
        { userId: entry.userId, monthStart: request.monthStart },
      );
    }
  }

  await logAudit({
    action: 'member_profile_monthly.batch.persisted',
    metadata: {
      ranAt,
      monthStart: request.monthStart,
      monthEnd: request.monthEnd,
      persisted,
      skipped,
      errors,
      total: request.results.length,
    },
  });

  return { persisted, skipped, errors };
}
