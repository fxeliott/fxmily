import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { detectAMFViolation } from '@/lib/safety/amf-detection';
import { enqueueCalendarReadyNotification } from '@/lib/notifications/enqueue';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import {
  adaptiveCalendarOutputSchema,
  type AdaptiveCalendarOutput,
} from '@/lib/schemas/adaptive-calendar';
import {
  weeklyScheduleResponsesSchema,
  type WeeklyScheduleResponses,
} from '@/lib/schemas/weekly-schedule-questionnaire';

import { detectCalendarConflicts, mergeWarnings } from './conflicts';
import { currentParisWeekStart } from './week';
import { loadCalendarSnapshotForUser, persistAdaptiveCalendar } from './service';
import type { CalendarSnapshot } from './snapshot';
import {
  CALENDAR_OUTPUT_JSON_SCHEMA,
  CALENDAR_SYSTEM_PROMPT,
  buildCalendarUserPrompt,
} from './prompt';
import {
  CLAUDE_CODE_LOCAL_MODEL,
  CLAUDE_FABLE_5_LOCAL_MODEL,
  CLAUDE_OPUS_4_8_LOCAL_MODEL,
  computeCostEur,
} from './pricing';

/**
 * §26 Calendrier adaptatif — Local-Claude batch helpers (J-C2). Carbone the
 * STRUCTURE of `lib/weekly-report/batch.ts` (+ `monthly-debrief/batch.ts`),
 * adapted to the calendar cadence + the §26 questionnaire-gated pipeline.
 *
 * Architecture (mirror V1.7.2 weekly / V1.4 monthly) : Eliott refuses to pay
 * for Anthropic API tokens. Calendars are generated via `claude --print`
 * (headless Claude Code CLI, Opus 4.8 §8) on Eliott's local machine using his
 * Claude Max subscription ($0 marginal). The workflow :
 *
 *   1. Eliott runs `ops/scripts/calendar-batch-local.sh` (Monday morning)
 *   2. The script curl-POSTs `/api/admin/calendar-batch/pull` →
 *      {@link loadAllSnapshotsForCalendarGeneration} → pseudonymized snapshots
 *   3. For each member the script invokes `claude --print` with the canonical
 *      §2 system prompt + the snapshot, 60-120s jittered
 *   4. The script curl-POSTs `/api/admin/calendar-batch/persist` →
 *      {@link persistGeneratedCalendars}
 *
 * The 9 ban-risk mitigation rules are identical to the weekly/monthly batch
 * (jittered sleeps, official `claude` binary only, pseudonymized data, system
 * prompt + schema travel WITH the envelope, double-net Zod, active-user
 * re-check, PII-free audit).
 *
 * 🚨 §2 / §21.5 isolation. The snapshot is structurally count-only (pinned by
 * the `CalendarActivityCounts` type + the anti-leak test). The crisis + AMF
 * scans below run on the AI OUTPUT text (the generated plan), never on a P&L
 * (none exists in the pipeline). `profileSummary` (the only member free-text)
 * reaches Claude wrapped in `<member_reflection_untrusted>` (see `prompt.ts`).
 */

// =============================================================================
// Public types — wire contract between Hetzner and the local script
// =============================================================================

/** One member's snapshot ready to be handed to `claude --print`. */
export interface CalendarBatchSnapshotEntry {
  /** Real internal user id. NEVER exposed to Anthropic — kept only so the
   *  local script can route the eventual calendar back to the right row. */
  userId: string;
  /** Pseudonym label (8-char hex) — pre-computed by the loader at the Claude
   *  boundary. Safe to log + include in the prompt. */
  pseudonymLabel: string;
  /** Count-only snapshot (no P&L). Free text (profileSummary) already
   *  sanitized at the snapshot boundary. */
  snapshot: CalendarSnapshot;
  /** Always `true` (the loader only emits members WITH a questionnaire this
   *  week). Kept explicit for the bash contract (skip if false → 0 token). */
  hasQuestionnaire: boolean;
}

/**
 * Envelope returned by the pull route. `systemPrompt` + `outputJsonSchema`
 * ride along so the local script needs no Fxmily TypeScript — `bash | jq |
 * curl | claude --print` is enough.
 */
