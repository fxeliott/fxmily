import 'server-only';

import { Prisma } from '@/generated/prisma/client';

import { logAudit } from '@/lib/auth/audit';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { sendWeeklyDigestEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import {
  weeklyReportOutputSchema,
  weeklySnapshotSchema,
  type WeeklyReportOutput,
} from '@/lib/schemas/weekly-report';

import { buildWeeklySnapshot } from './builder';
import { getWeeklyReportClient, type WeeklyReportGeneration } from './claude-client';
import { loadWeeklySliceForUser } from './loader';
import type { SerializedWeeklyReport } from './types';
import type { WeekWindow } from './week-window';

export type { SerializedWeeklyReport } from './types';

/**
 * Phase B+C orchestrator — turn a member's 7-day slice into a persisted
 * {@link WeeklyReportOutput} via Claude and (optionally) email it to the admin.
 *
 * Path :
 *   loader → builder → claude-client → DB upsert → email (best-effort)
 *
 * Idempotency : `(userId, weekStart)` is unique on `weekly_reports`, so a
 * second run for the same week **upserts** rather than stacking duplicates.
 * The email dispatch state is tracked separately (`sentToAdminAt`) so the
 * cron can re-send a digest if Resend rejected the first attempt.
 */

// =============================================================================
// Public types
// =============================================================================

export interface GenerateOptions {
  /// `now` reference (cron pass-through). Defaults to `new Date()`.
  now?: Date;
  /// `false` (default) → current local-week. `true` → previous full local-week.
  previousFullWeek?: boolean;
  /// `true` → skip the email send (smoke testing). DB write still happens.
  skipEmail?: boolean;
  /// Override the recipient. Defaults to `WEEKLY_REPORT_RECIPIENT` env (or
  /// `eliott.pena@icloud.com` per SPEC §20.6).
  recipientOverride?: string;
}

export type EmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_attempted';

export interface GenerateResult {
  status: 'generated' | 'skipped_inactive' | 'skipped_no_user';
  report?: SerializedWeeklyReport;
  /** True if the underlying Claude path was the mock (no API call). */
  mocked?: boolean;
  /** Outcome of the email step — distinguishes skipped (no API key / already-sent) from failed (Resend error). */
  emailOutcome?: EmailOutcome;
  /** Resend message id when delivered. */
  emailMessageId?: string | null;
}

// =============================================================================
// Single-member orchestrator
// =============================================================================

export async function generateWeeklyReportForUser(
  userId: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const slice = await loadWeeklySliceForUser(userId, {
    ...(options.now !== undefined ? { now: options.now } : {}),
    previousFullWeek: options.previousFullWeek ?? false,
  });
  if (slice === null) {
    return { status: 'skipped_inactive' };
  }

  const snapshot = buildWeeklySnapshot(slice.builderInput);
  // Validate via Zod — defense-in-depth, the snapshot may be reused later.
  const validatedSnapshot = weeklySnapshotSchema.parse(snapshot);

  const client = getWeeklyReportClient();
  const generation = await client.generate(validatedSnapshot);

  // Persist (upsert on (userId, weekStart) unique).
  const persisted = await persistReport(slice.window, userId, generation);

  // Email — best-effort, never throws back into the cron loop.
  const emailOutcome = await maybeSendEmail(persisted, options);

  // Audit row — keep PII-free (counts only).
  await logAudit({
    action: 'weekly_report.generated',
    userId,
    metadata: {
      reportId: persisted.id,
      weekStart: persisted.weekStart,
      mocked: generation.mocked,
      inputTokens: generation.usage.inputTokens,
      outputTokens: generation.usage.outputTokens,
      costEur: persisted.costEur,
      emailOutcome: emailOutcome.outcome,
    },
  });

  return {
    status: 'generated',
    report: persisted,
    mocked: generation.mocked,
    emailOutcome: emailOutcome.outcome,
    emailMessageId: emailOutcome.messageId,
  };
}

// =============================================================================
// Cron batch wrapper
// =============================================================================

export interface GenerateBatchResult {
  /** ISO instant of the cron run. */
  ranAt: string;
  /** Total active members scanned. */
  scanned: number;
  /** Reports persisted in this run. */
  generated: number;
  /** Reports the cron skipped (user no longer active or missing). */
  skipped: number;
  /** Errors that bubbled out of `generateWeeklyReportForUser`. */
  errors: number;
  /** Emails delivered successfully (subset of `generated`). */
  emailsDelivered: number;
  /** Emails that failed at the Resend layer (subset of `generated`). */
  emailsFailed: number;
  /** Emails skipped (already-sent for this week, OR Resend dev fallback / no API key). */
  emailsSkipped: number;
  /** Number of members served from the mock client (no API call). */
  mocked: number;
  /** Total EUR cost (sum of per-user `cost_eur`). */
  totalCostEur: string;
}

/**
 * Run the weekly-report pipeline for every `active` member in batches of 5.
 *
 * Concurrency : 5-by-5. Lower than scoring (25-by-25) because each generation
 * may hit the Anthropic API (live) or run a non-trivial DB load (~6 queries).
 * Generous failure isolation : `Promise.allSettled` per batch so a single
 * member error doesn't fail the whole cron run.
 */
export async function generateWeeklyReportsForAllActiveMembers(
  options: GenerateOptions = {},
): Promise<GenerateBatchResult> {
  const ranAt = (options.now ?? new Date()).toISOString();
  const batchSize = 5;

  const users = await db.user.findMany({
    where: { status: 'active' },
    select: { id: true },
    orderBy: { joinedAt: 'asc' },
  });

  let generated = 0;
  let skipped = 0;
  let errors = 0;
  let emailsDelivered = 0;
  let emailsFailed = 0;
  let emailsSkipped = 0;
  let mocked = 0;
  let totalCostCents = 0; // accumulate in EUR cents to avoid float drift

  for (let i = 0; i < users.length; i += batchSize) {
    const slice = users.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      slice.map((u) => generateWeeklyReportForUser(u.id, options)),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        const value = r.value;
        if (value.status === 'generated' && value.report) {
          generated += 1;
          if (value.mocked) mocked += 1;
          // Counter classification — distinguishes Resend rejection (`failed`)
          // from the dev-fallback / already-sent (`skipped`) path so the cron
          // dashboard doesn't yell "6 failures" when it's just "no API key
          // configured" (audit trail confirms via `weekly_report.email.skipped`).
          switch (value.emailOutcome) {
            case 'sent':
              emailsDelivered += 1;
              break;
            case 'failed':
              emailsFailed += 1;
              break;
            case 'skipped':
              emailsSkipped += 1;
              break;
            case 'not_attempted':
            case undefined:
              // skipEmail=true OR generation status unknown — don't count.
              break;
          }
          // 6-decimal EUR → 8-decimal "cents" arithmetic via integer math.
          totalCostCents += Math.round(Number(value.report.costEur) * 1_000_000);
        } else {
          skipped += 1;
        }
      } else {
        errors += 1;
        console.error('[weekly-report] member generation failed:', r.reason);
      }
    }
  }

  return {
    ranAt,
    scanned: users.length,
    generated,
    skipped,
    errors,
    emailsDelivered,
    emailsFailed,
    emailsSkipped,
    mocked,
    totalCostEur: (totalCostCents / 1_000_000).toFixed(6),
  };
}

