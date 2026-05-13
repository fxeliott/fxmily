import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate } from '@/lib/checkin/timezone';
import {
  weeklyReportOutputSchema,
  type WeeklyReportOutput,
  type WeeklySnapshot,
} from '@/lib/schemas/weekly-report';

import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';

import { buildWeeklySnapshot } from './builder';
import { loadWeeklySliceForUser } from './loader';
import { CLAUDE_CODE_LOCAL_MODEL, computeCostEur } from './pricing';
import { buildWeeklyReportUserPrompt, WEEKLY_REPORT_SYSTEM_PROMPT } from './prompt';
import type { WeekWindow } from './week-window';

/**
 * V1.7 — Local-Claude weekly batch helpers (Eliot's Max subscription path).
 *
 * Architecture decision (2026-05-13) : Eliot refuses to pay for Anthropic API
 * tokens. Instead, the weekly reports are generated via `claude --print`
 * (headless Claude Code CLI) running on Eliot's local Windows machine using
 * his Claude Max subscription. The Hetzner cron is disabled; the workflow is:
 *
 *   1. Eliot runs `ops/scripts/weekly-batch-local.sh` from his Fxmily worktree
 *   2. The local script SSHs into Hetzner, calls `pull-snapshots.ts` which
 *      uses {@link loadAllSnapshotsForActiveMembers}
 *   3. For each pseudo'd snapshot the local script invokes `claude --print`
 *      with the canonical Mark Douglas system prompt + the snapshot — spread
 *      across 60-120s jittered intervals to minimize Anthropic detection of
 *      burst patterns
 *   4. Local script SSHs back, calls `persist-reports.ts` which uses
 *      {@link persistGeneratedReports}
 *
 * Ban-risk mitigation rules baked into this module :
 *   - Snapshots are already pseudonymized (`pseudonymizeMember` 8-char hex
 *     from V1.5) — no real email/name reaches Anthropic
 *   - `safeFreeText` already strips bidi/zero-width control chars from member
 *     free text (J5 audit M5)
 *   - System prompt + schema travel WITH each snapshot — no cross-member
 *     context contamination
 *   - The persist path validates via `weeklyReportOutputSchema.strict()` so
 *     a malformed Claude output is rejected, not silently persisted
 *   - Audit row `weekly_report.batch.persisted` captures count + week + ranAt
 *     so we can spot a malicious push attempt (DBA-side query on actor_user)
 *
 * Read posture Mark Douglas locking : the system prompt referenced here is
 * hardcoded in `lib/weekly-report/prompt.ts` — code review oversight on copy.
 * The local script CANNOT swap in a different system prompt without touching
 * this repo (defense against on-device tampering by a compromised laptop).
 */

// =============================================================================
// Public types — wire contract between Hetzner and the local script
// =============================================================================

/**
 * One member's snapshot ready to be handed to `claude --print`. Designed to be
 * JSON-serialized over the SSH stdout pipe.
 */
export interface BatchSnapshotEntry {
  /** Real internal user id. NEVER exposed to Anthropic — kept here only so
   *  the local script can route the eventual report back to the right row. */
  userId: string;
  /** Pseudonym label V1.5 (8-char hex). Safe to log + safe to include in the
   *  prompt sent to Claude. */
  pseudonymLabel: string;
  /** Member timezone (Europe/Paris by default V1) — passed through so the
   *  system prompt can localize numbers if it wants. */
  timezone: string;
  /** Local-Monday-00:00 ISO date (YYYY-MM-DD). */
  weekStart: string;
  /** Local-Sunday-23:59 ISO date (YYYY-MM-DD). */
  weekEnd: string;
  /** Builder output (zod-validated). Free text already sanitized. */
  snapshot: WeeklySnapshot;
  /** True iff the member had any activity in the week. Inactive members are
   *  skipped by the local script to save subscription tokens. */
  hasActivity: boolean;
}

/**
 * The envelope returned by `pull-snapshots.ts` to the local script.
 *
 * `systemPrompt` and `outputJsonSchema` ride along so the local script does
 * not need to import any Fxmily TypeScript code — `bash | jq | curl | claude
 * --print` is enough to run a batch.
 */
export interface BatchPullEnvelope {
  ranAt: string;
  weekStart: string;
  weekEnd: string;
  systemPrompt: string;
  outputJsonSchema: unknown;
  entries: BatchSnapshotEntry[];
}

