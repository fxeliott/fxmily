import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate } from '@/lib/checkin/timezone';
import {
  monthlyDebriefOutputSchema,
  type MonthlyDebriefOutput,
  type MonthlySnapshot,
} from '@/lib/schemas/monthly-debrief';

import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';

import { buildMonthlySnapshot } from './builder';
import { loadMonthlySliceForUser } from './loader';
import { CLAUDE_CODE_LOCAL_MODEL, computeCostEur } from './pricing';
import {
  MONTHLY_DEBRIEF_OUTPUT_JSON_SCHEMA,
  MONTHLY_DEBRIEF_SYSTEM_PROMPT,
  buildMonthlyDebriefUserPrompt,
} from './prompt';

/**
 * V1.4 §25 — Local-Claude monthly debrief batch (Eliot's Max subscription
 * path). EXACT carbon of `weekly-report/batch.ts` adapted to the monthly
 * cadence + the §25 dual-section output.
 *
 * Architecture (mirror V1.7.2) : Eliot refuses to pay for Anthropic API
 * tokens. The monthly debriefs are generated via `claude --print` (headless
 * Claude Code CLI) on Eliot's local Windows machine using his Claude Max
 * subscription. The workflow :
 *
 *   1. Eliot runs `ops/scripts/monthly-batch-local.sh` (1st of the month)
 *   2. The script curl-POSTs `/api/admin/monthly-batch/pull` →
 *      {@link loadAllSnapshotsForActiveMembers} → pseudonymized snapshots
 *   3. For each member the script invokes `claude --print` with the
 *      canonical Mark Douglas system prompt + the snapshot, 60-120s jittered
 *   4. The script curl-POSTs `/api/admin/monthly-batch/persist` →
 *      {@link persistGeneratedReports}
 *
 * The 9 ban-risk mitigation rules are identical to the weekly batch
 * (jittered sleeps, official `claude` binary only, pseudonymized data,
 * system prompt + schema travel WITH the envelope, double-net Zod, active-
 * user re-check, PII-free audit).
 *
 * 🚨 §21.5 / §25.7. The snapshot's training slice is structurally count/
 * recency only (pinned upstream by the loader + anti-leak Block B/G). The
 * crisis scan below runs on the AI OUTPUT text (the synthesis), never on a
 * backtest P&L (none exists in the pipeline).
 */

// =============================================================================
// Public types — wire contract between Hetzner and the local script
// =============================================================================

export interface MonthlyBatchSnapshotEntry {
  /** Real internal user id. NEVER exposed to Anthropic — kept only so the
   *  local script can route the eventual debrief back to the right row. */
  userId: string;
  /** Pseudonym label (8-char hex) — pre-computed by the LOADER at the Claude
   *  boundary (SPEC §25.2). Safe to log + include in the prompt. */
  pseudonymLabel: string;
  /** Member timezone (Europe/Paris by default V1). */
  timezone: string;
  /** Local 1st-of-month ISO date (YYYY-MM-DD). */
  monthStart: string;
  /** Local last-calendar-day ISO date (YYYY-MM-DD). */
  monthEnd: string;
  /** Pure aggregator output (zod-valid). Free text already sanitized. */
  snapshot: MonthlySnapshot;
  /** True iff the member had any real OR training activity in the month.
   *  Informational only — UNLIKE the weekly batch, the monthly script does
   *  NOT skip inactive members: SPEC §25.4 mandates a debrief for EVERY
   *  active member (the AI writes an honest "mois calme"). */
  hasActivity: boolean;
}

/**
 * Envelope returned by the pull route. `systemPrompt` + `outputJsonSchema`
 * ride along so the local script needs no Fxmily TypeScript — `bash | jq |
 * curl | claude --print` is enough.
 */
export interface MonthlyBatchPullEnvelope {
  ranAt: string;
  monthStart: string;
  monthEnd: string;
  systemPrompt: string;
  outputJsonSchema: unknown;
  entries: MonthlyBatchSnapshotEntry[];
}

