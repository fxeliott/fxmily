import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { sendMonthlyDebriefReadyEmail } from '@/lib/email/send';
import { enqueueMonthlyDebriefNotification } from '@/lib/notifications/enqueue';
import {
  monthlyDebriefOutputSchema,
  type MonthlyDebriefOutput,
  type MonthlySnapshot,
} from '@/lib/schemas/monthly-debrief';

import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { detectAMFViolation } from '@/lib/safety/amf-detection';

import { buildMonthlySnapshot } from './builder';
import { loadMonthlySliceForUser } from './loader';
import { monthWindowFromMonthStart } from './month-window';
import { CLAUDE_CODE_LOCAL_MODEL, computeCostEur } from './pricing';
import {
  MONTHLY_DEBRIEF_OUTPUT_JSON_SCHEMA,
  MONTHLY_DEBRIEF_SYSTEM_PROMPT,
  buildMonthlyDebriefUserPrompt,
} from './prompt';
import { toSerializedMonthlyDebrief } from './service';

/**
 * V1.4 §25 — Local-Claude monthly debrief batch (Eliott's Max subscription
 * path). EXACT carbon of `weekly-report/batch.ts` adapted to the monthly
 * cadence + the §25 dual-section output.
 *
 * Architecture (mirror V1.7.2) : Eliott refuses to pay for Anthropic API
 * tokens. The monthly debriefs are generated via `claude --print` (headless
 * Claude Code CLI) on Eliott's local Windows machine using his Claude Max
 * subscription. The workflow :
 *
 *   1. Eliott runs `ops/scripts/monthly-batch-local.sh` (1st of the month)
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
 * anchored by a 1 ms step-back before the current month start — robust to a
 * run delayed past the 1st; never `now − 24h`, cf. loader defect-B fix). Pass
 * `true` to preview the in-progress month.
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
    // `Promise.allSettled` preserves order, so `results[i]` ↔ `chunk[i]` — zip
    // them to recover the failing member's id for the observability path below.
    for (let j = 0; j < results.length; j += 1) {
      const res = results[j];
      if (res === undefined) continue;
      if (res.status === 'fulfilled' && res.value !== null) {
        monthStart ??= res.value.monthStart;
        monthEnd ??= res.value.monthEnd;
        entries.push(res.value);
        continue;
      }
      // TASK G-monthly — a REJECTED per-member load (corrupt timezone, transient
      // DB error, etc.) must NOT fail the whole batch, but it must NOT be a
      // SILENT drop either: surface it (Sentry warning + PII-free audit) so an
      // operator can spot a member who is repeatedly missing their debrief.
      // Mirror the module's observability imports + the existing
      // `monthly_debrief.batch.skipped` slug (best-effort PII-minimised:
      // reason = error.message truncated to 200 chars — `error.message` is not
      // guaranteed PII-free, the 200-char truncation is the only safeguard; the
      // read-only surface makes the exposure low. Never the AI text, never a
      // P&L, RGPD §16). A `fulfilled`-with-
      // `null` slice is an intentional drop (suspended / not-found user) and
      // stays silent — only `rejected` is the unexpected failure we report.
      if (res.status === 'rejected') {
        const memberId = chunk[j]?.id ?? null;
        const reason =
          res.reason instanceof Error
            ? res.reason.message.slice(0, 200)
            : String(res.reason).slice(0, 200);
        reportWarning('monthly_debrief.batch', 'member_snapshot_load_failed', {
          userId: memberId,
          reason,
        });
        await logAudit({
          action: 'monthly_debrief.batch.skipped',
          userId: memberId,
          metadata: { ranAt, monthStart: monthStart ?? null, reason },
        });
      }
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

/// The persisted-row shape `toSerializedMonthlyDebrief` accepts — already
/// carries everything the member dispatch needs (`id`, `userId`,
/// `monthStart`, `sentToMemberAt`). The Prisma upsert return is
/// structurally assignable (carbon `service.ts` call-sites).
type PersistedMonthlyDebriefRow = Parameters<typeof toSerializedMonthlyDebrief>[0];

/**
 * V1.4 §25 — notify the member their monthly debrief is ready: enqueue the
 * `monthly_debrief_ready` push + send the member email, then stamp the
 * dispatch state on the row. Best-effort by design: ANY failure (missing
 * user, Resend hiccup, queue error) is swallowed + Sentry-warned — it must
 * NEVER roll back the already-persisted debrief nor fail the batch. Only
 * called when `sentToMemberAt === null` (idempotent, no re-spam in steady
 * state — the J-M2 upsert `update` branch never resets the dispatch cols).
 *
 * ⚠️ Residual at-least-once window (code-reviewer T2-1, accepted at V1
 * 30-member single-admin manual-batch scale — mirrors the weekly canon
 * `weekly-report/service.ts` posture). The order is push → email → stamp.
 * An external email send cannot be transactionally tied to the DB stamp, so
 * if the final stamp `update` throws (e.g. pool exhaustion in the narrow gap
 * after the email returns), `sentToMemberAt` stays null and the next batch
 * re-run re-enters this path → ONE duplicate notification. The duplicate
 * push is benign (the SW coalesces by `tag: type`, replacing the prior
 * notif — see `dispatcher.ts buildPayload`); only a single duplicate email
 * is the real residual, and it is made OBSERVABLE by the distinct
 * `dispatch_stamp_failed` Sentry warning below (not a silent re-spam). A
 * true exactly-once fix (transactional outbox) would also have to touch the
 * weekly pipeline → out of §25 scope, tracked as a V2 decision. "Stamp
 * first" is deliberately NOT used: it would trade this rare dup for silent
 * non-delivery, which is worse for a notify feature.
 */