export interface CalendarBatchPullEnvelope {
  ranAt: string;
  /** Monday (YYYY-MM-DD, Europe/Paris) the calendars are generated FOR. */
  weekStart: string;
  systemPrompt: string;
  outputJsonSchema: unknown;
  entries: CalendarBatchSnapshotEntry[];
}

/**
 * One entry POSTed back from the local script. `output` is the parsed plan; if
 * the local script could not generate a valid one (Claude exit≠0, bad JSON),
 * it sets `error` instead — the persist step skips it + audits, never crashes.
 */
export type CalendarBatchResultEntry =
  | {
      userId: string;
      output: AdaptiveCalendarOutput;
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

export interface CalendarBatchPersistRequest {
  /** YYYY-MM-DD, must match the pull envelope's weekStart. */
  weekStart: string;
  /**
   * ISO instant the snapshots were FROZEN at the pull (the envelope's `ranAt`).
   * The local script echoes it back; the persist stamps each calendar's
   * `generatedAt` with it (vs the persist instant) so a questionnaire re-submitted
   * DURING the minutes-long batch is not silently lost (finding B). Optional —
   * a future-dated or absent value falls back to the persist instant (back-compat
   * with an older local script).
   */
  snapshotTakenAt?: string;
  results: CalendarBatchResultEntry[];
}

export interface CalendarBatchPersistResult {
  persisted: number;
  /** Entries dropped by a server-side gate (forged id, no questionnaire,
   *  invalid output). Distinct from `generationFailures`. */
  skipped: number;
  /** Persist-side failures (the DB write threw). */
  errors: number;
  /** Entries the LOCAL script reported as failed generations (claude exited
   *  non-zero / invalid JSON output). Previously folded into `skipped`, which
   *  under-reported real generation failures on the audit trail. */
  generationFailures: number;
}

// =============================================================================
// Pull side — collect snapshots for members who filled the questionnaire
// =============================================================================

/**
 * Carbon weekly `SNAPSHOT_BATCH_CONCURRENCY` (5). `loadCalendarSnapshotForUser`
 * opens ~5 connections; a chunk of 5 demands up to ~25 vs `db.ts` pool max=10 —
 * Prisma queues the rest, throughput fine at this concurrency, well under the
 * 5s connectionTimeout.
 */
const SNAPSHOT_BATCH_CONCURRENCY = 5;

/**
 * Load the count-only calendar snapshot for every member eligible to receive a
 * generated calendar this week. Pure read; the only side effect is one audit
 * row (`calendar.batch.pulled`).
 *
 * TWO calendar-only filters (the weekly/monthly batches do NOT filter like
 * this — they generate from activity, the calendar generates from intent) :
 *   1. the member submitted a `WeeklyScheduleQuestionnaire` for `weekStart`
 *      (nothing to generate from otherwise — `loadCalendarSnapshotForUser`
 *      returns null without one) ;
 *   2. the member's calendar for `weekStart` is MISSING **or STALE** — c.-à-d.
 *      soit aucun `AdaptiveCalendar` n'existe encore (première génération),
 *      soit le questionnaire a été ré-upserté APRÈS la génération
 *      (`questionnaire.updatedAt > calendar.generatedAt` → le plan est périmé).
 *
 *      ⚠️ DoD#1 (Session 5, defect-D fix) — l'ancien filtre excluait
 *      INCONDITIONNELLEMENT tout membre ayant déjà un calendrier cette semaine.
 *      Conséquence : un membre qui re-remplissait le questionnaire en cours de
 *      semaine (sa dispo a changé : examen / jour off) via « Mettre à jour mes
 *      réponses » voyait son questionnaire ré-upserté MAIS restait filtré au
 *      prochain run → calendrier jamais régénéré, plan périmé toute la semaine,
 *      alors que l'UI promet « C'est noté ». DoD#1 exige que la re-soumission du
 *      questionnaire mette RÉELLEMENT à jour le calendrier. On compare donc la
 *      fraîcheur : un calendrier dont le questionnaire n'a pas bougé depuis la
 *      génération reste EXCLU (pas de re-génération inutile, pas de re-coût
 *      Claude — l'idempotence du happy-path est préservée).
 *
 *      Note de scope — ceci N'EST PAS la décision V2 « édition directe des
 *      blocs du calendrier par le membre » (hors scope ici) : on régénère
 *      depuis le questionnaire ré-soumis, on ne laisse pas le membre éditer le
 *      plan. Le persist (`persistAdaptiveCalendar`) est un UPSERT → il
 *      RÉGÉNÈRE bien la ligne (userId, weekStart) une fois le membre ré-inclus.
 *
 * `weekStart` defaults to the current Europe/Paris week (server-authority via
 * `currentParisWeekStart`, never a client instant — scar PR#96).
 */
export async function loadAllSnapshotsForCalendarGeneration(
  options: { now?: Date; weekStart?: string } = {},
): Promise<CalendarBatchPullEnvelope> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();
  const weekStart = options.weekStart ?? currentParisWeekStart(now);
  const weekStartDb = parseLocalDate(weekStart);

  const [users, questionnaireRows, calendarRows] = await Promise.all([
    db.user.findMany({
      where: { status: 'active' },
      select: { id: true },
      orderBy: { joinedAt: 'asc' },
    }),
    // `updatedAt` (@updatedAt) = instant de la dernière (ré-)soumission du
    // questionnaire → c'est l'horloge de fraîcheur côté intention membre.
    db.weeklyScheduleQuestionnaire.findMany({
      where: { weekStart: weekStartDb },
      select: { userId: true, updatedAt: true },
    }),
    // `generatedAt` (@default(now())) = instant de génération du calendrier →
    // l'horloge de fraîcheur côté plan produit. On le compare à `updatedAt`.
    db.adaptiveCalendar.findMany({
      where: { weekStart: weekStartDb },
      select: { userId: true, generatedAt: true },
    }),
  ]);

  // Map userId → instant de (ré-)soumission du questionnaire.
  const questionnaireUpdatedAt = new Map(questionnaireRows.map((r) => [r.userId, r.updatedAt]));
  // Map userId → instant de génération du calendrier existant (absente = pas
  // de calendrier cette semaine).
  const calendarGeneratedAt = new Map(calendarRows.map((r) => [r.userId, r.generatedAt]));

  // DoD#1 (defect-D) — un membre est candidat s'il a un questionnaire ET que
  // son calendrier est MANQUANT ou PÉRIMÉ. « Périmé » = le questionnaire a été
  // ré-upserté après la génération du calendrier (`updatedAt > generatedAt`).
  // Comparaison sur des `Date` (instants UTC, pas des strings) → robuste aux
  // fuseaux. Égalité stricte `>` : un calendrier généré au même instant (ou
  // après) que la dernière soumission est à jour → reste exclu (idempotence).
  const candidates = users.filter((u) => {
    const qUpdatedAt = questionnaireUpdatedAt.get(u.id);
    if (qUpdatedAt === undefined) return false; // pas de questionnaire → rien à générer
    const calGeneratedAt = calendarGeneratedAt.get(u.id);
    if (calGeneratedAt === undefined) return true; // aucun calendrier → première génération
    return qUpdatedAt.getTime() > calGeneratedAt.getTime(); // calendrier périmé → régénérer
  });

  const entries: CalendarBatchSnapshotEntry[] = [];
  for (let i = 0; i < candidates.length; i += SNAPSHOT_BATCH_CONCURRENCY) {
    const chunk = candidates.slice(i, i + SNAPSHOT_BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (user) => {
        const snapshot = await loadCalendarSnapshotForUser(user.id, weekStart, now);
        // Defensive — questionnaire could vanish between the set build and the
        // per-member read (a delete mid-run). Drop, don't crash the batch.
        if (snapshot === null) return null;
        return {
          userId: user.id,
          pseudonymLabel: snapshot.pseudonymLabel,
          snapshot,
          hasQuestionnaire: true,
        } satisfies CalendarBatchSnapshotEntry;
      }),
    );
    // `Promise.allSettled` preserves order, so `results[j]` ↔ `chunk[j]` — zip
    // them to recover the failing member's id for the observability path below.
    for (let j = 0; j < results.length; j += 1) {
      const res = results[j];
      if (res === undefined) continue;
      if (res.status === 'fulfilled' && res.value !== null) {
        entries.push(res.value);
        continue;
      }
      // A REJECTED per-member snapshot load (corrupt row, transient DB error)
      // must NOT fail the whole batch — but it must NOT be a SILENT drop either:
      // that member silently gets no adaptive calendar this week with nothing to
      // explain why. Surface it (Sentry warning + PII-free audit) so an operator
      // can spot a member repeatedly missing their calendar. Mirror the
      // weekly/monthly debrief batchers. A `fulfilled`-with-`null` slice is an
      // intentional drop (questionnaire vanished mid-run) and stays silent —
      // only `rejected` is the unexpected failure we report. (`reason` =
      // error.message truncated to 200 chars; not guaranteed PII-free, the
      // truncation + read-only surface is the safeguard, never the AI text.)
      if (res.status === 'rejected') {
        const memberId = chunk[j]?.id ?? null;
        const reason =
          res.reason instanceof Error
            ? res.reason.message.slice(0, 200)
            : String(res.reason).slice(0, 200);
        reportWarning('calendar.batch', 'member_snapshot_load_failed', {
          userId: memberId,
          reason,
        });
        await logAudit({
          action: 'calendar.batch.skipped',
          userId: memberId,
          metadata: { ranAt, weekStart, reason },
        });
      }
    }
  }

  await logAudit({
    action: 'calendar.batch.pulled',
    metadata: {
      ranAt,
      entriesCount: entries.length,
      weekStart,
    },
  });

  return {
    ranAt,
    weekStart,
    systemPrompt: CALENDAR_SYSTEM_PROMPT,
    outputJsonSchema: CALENDAR_OUTPUT_JSON_SCHEMA,
    entries,
  };
}