export type MonthlyBatchResultEntry =
  | {
      userId: string;
      output: MonthlyDebriefOutput;
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

export interface MonthlyBatchPersistRequest {
  monthStart: string; // YYYY-MM-DD, must match the pull envelope's monthStart
  monthEnd: string;
  results: MonthlyBatchResultEntry[];
}

export interface MonthlyBatchPersistResult {
  persisted: number;
  skipped: number;
  errors: number;
}

// =============================================================================
// Pull side — collect snapshots for every active member
// =============================================================================

/**
 * Carbon weekly `SNAPSHOT_BATCH_CONCURRENCY` (5). Each
 * `loadMonthlySliceForUser` opens ~7 connections; a chunk of 5 demands up
 * to ~35 vs `db.ts` pool max=10 — Prisma queues the rest, throughput is
 * fine at this concurrency and well under the 5s connectionTimeout.
 */
const SNAPSHOT_BATCH_CONCURRENCY = 5;

/**
 * Load every active member's civil-month slice + build a pseudonymized
 * snapshot. Used by `app/api/admin/monthly-batch/pull/route.ts`. Pure read.
 *
 * `currentMonth` defaults to `false` — the cadence is "1st of the month,
 * generate debriefs for the month that just ended" (`computeReportingMonth`,
 * `now − 24h` anchored). Pass `true` to preview the in-progress month.
 *
 * SPEC §25.4 — UNLIKE the weekly batch, members with no activity are NOT
 * filtered out: every active member gets a debrief (the AI produces an
 * honest "mois calme"). `null` slices (suspended / not-found) are dropped.
 */
export async function loadAllSnapshotsForActiveMembers(
  options: { now?: Date; currentMonth?: boolean } = {},
): Promise<MonthlyBatchPullEnvelope> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();
  const currentMonth = options.currentMonth ?? false;

  const users = await db.user.findMany({
    where: { status: 'active' },
    select: { id: true },
    orderBy: { joinedAt: 'asc' },
  });

  const entries: MonthlyBatchSnapshotEntry[] = [];
  let monthStart: string | null = null;
  let monthEnd: string | null = null;

  for (let i = 0; i < users.length; i += SNAPSHOT_BATCH_CONCURRENCY) {
    const chunk = users.slice(i, i + SNAPSHOT_BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (user) => {
        const slice = await loadMonthlySliceForUser(user.id, { now, currentMonth });
        if (slice === null) return null;
        const snapshot = buildMonthlySnapshot(slice.builderInput);
        const a = snapshot.real;
        const hasActivity =
          a.tradesTotal > 0 ||
          a.morningCheckinsCount > 0 ||
          a.eveningCheckinsCount > 0 ||
          snapshot.training.backtestCount > 0;
        return {
          userId: user.id,
          // SPEC §25.2 decision — the pseudonym is pre-computed by the
          // loader (snapshot.pseudonymLabel). The batch never re-derives it.
          pseudonymLabel: snapshot.pseudonymLabel,
          timezone: snapshot.timezone,
          monthStart: slice.window.monthStartLocal,
          monthEnd: slice.window.monthEndLocal,
          snapshot,
          hasActivity,
        } satisfies MonthlyBatchSnapshotEntry;
      }),
    );
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value !== null) {
        monthStart ??= res.value.monthStart;
        monthEnd ??= res.value.monthEnd;
        entries.push(res.value);
      }
      // Rejected promises are silently dropped — individual member load
      // failures (corrupt timezone, etc.) must not fail the whole batch.
    }
  }

  await logAudit({
    action: 'monthly_debrief.batch.pulled',
    metadata: {
      ranAt,
      entriesCount: entries.length,
      activeCount: entries.filter((e) => e.hasActivity).length,
      monthStart: monthStart ?? null,
    },
  });

  return {
    ranAt,
    monthStart: monthStart ?? '',
    monthEnd: monthEnd ?? '',
    systemPrompt: MONTHLY_DEBRIEF_SYSTEM_PROMPT,
    outputJsonSchema: MONTHLY_DEBRIEF_OUTPUT_JSON_SCHEMA,
    entries,
  };
}

/**
 * Convenience for the local script — build the per-member user prompt from
 * the snapshot (same logic the live path would use internally).
 */
export function buildMonthlyBatchUserPrompt(entry: MonthlyBatchSnapshotEntry): string {
  return buildMonthlyDebriefUserPrompt(entry.snapshot);
}

// =============================================================================
// Persist side — accept Claude-generated debriefs + write to DB
// =============================================================================

/**
 * Validate + persist a batch of locally-generated monthly debriefs.
 * Idempotent on `(userId, monthStart)` (upsert). Carbon weekly
 * `persistGeneratedReports`.
 *
 * Validation gates :
 *   - the month boundary must parse via `parseLocalDate` (TZ-safe)
 *   - each entry's `output` must pass `monthlyDebriefOutputSchema.strict()`
 *   - entries targeting an unknown/inactive user are skipped (forged-id
 *     defense, mirror weekly security-auditor BLOCKER 4)
 *   - 🚨 a HIGH/MEDIUM crisis signal in the AI OUTPUT ⇒ **skip persist**
 *     (mirror V1.7.1 — the text is AI/admin output, NOT member-written, so
 *     this is the skip path, not the REFLECT persist-anyway path)
 *
 * Never throws on a single bad entry — counts and moves on. Audit rows are
 * PII-free (counts + monthStart + ranAt only).
 */