// =============================================================================
// Read helpers (admin UI)
// =============================================================================

export interface ListReportsOptions {
  userId?: string;
  /// Pagination cursor — `id` of the report to fetch after.
  cursor?: string;
  /// 1–50, default 30.
  limit?: number;
}

export interface ListReportsResult {
  items: SerializedWeeklyReport[];
  nextCursor: string | null;
}

export async function listReportsForAdmin(
  options: ListReportsOptions = {},
): Promise<ListReportsResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 30));

  const where: Prisma.WeeklyReportWhereInput = {};
  if (options.userId) where.userId = options.userId;

  const rows = await db.weeklyReport.findMany({
    where,
    orderBy: [{ weekStart: 'desc' }, { generatedAt: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(serialize);
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export async function getReportByIdForAdmin(id: string): Promise<SerializedWeeklyReport | null> {
  const row = await db.weeklyReport.findUnique({ where: { id } });
  return row === null ? null : serialize(row);
}

export interface AdminReportStats {
  totalReports: number;
  totalCostEur: string;
  emailsDelivered: number;
  emailsPending: number;
  /** Date of the most recent report across the cohort, ISO YYYY-MM-DD. */
  lastWeekStart: string | null;
  /** Distinct active members covered by the most recent week. */
  membersInLastWeek: number;
}

export async function getReportStatsForAdmin(): Promise<AdminReportStats> {
  const all = await db.weeklyReport.findMany({
    select: {
      id: true,
      weekStart: true,
      sentToAdminAt: true,
      costEur: true,
      userId: true,
    },
    orderBy: { weekStart: 'desc' },
  });
  const lastWeekStart = all[0]?.weekStart.toISOString().slice(0, 10) ?? null;
  const membersInLastWeek = lastWeekStart
    ? new Set(
        all
          .filter((r) => r.weekStart.toISOString().slice(0, 10) === lastWeekStart)
          .map((r) => r.userId),
      ).size
    : 0;
  const totalCostCents = all.reduce(
    (acc, r) => acc + Math.round(Number(r.costEur.toString()) * 1_000_000),
    0,
  );
  return {
    totalReports: all.length,
    totalCostEur: (totalCostCents / 1_000_000).toFixed(6),
    emailsDelivered: all.filter((r) => r.sentToAdminAt !== null).length,
    emailsPending: all.filter((r) => r.sentToAdminAt === null).length,
    lastWeekStart,
    membersInLastWeek,
  };
}

export async function listReportsForMember(
  userId: string,
  limit = 12,
): Promise<SerializedWeeklyReport[]> {
  const rows = await db.weeklyReport.findMany({
    where: { userId },
    orderBy: [{ weekStart: 'desc' }],
    take: Math.min(50, Math.max(1, limit)),
  });
  return rows.map(serialize);
}

// =============================================================================
// Internals
// =============================================================================

async function persistReport(
  window: WeekWindow,
  userId: string,
  generation: WeeklyReportGeneration,
): Promise<SerializedWeeklyReport> {
  const { output, usage, model, cost } = generation;

  // BLOCKER fix (J8 audit) — Postgres `@db.Date` extracts the **UTC date** from a
  // JS Date; using `weekStartUtc` (= local-Mon-00:00 in UTC) drifts by 1 day for
  // any non-UTC timezone (e.g. Europe/Paris CEST → 2026-05-04 local Monday lands
  // at 2026-05-03T22:00:00Z, which Postgres truncates to 2026-05-03 = Sunday).
  // The canonical pattern (mirrors `lib/checkin/service.ts` + `parseLocalDate`)
  // is to write the UTC midnight of the local-day string. Idempotency unique
  // (userId, weekStart) lines up correctly across all TZs this way.
  const weekStartDb = parseLocalDate(window.weekStartLocal);
  const weekEndDb = parseLocalDate(window.weekEndLocal);

  // Use upsert on the unique (userId, weekStart) so a re-run replaces the
  // prior write rather than throwing on P2002.
  const row = await db.weeklyReport.upsert({
    where: {
      userId_weekStart: {
        userId,
        weekStart: weekStartDb,
      },
    },
    create: {
      userId,
      weekStart: weekStartDb,
      weekEnd: weekEndDb,
      summary: output.summary,
      risks: output.risks as Prisma.InputJsonValue,
      recommendations: output.recommendations as Prisma.InputJsonValue,
      patterns: (output.patterns ?? {}) as Prisma.InputJsonValue,
      claudeModel: model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreateTokens: usage.cacheCreateTokens,
      costEur: new Prisma.Decimal(cost.costEur),
    },
    update: {
      weekEnd: weekEndDb,
      summary: output.summary,
      risks: output.risks as Prisma.InputJsonValue,
      recommendations: output.recommendations as Prisma.InputJsonValue,
      patterns: (output.patterns ?? {}) as Prisma.InputJsonValue,
      claudeModel: model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreateTokens: usage.cacheCreateTokens,
      costEur: new Prisma.Decimal(cost.costEur),
      generatedAt: new Date(),
      // J8 audit fix — do NOT reset email dispatch state on re-generation.
      // The cron token-bucket allows 5 burst calls and Resend free-tier is
      // 100/day ; resetting `sentToAdminAt` would re-send a digest every
      // re-run for the same week, blowing the quota on a 30-member cohort
      // after a few smoke tests. `maybeSendEmail` short-circuits when
      // `sentToAdminAt` is already set, so the cron's idempotent upsert
      // path is now genuinely idempotent end-to-end (DB + email). To force
      // a re-send, manually clear the columns or use a future Server
      // Action `re-send weekly digest` (J8.5+).
    },
  });

  return serialize(row);
}

async function maybeSendEmail(
  report: SerializedWeeklyReport,
  options: GenerateOptions,
): Promise<{ outcome: EmailOutcome; messageId: string | null }> {
  if (options.skipEmail) return { outcome: 'not_attempted', messageId: null };

  // J8 audit fix — short-circuit if the digest has already been delivered
  // for this (userId, weekStart). Pairs with the upsert path that no longer
  // resets `sentToAdminAt` on re-generation. Forcing a re-send means
  // manually clearing the column.
  if (report.sentToAdminAt !== null && report.emailMessageId !== null) {
    return { outcome: 'skipped', messageId: report.emailMessageId };
  }

  const recipient = resolveRecipient(options);
  let user: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  try {
    user = await db.user.findUnique({
      where: { id: report.userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  } catch (err) {
    console.error('[weekly-report] failed to read user metadata for email', err);
    user = null;
  }

  const memberLabel = displayMemberLabel(user);

  try {
    const result = await sendWeeklyDigestEmail({
      to: recipient,
      memberLabel,
      report,
    });
    if (result.delivered) {
      const messageId = result.id;
      await db.weeklyReport.update({
        where: { id: report.id },
        data: {
          sentToAdminAt: new Date(),
          sentToAdminEmail: recipient,
          emailMessageId: messageId,
        },
      });
      await logAudit({
        action: 'weekly_report.email.sent',
        userId: report.userId,
        metadata: { reportId: report.id, recipient, messageId },
      });
      return { outcome: 'sent', messageId };
    }
    // J8 audit fix — Resend dev-fallback path (no `RESEND_API_KEY`). Emit a
    // dedicated audit row so admins can distinguish "no key" from "Resend
    // rejected" in the audit timeline (the prior code silently returned).
    await logAudit({
      action: 'weekly_report.email.skipped',
      userId: report.userId,
      metadata: { reportId: report.id, recipient, reason: 'no_api_key_dev_fallback' },
    });
    return { outcome: 'skipped', messageId: null };
  } catch (err) {
    await logAudit({
      action: 'weekly_report.email.failed',
      userId: report.userId,
      metadata: {
        reportId: report.id,
        recipient,
        error: err instanceof Error ? err.message : 'unknown',
      },
    });
    console.error('[weekly-report] email delivery failed', err);
    return { outcome: 'failed', messageId: null };
  }
}

function resolveRecipient(options: GenerateOptions): string {
  // J8 audit fix — `recipientOverride` is honored ONLY when not running in
  // production (gate identical to `?at=ISO` in the cron route). Even if a
  // future caller forwards an arbitrary recipient through `GenerateOptions`,
  // the prod runtime falls back to `WEEKLY_REPORT_RECIPIENT` env / default,
  // closing the data-exfiltration vector flagged by the security review.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  if (options.recipientOverride && !isProdRuntime) return options.recipientOverride;
  return env.WEEKLY_REPORT_RECIPIENT ?? 'eliott.pena@icloud.com';
}

function displayMemberLabel(
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null,
): string {
  if (!user) return 'Membre';
  const first = user.firstName?.trim();
  const last = user.lastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  // J8 audit fix — fall back to a stable opaque short id rather than the raw
  // email. Email subjects propagate through MTA logs / sieve filters /
  // archives ; surfacing the address there is an unnecessary widening of the
  // PII blast radius for a member who simply hasn't filled their profile.
  return `Membre #${user.id.slice(-6)}`;
}

function serialize(row: {
  id: string;
  userId: string;
  weekStart: Date;
  weekEnd: Date;
  generatedAt: Date;
  summary: string;
  risks: Prisma.JsonValue;
  recommendations: Prisma.JsonValue;
  patterns: Prisma.JsonValue;
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costEur: Prisma.Decimal;
  sentToAdminAt: Date | null;
  sentToAdminEmail: string | null;
  emailMessageId: string | null;
}): SerializedWeeklyReport {
  return {
    id: row.id,
    userId: row.userId,
    weekStart: row.weekStart.toISOString().slice(0, 10),
    weekEnd: row.weekEnd.toISOString().slice(0, 10),
    generatedAt: row.generatedAt.toISOString(),
    summary: row.summary,
    risks: parseStringArray(row.risks),
    recommendations: parseStringArray(row.recommendations),
    patterns: parsePatterns(row.patterns),
    claudeModel: row.claudeModel,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreateTokens: row.cacheCreateTokens,
    costEur: row.costEur.toString(),
    sentToAdminAt: row.sentToAdminAt ? row.sentToAdminAt.toISOString() : null,
    sentToAdminEmail: row.sentToAdminEmail,
    emailMessageId: row.emailMessageId,
  };
}

function parseStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function parsePatterns(value: Prisma.JsonValue): WeeklyReportOutput['patterns'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: WeeklyReportOutput['patterns'] = {};
  const obj = value as Record<string, unknown>;
  if (typeof obj.emotionPerf === 'string') out.emotionPerf = obj.emotionPerf;
  if (typeof obj.sleepPerf === 'string') out.sleepPerf = obj.sleepPerf;
  if (typeof obj.sessionFocus === 'string') out.sessionFocus = obj.sessionFocus;
  if (typeof obj.disciplineTrend === 'string') out.disciplineTrend = obj.disciplineTrend;
  return out;
}

// Defensive : ensure at least one weeklyReportOutputSchema reference is kept
// so tree-shakers don't drop it from the bundle. The DB write goes through
// the Claude client which validates already, but the schema also lives here
// so admin-side rendering can re-validate.
export const _DOUBLE_NET_OUTPUT_SCHEMA = weeklyReportOutputSchema;