/**
 * Convenience for the local script / Live path — build the per-member user
 * prompt from the snapshot (same logic the Live client uses internally).
 */
export function buildCalendarBatchUserPrompt(entry: CalendarBatchSnapshotEntry): string {
  return buildCalendarUserPrompt(entry.snapshot);
}

// =============================================================================
// Persist side — accept Claude-generated calendars + write to DB
// =============================================================================

/**
 * Compose the full AI-output text corpus for the crisis + AMF posture scans.
 * Concatenates EVERY member-facing free-text field — overview, weeklyFocus,
 * warnings, each day's `dayLabel`, and every block `label`. §2 is BLOQUANT, so
 * a market-advice or distress signal must be caught wherever it lands, not
 * just in `warnings`.
 */
function composeCalendarOutputCorpus(output: AdaptiveCalendarOutput): string {
  const parts: string[] = [output.overview, output.weeklyFocus, ...output.warnings];
  for (const day of output.days) {
    parts.push(day.dayLabel);
    for (const block of day.blocks) {
      parts.push(block.label);
    }
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * Validate + persist a batch of locally-generated calendars. Idempotent on
 * `(userId, weekStart)` (upsert via `persistAdaptiveCalendar`). Carbon weekly
 * `persistGeneratedReports` + monthly `persistGeneratedReports`.
 *
 * Gates, in order (per entry) :
 *   0.  explicit `error` field (claude --print failure) → skip + audit
 *   1.  week window parses via `parseLocalDate` → else invalid_week_window (whole batch)
 *   2.  active-user Set → unknown_or_inactive_user (anti forged userId)
 *   3.  a `WeeklyScheduleQuestionnaire` exists for (userId, weekStart) → else skip
 *   4.  `adaptiveCalendarOutputSchema.safeParse` → invalid_output
 *   5.  `detectCrisis` on the AI output → skip + Sentry on HIGH/MEDIUM (mirror V1.7.1)
 *   5b. `detectAMFViolation` (§2 posture) on the AI output → skip + audit + Sentry
 *   6.  `persistAdaptiveCalendar` (derives primaryCategory) → persisted
 *
 * Never throws on a single bad entry — counts and moves on. Audit rows are
 * PII-free (counts + weekStart + canonical labels only, RGPD §16).
 */
export async function persistGeneratedCalendars(
  request: CalendarBatchPersistRequest,
): Promise<CalendarBatchPersistResult> {
  const persistInstant = new Date();
  const ranAt = persistInstant.toISOString();

  // Finding B — resolve the freshness clock for every calendar in this batch.
  // `snapshotTakenAt` (the pull `ranAt`) is the instant the data was frozen.
  // Trust it ONLY if it parses AND is not in the future: a future value (clock
  // skew / forged) would stamp the calendar perpetually-fresh and exclude the
  // member from every future regeneration → clamp to the persist instant. Absent
  // / invalid → undefined → `persistAdaptiveCalendar` falls back to `new Date()`
  // (prior behaviour, back-compat with an older local script).
  let snapshotGeneratedAt: Date | undefined;
  if (request.snapshotTakenAt) {
    const parsed = new Date(request.snapshotTakenAt);
    if (!Number.isNaN(parsed.getTime())) {
      snapshotGeneratedAt = parsed.getTime() > persistInstant.getTime() ? persistInstant : parsed;
    }
  }

  // Gate 1 — week window parses (whole-batch guard).
  let weekStartDb: Date;
  try {
    weekStartDb = parseLocalDate(request.weekStart);
  } catch (err) {
    await logAudit({
      action: 'calendar.batch.invalid_output',
      metadata: {
        ranAt,
        weekStart: request.weekStart,
        reason: 'invalid_week_window',
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    return { persisted: 0, skipped: 0, errors: request.results.length, generationFailures: 0 };
  }

  // Gate 2 prep — active users (forged-id defense, mirror weekly BLOCKER 4).
  const activeUserIds = new Set(
    (
      await db.user.findMany({
        where: { status: 'active' },
        select: { id: true },
      })
    ).map((u) => u.id),
  );

  // Gate 3 prep — questionnaires for this week → userId → instrumentVersion.
  // The instrument version traces which questionnaire fed the calendar.
  // S6 §32-1 — also pull the closed `responses` so the deterministic conflict
  // detector (`detectCalendarConflicts`) can compare the member's DECLARED
  // availability/commitments against the GENERATED plan at persist time. The
  // batch result entry carries only `output` (no snapshot — `CalendarBatchResultEntry`),
  // so the responses are re-read server-side here (§2-safe: closed answers, 0 P&L).
  const questionnaireRows = await db.weeklyScheduleQuestionnaire.findMany({
    where: { weekStart: weekStartDb },
    select: { userId: true, instrumentVersion: true, responses: true },
  });
  const instrumentVersionByUser = new Map(
    questionnaireRows.map((r) => [r.userId, r.instrumentVersion]),
  );
  const responsesByUser = new Map<string, WeeklyScheduleResponses>();
  for (const row of questionnaireRows) {
    const parsedResponses = weeklyScheduleResponsesSchema.safeParse(row.responses);
    if (parsedResponses.success) responsesByUser.set(row.userId, parsedResponses.data);
  }

  let persisted = 0;
  let skipped = 0;
  let errors = 0;
  let generationFailures = 0;

  for (const entry of request.results) {
    if ('error' in entry) {
      // The local script could not GENERATE this member's calendar (claude
      // exit / invalid JSON). Count it as a generation failure, not a benign
      // skip — the audit under-reported real failures otherwise.
      generationFailures += 1;
      await logAudit({
        action: 'calendar.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          reason: entry.error.slice(0, 200),
        },
      });
      continue;
    }

    // Gate 2 — forged / inactive userId.
    if (!activeUserIds.has(entry.userId)) {
      skipped += 1;
      await logAudit({
        action: 'calendar.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, weekStart: request.weekStart, reason: 'unknown_or_inactive_user' },
      });
      continue;
    }

    // Gate 3 — questionnaire must exist for (userId, weekStart). CALENDAR-ONLY
    // gate (no weekly/monthly analog — those generate from activity).
    const instrumentVersion = instrumentVersionByUser.get(entry.userId);
    if (instrumentVersion === undefined) {
      skipped += 1;
      await logAudit({
        action: 'calendar.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, weekStart: request.weekStart, reason: 'no_questionnaire' },
      });
      continue;
    }

    // Gate 4 — double-net Zod validation (even if the local script claims it
    // validated). `.strict()` rejects hallucinated keys; `safeFreeText`
    // transforms strip bidi/zero-width from the AI output.
    const parsed = adaptiveCalendarOutputSchema.safeParse(entry.output);
    if (!parsed.success) {
      errors += 1;
      await logAudit({
        action: 'calendar.batch.invalid_output',
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

    // Gate 4b — date integrity (Session 5, defect-#6 fix). The 7 day dates are
    // a SERVER ground-truth (weekStart + 0..6), NOT a value the LLM should
    // decide. The Zod schema only validates the FORMAT (YYYY-MM-DD), so a model
    // drift (off-by-one, wrong month/year, duplicate) would persist well-formed
    // but WRONG dates — and the daily-guidance panel ("Ton aujourd'hui",
    // `days.find((d) => d.date === today)`) would silently render "Journée
    // libre" every day while the row exists. Close it deterministically :
    //   - a whole-week drift (`output.weekStart !== request.weekStart`) is a
    //     gross error (the prose targets another week) → skip + audit ; the
    //     overdue-alert (cron.calendar_overdue) will surface it for a re-run.
    //   - otherwise re-anchor each day's date by index to the canonical
    //     `weekStart + i` (mirrors the Mock client's `addDaysIso`), so the
    //     calendar is ALWAYS consumable even if the model fumbled a date.
    if (output.weekStart !== request.weekStart) {
      skipped += 1;
      await logAudit({
        action: 'calendar.batch.invalid_output',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          reason: 'week_misalignment',
          outputWeekStart: output.weekStart,
        },
      });
      reportWarning('calendar.batch', 'week_misalignment_in_ai_output', {
        userId: entry.userId,
        weekStart: request.weekStart,
        outputWeekStart: output.weekStart,
      });
      continue;
    }

    const datesDrifted = output.days.some(
      (day, i) => day.date !== shiftLocalDate(request.weekStart, i),
    );
    const aligned = datesDrifted
      ? {
          ...output,
          days: output.days.map((day, i) => ({
            ...day,
            date: shiftLocalDate(request.weekStart, i),
          })),
        }
      : output;
    if (datesDrifted) {
      // Observability — the calendar is still persisted (re-anchored), but we
      // flag that the model fumbled the deterministic dates so the prompt can
      // be tightened if it recurs. PII-free (counts/labels only, no member text).
      reportWarning('calendar.batch', 'day_dates_realigned', {
        userId: entry.userId,
        weekStart: request.weekStart,
      });
    }

    // S6 §32-1 — fold DETERMINISTIC conflicts into the `warnings[]` channel
    // before the crisis/AMF scan + persist. The detector is pure; the merge is
    // capped at 3 (model warnings kept after the factual conflicts). The merged
    // output is NOT covered by the Gate-4 parse (that ran on `entry.output`), so
    // re-parse defensively — a conflict >200c or a 4th warning would otherwise
    // reach the DB. On the (impossible-by-construction) re-parse failure, fall
    // back to `aligned`: a warning enrichment must NEVER break the persist.
    const responses = responsesByUser.get(entry.userId);
    let finalOutput = aligned;
    if (responses) {
      const conflicts = detectCalendarConflicts(responses, aligned);
      if (conflicts.length > 0) {
        const candidate = { ...aligned, warnings: mergeWarnings(aligned.warnings, conflicts) };
        const reparsed = adaptiveCalendarOutputSchema.safeParse(candidate);
        finalOutput = reparsed.success ? reparsed.data : aligned;
      }
    }

    const corpus = composeCalendarOutputCorpus(finalOutput);

    // Gate 5 — crisis routing on the AI OUTPUT (mirror V1.7.1). This is the
    // OUTPUT-IA skip path (NOT the REFLECT persist-anyway path): nothing here
    // is member-written, so a HIGH/MEDIUM signal halts the persist + escalates.
    const crisis = detectCrisis(corpus);
    if (crisis.level === 'high' || crisis.level === 'medium') {
      skipped += 1;
      await logAudit({
        action: 'calendar.batch.crisis_detected',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          level: crisis.level,
          matchedLabels: crisis.matches.map((m) => m.label),
        },
      });
      if (crisis.level === 'high') {
        reportError(
          'calendar.batch',
          new Error(
            `crisis_signal_high_in_ai_output: ${crisis.matches.map((m) => m.label).join(',')}`,
          ),
          { userId: entry.userId, weekStart: request.weekStart },
        );
      } else {
        reportWarning('calendar.batch', 'crisis_signal_medium_in_ai_output', {
          userId: entry.userId,
          weekStart: request.weekStart,
          matchedLabels: crisis.matches.map((m) => m.label),
        });
      }
      continue;
    }

    // Gate 5b — §2 posture (AMF/CIF market-advice language) on the AI output.
    // Carbon of the AMF-regex layer of `onboarding-interview/safety.ts`
    // `runSafetyGate` (NOT the anti-clinical nor evidence-substring layers —
    // those are onboarding-only). A calendar must organise TIME, never carry a
    // directional/level/forecast call. Reject → skip + dedicated audit slug +
    // Sentry warning (a posture breach is a security signal, not a crisis).
    const amf = detectAMFViolation(corpus);
    if (amf.suspected) {
      skipped += 1;
      await logAudit({
        action: 'calendar.batch.amf_violation',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          matchedLabels: amf.matchedLabels,
        },
      });
      reportWarning('calendar.batch', 'amf_violation_in_ai_output', {
        userId: entry.userId,
        weekStart: request.weekStart,
        matchedLabels: amf.matchedLabels,
      });
      continue;
    }

    // Gate 6 — model allowlist + persist. Pin the model to the local-Claude
    // sentinel by default; accept only known-priced names (anti cost-inflation
    // via a forged model name, mirror weekly BLOQUANT 5). The local batch
    // persists at $0 either way (Max subscription).
    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const PRICING_KEYS: string[] = [
      CLAUDE_FABLE_5_LOCAL_MODEL,
      CLAUDE_OPUS_4_8_LOCAL_MODEL,
      'claude-sonnet-4-6',
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
      await persistAdaptiveCalendar({
        userId: entry.userId,
        weekStart: request.weekStart,
        output: finalOutput,
        claudeModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costEur: cost.costEur,
        calendarInstrumentVersion: instrumentVersion,
        // Finding B — freshness clock = the snapshot instant (when supplied),
        // so a re-submit racing this persist re-includes the member next run.
        ...(snapshotGeneratedAt ? { generatedAt: snapshotGeneratedAt } : {}),
      });
      persisted += 1;

      // J2 §7.10 — "ton calendrier de la semaine est prêt" notification. Only
      // on a SUCCESSFUL persist, and strictly best-effort: an enqueue failure
      // (DB hiccup, queue contention) must NEVER fail the calendar generation
      // that already committed. enqueueCalendarReadyNotification is itself a
      // simple insert (no dedup) — the try/catch here is a second belt so a
      // throw can't leak into the batch loop and mark a persisted calendar as
      // an error. J9 web-push dispatches the queued row later.
      try {
        await enqueueCalendarReadyNotification(entry.userId, { weekStart: request.weekStart });
      } catch (notifyErr) {
        reportWarning('calendar.batch', 'calendar_ready_enqueue_failed', {
          userId: entry.userId,
          weekStart: request.weekStart,
          error: notifyErr instanceof Error ? notifyErr.message.slice(0, 200) : 'unknown',
        });
      }
    } catch (err) {
      errors += 1;
      await logAudit({
        action: 'calendar.batch.persist_failed',
        userId: entry.userId,
        metadata: {
          ranAt,
          weekStart: request.weekStart,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      });
    }
  }

  // Never-sink: a batch whose generations failed must be ops-visible, not
  // just a number in an audit row nobody greps.
  if (generationFailures > 0) {
    reportWarning('calendar.batch', 'generation_failures', {
      weekStart: request.weekStart,
      generationFailures,
      total: request.results.length,
    });
  }

  await logAudit({
    action: 'calendar.batch.persisted',
    metadata: {
      ranAt,
      weekStart: request.weekStart,
      persisted,
      skipped,
      errors,
      generationFailures,
      total: request.results.length,
    },
  });

  return { persisted, skipped, errors, generationFailures };
}