export async function persistGeneratedReports(
  request: MonthlyBatchPersistRequest,
): Promise<MonthlyBatchPersistResult> {
  const ranAt = new Date().toISOString();

  let monthStartDb: Date;
  let monthEndDb: Date;
  try {
    monthStartDb = parseLocalDate(request.monthStart);
    monthEndDb = parseLocalDate(request.monthEnd);
  } catch (err) {
    await logAudit({
      action: 'monthly_debrief.batch.invalid_output',
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

  // Forged-id defense (mirror weekly security-auditor BLOCKER 4) : a
  // compromised laptop could otherwise inject a debrief against any userId.
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
        action: 'monthly_debrief.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          reason: entry.error.slice(0, 200),
        },
      });
      continue;
    }

    if (!activeUserIds.has(entry.userId)) {
      skipped += 1;
      await logAudit({
        action: 'monthly_debrief.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          reason: 'unknown_or_inactive_user',
        },
      });
      continue;
    }

    // Double-net validation — re-validate server-side against the strict
    // schema even if the local script claims it validated.
    const parsed = monthlyDebriefOutputSchema.safeParse(entry.output);
    if (!parsed.success) {
      errors += 1;
      await logAudit({
        action: 'monthly_debrief.batch.invalid_output',
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

    // V1.7.1 carbon — crisis routing on the Claude OUTPUT BEFORE persist.
    // Concatenate every free-text channel the AI can write, run the
    // deterministic FR regex, HALT the persist on a HIGH/MEDIUM signal.
    // ⚠️ This is the OUTPUT-IA skip path (mirror weekly batch.ts), NOT the
    // REFLECT "persist-quand-même" path (which only applies to member-
    // written text — here nothing is member-written).
    const crisisCorpus = [
      output.progressionNarrative,
      output.summaryReal,
      output.summaryTraining,
      ...output.risks,
      ...output.recommendations,
      output.patterns.monthOverMonth ?? '',
      output.patterns.realTrend ?? '',
      output.patterns.trainingRhythm ?? '',
      output.patterns.disciplineTrend ?? '',
    ]
      .filter(Boolean)
      .join('\n');
    const crisis = detectCrisis(crisisCorpus);
    if (crisis.level === 'high' || crisis.level === 'medium') {
      skipped += 1;
      await logAudit({
        action: 'monthly_debrief.batch.crisis_detected',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          level: crisis.level,
          matchedLabels: crisis.matches.map((m) => m.label),
        },
      });
      // HIGH → error (page-out), MEDIUM → warning (review next morning).
      // Never include the raw text — only canonical labels (RGPD §16).
      if (crisis.level === 'high') {
        reportError(
          'monthly_debrief.batch',
          new Error(
            `crisis_signal_high_in_ai_output: ${crisis.matches.map((m) => m.label).join(',')}`,
          ),
          { userId: entry.userId, monthStart: request.monthStart },
        );
      } else {
        reportWarning('monthly_debrief.batch', 'crisis_signal_medium_in_ai_output', {
          userId: entry.userId,
          monthStart: request.monthStart,
          matchedLabels: crisis.matches.map((m) => m.label),
        });
      }
      continue;
    }

    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    // Pin the model to the local-Claude sentinel by default; reject any
    // external model name (anti cost-inflation via forged model, mirror
    // weekly code-reviewer Round 16 BLOQUANT 5).
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
      await db.monthlyDebrief.upsert({
        where: {
          userId_monthStart: {
            userId: entry.userId,
            monthStart: monthStartDb,
          },
        },
        create: {
          userId: entry.userId,
          monthStart: monthStartDb,
          monthEnd: monthEndDb,
          progressionNarrative: output.progressionNarrative,
          summaryReal: output.summaryReal,
          summaryTraining: output.summaryTraining,
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
          // Content + month end only — dispatch state (sentToMemberAt /
          // pushEnqueuedAt) is intentionally NOT reset on re-run so a
          // second batch pass never re-notifies the member (carbon weekly
          // TIER 2 HIGH email-re-spam fix; J-M3 wires the dispatch).
          monthEnd: monthEndDb,
          progressionNarrative: output.progressionNarrative,
          summaryReal: output.summaryReal,
          summaryTraining: output.summaryTraining,
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
        action: 'monthly_debrief.batch.persist_failed',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      });
    }
  }

  await logAudit({
    action: 'monthly_debrief.batch.persisted',
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