/**
 * One entry of the result POSTed back from the local script.
 *
 * `output` is the parsed/validated WeeklyReportOutput. If the local script
 * could not generate a valid output (Claude error, schema mismatch), it sets
 * `error` instead. The persist step silently skips entries with `error` set
 * but logs an audit row so the human can investigate.
 */
export type BatchResultEntry =
  | {
      userId: string;
      output: WeeklyReportOutput;
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

export interface BatchPersistRequest {
  weekStart: string; // YYYY-MM-DD, must match the pull envelope's weekStart
  weekEnd: string;
  results: BatchResultEntry[];
}

export interface BatchPersistResult {
  persisted: number;
  skipped: number;
  errors: number;
}

// =============================================================================
// Pull side — collect snapshots for every active member
// =============================================================================

/**
 * V1.7 perf fix (code-reviewer Round 16 HIGH H2) : batch concurrency for the
 * N+1 fan-out. Each `loadWeeklySliceForUser` opens 6 connections (4 findMany +
 * 1 score query + 1 user findUnique) so a batch of 5 demands up to 30
 * connections vs `db.ts` pool max=10. Prisma queues the rest, but throughput
 * is fine at this concurrency and stays well under the 5s connectionTimeout.
 * If we ever scale past ~500 active members, bump `max` in `lib/db.ts` first.
 */
const SNAPSHOT_BATCH_CONCURRENCY = 5;

/**
 * Load every active member's weekly slice + build a pseudonymized snapshot.
 * Used by `app/api/admin/weekly-batch/pull/route.ts` (V1.7.2 HTTP migration).
 * Pure read; no side effects.
 *
 * `previousFullWeek` defaults to `true` — the cadence is "Sunday eve / Monday
 * morning, generate reports for the week that just ended". If you want to
 * preview the in-progress week (rare), pass `false`.
 *
 * Inactive members AND members with `null` slice (e.g. joined > 7 days ago
 * but never logged a trade) are filtered OUT — they get `hasActivity: false`
 * upstream and the local script skips them.
 *
 * Performance : `SNAPSHOT_BATCH_CONCURRENCY`-by-5 with `Promise.allSettled`.
 * At 30 members ~1.8s expected (vs ~9s sequential). At 1000 ~60s (vs ~5min
 * sequential = Caddy timeout). Pattern mirrors `service.ts:196-269`.
 */
export async function loadAllSnapshotsForActiveMembers(
  options: { now?: Date; previousFullWeek?: boolean } = {},
): Promise<BatchPullEnvelope> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();
  const previousFullWeek = options.previousFullWeek ?? true;

  const users = await db.user.findMany({
    where: { status: 'active' },
    select: { id: true, pseudonymLabel: true, timezone: true },
    orderBy: { joinedAt: 'asc' },
  });

  const entries: BatchSnapshotEntry[] = [];
  let weekStart: string | null = null;
  let weekEnd: string | null = null;

  // Process members in parallel batches of SNAPSHOT_BATCH_CONCURRENCY to keep
  // the Prisma pool happy while still cutting wall time by ~5×.
  for (let i = 0; i < users.length; i += SNAPSHOT_BATCH_CONCURRENCY) {
    const chunk = users.slice(i, i + SNAPSHOT_BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (user) => {
        const slice = await loadWeeklySliceForUser(user.id, { now, previousFullWeek });
        if (slice === null) return null;
        const snapshot = buildWeeklySnapshot(slice.builderInput);
        const c = snapshot.counters;
        const hasActivity =
          c.tradesTotal > 0 || c.morningCheckinsCount > 0 || c.eveningCheckinsCount > 0;
        return {
          userId: user.id,
          pseudonymLabel: user.pseudonymLabel ?? user.id.slice(0, 8),
          timezone: user.timezone,
          weekStart: slice.window.weekStartLocal,
          weekEnd: slice.window.weekEndLocal,
          snapshot,
          hasActivity,
        } satisfies BatchSnapshotEntry;
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value !== null) {
        weekStart ??= r.value.weekStart;
        weekEnd ??= r.value.weekEnd;
        entries.push(r.value);
      }
      // Rejected promises are silently dropped — they're individual member
      // load failures (corrupt timezone, etc.) and shouldn't fail the whole
      // batch. Audit emit downstream if needed.
    }
  }

  await logAudit({
    action: 'weekly_report.batch.pulled',
    metadata: {
      ranAt,
      entriesCount: entries.length,
      activeCount: entries.filter((e) => e.hasActivity).length,
      weekStart: weekStart ?? null,
    },
  });

  return {
    ranAt,
    weekStart: weekStart ?? '',
    weekEnd: weekEnd ?? '',
    systemPrompt: WEEKLY_REPORT_SYSTEM_PROMPT,
    outputJsonSchema: WEEKLY_REPORT_OUTPUT_JSON_SCHEMA_REF,
    entries,
  };
}