async function dispatchMonthlyDebriefToMember(row: PersistedMonthlyDebriefRow): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { id: row.userId },
      select: { email: true, firstName: true },
    });
    if (user === null) return;

    const serialized = toSerializedMonthlyDebrief(row);

    const pushId = await enqueueMonthlyDebriefNotification(row.userId, {
      debriefId: row.id,
      monthStart: serialized.monthStart,
    });
    if (pushId === null) {
      // code-reviewer T2-2 — `enqueueMonthlyDebriefNotification` swallows a
      // queue-write failure + returns null (best-effort by design). Without
      // this, a chronically-broken push path stays invisible at 30-member
      // scale. Email still proceeds (the member is notified by at least one
      // channel); the warning lets an operator spot the pattern (mirrors the
      // V1.6 Sentry-taxonomy convention used for `member_dispatch_failed`).
      reportWarning('monthly_debrief.batch', 'push_enqueue_failed', {
        userId: row.userId,
        monthStart: serialized.monthStart,
      });
    }

    const email = await sendMonthlyDebriefReadyEmail({
      to: user.email,
      recipientFirstName: user.firstName,
      debrief: serialized,
    });

    // Dispatch state is the SSOT observability record (SPEC §25.3 — no
    // dedicated email audit slug; `notification.enqueued` covers the push).
    // Isolated try/catch (code-reviewer T2-1): push + email have already
    // fired here, so a lost stamp = a re-notify next run. Surface it as a
    // distinct warning instead of letting it ride the generic outer catch —
    // the residual is documented + accepted at V1 scale, but never silent.
    try {
      await db.monthlyDebrief.update({
        where: { id: row.id },
        data: {
          sentToMemberAt: new Date(),
          sentToMemberEmail: email.delivered ? user.email : null,
          pushEnqueuedAt: pushId !== null ? new Date() : null,
        },
      });
    } catch (stampErr) {
      reportWarning('monthly_debrief.batch', 'dispatch_stamp_failed', {
        userId: row.userId,
        monthStart: serialized.monthStart,
        error: stampErr instanceof Error ? stampErr.message.slice(0, 200) : 'unknown',
      });
    }
  } catch (err) {
    reportWarning('monthly_debrief.batch', 'member_dispatch_failed', {
      userId: row.userId,
      monthStart: serializedMonthStartOf(row),
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }
}

/** PII-free month label for the dispatch-failure warning (no P&L, RGPD §16). */
function serializedMonthStartOf(row: PersistedMonthlyDebriefRow): string {
  return row.monthStart instanceof Date
    ? row.monthStart.toISOString().slice(0, 10)
    : String(row.monthStart);
}

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
    // `monthStart` est la SSOT : on le parse (UTC-midnight `@db.Date`).
    monthStartDb = parseLocalDate(request.monthStart);
    // 🔒 SSOT / anti-tamper (schema.prisma:1372-1374 + SPEC §25.3/§25.7) :
    // `monthEnd` est TOUJOURS service-computed, JAMAIS accepté du client. On
    // RECALCULE le dernier jour civil depuis `monthStart` au lieu de faire
    // confiance à `request.monthEnd` (la route Zod n'en valide que le FORMAT,
    // pas la cohérence). `monthWindowFromMonthStart` dérive 28/29/30/31 sans
    // table de lookup (Date.UTC(y, m, 0), leap-safe). TZ = COHORT_TZ Europe/
    // Paris (canon V1) : le dernier jour CIVIL est TZ-indépendant, et on
    // persiste `parseLocalDate(monthEndLocal)` (UTC-midnight) pour rester
    // parfaitement cohérent avec la façon dont `monthStart` est stocké juste
    // au-dessus. Un `request.monthEnd` incohérent est donc simplement ignoré.
    const window = monthWindowFromMonthStart(request.monthStart, 'Europe/Paris');
    monthEndDb = parseLocalDate(window.monthEndLocal);
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
    // Concatenate every free-text channel the AI can write (both crisis AND
    // AMF gates share this corpus — built once, used twice).
    const amfCorpus = [
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
    const crisisCorpus = amfCorpus;
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

    // Session 4 — AMF output gate (SPEC §2 posture invariant).
    // Scan the SAME corpus for AMF/CIF-regulated content: directional market
    // advice, entry/exit signals, price targets, breakout calls. Any match
    // means the AI output violated the §2 posture and MUST NOT be persisted.
    // `skipped` (not `errors`) — this is a content-policy reject, not a
    // technical failure. Audit + reportWarning (PII-free: labels only).
    const amf = detectAMFViolation(amfCorpus);
    if (amf.suspected) {
      skipped += 1;
      await logAudit({
        action: 'monthly_debrief.batch.amf_violation',
        userId: entry.userId,
        metadata: {
          ranAt,
          monthStart: request.monthStart,
          matchedLabels: amf.matchedLabels,
        },
      });
      reportWarning('monthly_debrief.batch', 'amf_violation_in_ai_output', {
        userId: entry.userId,
        monthStart: request.monthStart,
        matchedLabels: amf.matchedLabels,
      });
      continue;
    }

    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    // Pin the model to the local-Claude sentinel by default; reject any
    // external model name (anti cost-inflation via forged model, mirror
    // weekly code-reviewer Round 16 BLOQUANT 5).
    // S5 Jalon D (D4-02) : inclure les 2 modèles RÉELS du moteur local (pin Opus
    //   4.8 + Fable 5 allowlisté) — sinon `entry.model` était coercé vers le sentinel
    //   local et l'attribution modèle member-facing perdait la vérité. Le calendrier
    //   les inclut déjà ; `pricing.ts` price les deux.
    const PRICING_KEYS = [
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      CLAUDE_CODE_LOCAL_MODEL,
    ];
    const claudeModel =
      entry.model && PRICING_KEYS.includes(entry.model) ? entry.model : CLAUDE_CODE_LOCAL_MODEL;
    const cost = computeCostEur(claudeModel, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheCreateTokens: 0,
    });

    try {
      const persistedRow = await db.monthlyDebrief.upsert({
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

      // V1.4 §25 — member dispatch (push `monthly_debrief_ready` + member
      // email; NO admin monthly email by design, SPEC §25.2). Best-effort,
      // idempotent: decision (g) — the upsert `update` branch does NOT
      // reset `sentToMemberAt`, so on a cron re-run an already-notified
      // member is NEVER re-spammed (carbon weekly J8 TIER 2 HIGH fix). We
      // dispatch only when `sentToMemberAt` is still null (first persist,
      // or a prior persist whose dispatch failed). A push/email hiccup
      // never rolls back the persisted debrief.
      if (persistedRow.sentToMemberAt === null) {
        await dispatchMonthlyDebriefToMember(persistedRow);
      }
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