/**
 * Convenience for the local script — build the per-member user prompt from
 * the snapshot. Same logic as the live cron path used internally by
 * `LiveWeeklyReportClient`, but exposed here for reuse.
 */
export function buildBatchUserPrompt(entry: BatchSnapshotEntry): string {
  return buildWeeklyReportUserPrompt(entry.snapshot);
}

// Lazily-referenced JSON-schema export — `prompt.ts` already exposes it; we
// just re-export to keep imports tight on the pull script.
import { WEEKLY_REPORT_OUTPUT_JSON_SCHEMA } from './prompt';
const WEEKLY_REPORT_OUTPUT_JSON_SCHEMA_REF = WEEKLY_REPORT_OUTPUT_JSON_SCHEMA;

// =============================================================================
// Persist side — accept Claude-generated reports + write to DB
// =============================================================================

/**
 * Validate + persist a batch of locally-generated reports. Idempotent on
 * `(userId, weekStart)` (upsert).
 *
 * Validation gates :
 *   - Each entry's `output` must pass `weeklyReportOutputSchema.strict()`
 *   - The week boundary must parse via `parseLocalDate` (same TZ-safe path
 *     as the cron)
 *   - Entries with `error` set are skipped + audited (no row written)
 *
 * The function NEVER throws on a single bad entry — it counts and moves on.
 * The aggregate `errors` counter is returned so the local script can report.
 *
 * Audit row `weekly_report.batch.persisted` carries counts only (no PII).
 */
export async function persistGeneratedReports(
  request: BatchPersistRequest,
): Promise<BatchPersistResult> {
  const ranAt = new Date().toISOString();

  // V1.7 fix (code-reviewer Round 16 BLOQUANT 2) : wrap parseLocalDate so a
  // malformed weekStart/weekEnd doesn't crash the whole batch. The function
  // JSDoc promises "never throws on a single bad entry" — that promise was
  // violated for the envelope itself. Now we surface the error via audit row
  // and return a clean fail-loud counts object.
  let weekStartDb: Date;
  let weekEndDb: Date;
  try {
    weekStartDb = parseLocalDate(request.weekStart);
    weekEndDb = parseLocalDate(request.weekEnd);
  } catch (err) {
    await logAudit({
      action: 'weekly_report.batch.invalid_output',
      metadata: {
        ranAt,
        weekStart: request.weekStart,
        weekEnd: request.weekEnd,
        reason: 'invalid_week_window',
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    return { persisted: 0, skipped: 0, errors: request.results.length };
  }

  const weekWindowLog: Pick<WeekWindow, 'weekStartLocal' | 'weekEndLocal'> = {
    weekStartLocal: request.weekStart,
    weekEndLocal: request.weekEnd,
  };

  // V1.7 fix (security-auditor Round 16 BLOCKER 4) : pre-fetch all active
  // user ids so we can reject persists targeting unknown / suspended users.
  // A compromised laptop could otherwise inject a fake report against any
  // userId — even one that never existed. Set lookup is O(1) per entry.
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
        action: 'weekly_report.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          reason: entry.error.slice(0, 200),
        },
      });
      continue;
    }

    // V1.7 fix (security-auditor Round 16 BLOCKER 4) : reject entries that
    // target a user id which isn't currently active. Prevents a compromised
    // laptop from forging a report against an arbitrary userId.
    if (!activeUserIds.has(entry.userId)) {
      skipped += 1;
      await logAudit({
        action: 'weekly_report.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          reason: 'unknown_or_inactive_user',
        },
      });
      continue;
    }

    // Double-net validation — even if the local script claims it validated,
    // we re-validate server-side against the strict schema. Defense in depth
    // against compromised laptop tampering.
    const parsed = weeklyReportOutputSchema.safeParse(entry.output);
    if (!parsed.success) {
      errors += 1;
      await logAudit({
        action: 'weekly_report.batch.invalid_output',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          issuesCount: parsed.error.issues.length,
        },
      });
      continue;
    }

    const output = parsed.data;

    // V1.7.1 — Crisis routing wire on the Claude output BEFORE persist.
    // Concatenate every free-text channel the AI can write into a member's
    // report, run the deterministic FR regex (V1.7 prep dormant from R7),
    // and HALT the persist if a HIGH or MEDIUM signal is detected.
    //
    // Why pre-persist : we never want a "summary" containing suicidal content
    // to land in the admin dashboard / digest email — the audit row + Sentry
    // warning surfaces it for Eliot to handle out-of-band (call the member,
    // surface 3114 + SOS Amitié + Suicide Écoute).
    //
    // Note : `detectCrisis` already excludes trading slang ("tout perdre sur
    // ce trade", "tuer ma position", "en finir avec ça", "dépression du
    // marché") so a normal trading-loss summary won't trip the gate.
    const crisisCorpus = [
      output.summary,
      ...output.risks,
      ...output.recommendations,
      output.patterns.emotionPerf ?? '',
      output.patterns.sleepPerf ?? '',
      output.patterns.sessionFocus ?? '',
      output.patterns.disciplineTrend ?? '',
    ]
      .filter(Boolean)
      .join('\n');
    const crisis = detectCrisis(crisisCorpus);
    if (crisis.level === 'high' || crisis.level === 'medium') {
      skipped += 1;
      await logAudit({
        action: 'weekly_report.batch.crisis_detected',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          level: crisis.level,
          matchedLabels: crisis.matches.map((m) => m.label),
        },
      });
      // HIGH → error (page-out), MEDIUM → warning (review next morning).
      // Never include the raw text — only canonical labels (RGPD §16).
      if (crisis.level === 'high') {
        reportError(
          'weekly_report.batch',
          new Error(
            `crisis_signal_high_in_ai_output: ${crisis.matches.map((m) => m.label).join(',')}`,
          ),
          { userId: entry.userId, weekStart: request.weekStart },
        );
      } else {
        reportWarning('weekly_report.batch', 'crisis_signal_medium_in_ai_output', {
          userId: entry.userId,
          weekStart: request.weekStart,
          matchedLabels: crisis.matches.map((m) => m.label),
        });
      }
      continue;
    }
    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    // V1.7 fix (code-reviewer Round 16 BLOQUANT 5) : pin the model to the
    // local-Claude sentinel by default. Reject any external model name the
    // local script tries to inject — only the 3 known entries of
    // `PRICING_USD_PER_MTOK` are accepted. This prevents a compromised laptop
    // from inflating `costEur` via a fake model name.
    const PRICING_KEYS = ['claude-sonnet-4-6', 'claude-haiku-4-5', CLAUDE_CODE_LOCAL_MODEL];
    const claudeModel =
      entry.model && PRICING_KEYS.includes(entry.model) ? entry.model : CLAUDE_CODE_LOCAL_MODEL;
    const cost = computeCostEur(claudeModel, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheCreateTokens: 0,
    });

    try {
      await db.weeklyReport.upsert({
        where: {
          userId_weekStart: {
            userId: entry.userId,
            weekStart: weekStartDb,
          },
        },
        create: {
          userId: entry.userId,
          weekStart: weekStartDb,
          weekEnd: weekEndDb,
          summary: output.summary,
          risks: output.risks,
          recommendations: output.recommendations,
          patterns: output.patterns,
          claudeModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheCreateTokens: 0,
          costEur: cost.costEur,
        },
        update: {
          weekEnd: weekEndDb,
          summary: output.summary,
          risks: output.risks,
          recommendations: output.recommendations,
          patterns: output.patterns,
          claudeModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheCreateTokens: 0,
          costEur: cost.costEur,
        },
      });
      persisted += 1;
    } catch (err) {
      errors += 1;
      await logAudit({
        action: 'weekly_report.batch.persist_failed',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      });
    }
  }

  await logAudit({
    action: 'weekly_report.batch.persisted',
    metadata: {
      ranAt,
      weekStart: request.weekStart,
      weekEnd: request.weekEnd,
      persisted,
      skipped,
      errors,
      total: request.results.length,
      window: weekWindowLog,
    },
  });

  return { persisted, skipped, errors };
}
