import 'server-only';

import { parseLocalDate, shiftLocalDate, type LocalDateString } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { safeFreeText } from '@/lib/text/safe';

import { deriveSeanceTitle, type SeanceSlot, type SeanceStatus } from './derive';
import { activeMemberCount, countViewersForSessions } from './replay-views';
import {
  ADMIN_SEANCE_HORIZON_DAYS,
  ADMIN_SEANCE_PAST_DAYS,
  derivePipelineStatus,
  futureSeanceCells,
  normalizeSeanceTime,
  planSeanceGoNoGo,
  seanceCellTime,
  seanceCellTitle,
  seanceToday,
  type GoNoGoRejectReason,
  type PipelineBadge,
  type PipelineStep,
} from './admin-derive';

/**
 * Réunion hub (séances) ADMIN service (J3) — the DB-aware write + read surface
 * of `/admin/seances`. The go/no-go authority: Eliott declares, per `(date,
 * slot)`, whether a session is `scheduled` / `done` / `cancelled`. The
 * load-bearing FSM lives in the pure `admin-derive.planSeanceGoNoGo`; this module
 * only loads the row, applies the plan, and writes (mirror `lib/meeting/service`
 * cancel/uncancel — findUnique-guard → update, fail-loud on a bad transition).
 *
 * Posture §2 / Règle n°1: writes `status` + the admin-owned `time`/`cancelReason`
 * only — never editorial content (that is the faithful J4 pipeline's job). 0 FK
 * to User → no member PII is ever touched here.
 */

// ── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when a go/no-go declaration violates an FSM guard (backfill/no-rewind). */
export class SeanceGoNoGoError extends Error {
  readonly reason: GoNoGoRejectReason;
  constructor(reason: GoNoGoRejectReason) {
    super(`Séance go/no-go refused: ${reason}`);
    this.name = 'SeanceGoNoGoError';
    this.reason = reason;
  }
}

/** Thrown when a regenerate targets a missing or non-`done` session. */
export type SeanceRegenerateReason = 'not_found' | 'not_done';
export class SeanceRegenerateError extends Error {
  readonly reason: SeanceRegenerateReason;
  constructor(reason: SeanceRegenerateReason) {
    super(`Séance regenerate refused: ${reason}`);
    this.name = 'SeanceRegenerateError';
    this.reason = reason;
  }
}

// ── Views (flat + serialisable — never leak a raw Prisma object to a client) ──

export interface AdminPipelineView {
  steps: PipelineStep[];
  badge: PipelineBadge;
  hasData: boolean;
  deadLetter: boolean;
  failedStep: string | null;
  failedError: string | null;
  /** ISO of the last J4 pipeline sync, or null (never synced). */
  syncedAt: string | null;
}

/** One `(date, slot)` cell of the admin calendar (existing row OR placeholder). */
export interface AdminSeanceCell {
  date: LocalDateString;
  slot: SeanceSlot;
  /** True when a `ReplaySession` row exists (else a declarable placeholder). */
  exists: boolean;
  /** Persisted status, or 'undeclared' when no row exists. */
  status: SeanceStatus | 'undeclared';
  title: string;
  /** FR display time ("12h00"). */
  time: string;
  cancelReason: string | null;
  /** True once any editorial content (summary/assets) is present. */
  hasContent: boolean;
  assetCount: number;
  messageCount: number;
  /** Past relative to "now" (Europe/Paris civil day). */
  isPast: boolean;
  /** False when no-rewind forbids reverting to "prévue" (status === 'done'). */
  canRevertToScheduled: boolean;
  /**
   * J6 scope 5 — distinct member viewers of this replay (the "Vu par X" of the
   * "Vu par X/N" coverage badge). `null` for any non-`done`/undeclared cell (no
   * published replay to open); `0` for a held session nobody has opened yet.
   */
  viewerCount: number | null;
  pipeline: AdminPipelineView;
}

export interface AdminSeanceDay {
  date: LocalDateString;
  /** "lundi 29 juin 2026". */
  label: string;
  cells: AdminSeanceCell[];
}

export interface AdminSeanceStats {
  /** Declared (any status) sessions in the window. */
  declared: number;
  done: number;
  cancelled: number;
  /** Future scheduled sessions (declared ahead, not yet held). */
  upcoming: number;
}

/** The 6 copyable Discord messages of the most-recent held session. */
export interface AdminDiscordMessage {
  asset: string;
  text: string;
}
export interface AdminLatestMessages {
  date: LocalDateString;
  slot: SeanceSlot;
  title: string;
  messages: AdminDiscordMessage[];
}

export interface AdminSeancesView {
  stats: AdminSeanceStats;
  days: AdminSeanceDay[];
  latestMessages: AdminLatestMessages | null;
  /**
   * J6 scope 5 — the denominator N of the "Vu par X/N" badge: active members
   * excluding the showcase/demo account (consistent with the leaderboard).
   * Cohort-wide, identical for every cell, so it is carried once at the view
   * level and passed down to each cell.
   */
  activeMemberCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map a `@db.Date` (UTC-midnight) to a civil `YYYY-MM-DD` (no tz drift). */
function toLocalDate(date: Date): LocalDateString {
  return date.toISOString().slice(0, 10);
}

/** Slot order within a day: analyse (12h) before debrief (20h). */
const SLOT_ORDER: Record<SeanceSlot, number> = { analyse: 0, debrief: 1 };

type SeanceRowForAdmin = {
  id: string;
  date: Date;
  slot: string;
  status: string;
  title: string;
  time: string | null;
  cancelReason: string | null;
  summary: string | null;
  cpMp4: boolean;
  cpVimeo: boolean;
  cpTranscript: boolean;
  cpAi: boolean;
  cpDeployed: boolean;
  vimeoProcessing: boolean;
  transcriptPending: boolean;
  contentNeedsReview: boolean;
  pipelineFailedStep: string | null;
  pipelineFailedError: string | null;
  pipelineSyncedAt: Date | null;
  _count: { assets: number; messages: number };
};

function rowToCell(
  r: SeanceRowForAdmin,
  today: LocalDateString,
  viewerCounts: Map<string, number>,
): AdminSeanceCell {
  const date = toLocalDate(r.date);
  const slot = r.slot as SeanceSlot;
  const status = r.status as SeanceStatus;
  const pipeline = derivePipelineStatus({
    status,
    cpMp4: r.cpMp4,
    cpVimeo: r.cpVimeo,
    cpTranscript: r.cpTranscript,
    cpAi: r.cpAi,
    cpDeployed: r.cpDeployed,
    vimeoProcessing: r.vimeoProcessing,
    transcriptPending: r.transcriptPending,
    contentNeedsReview: r.contentNeedsReview,
    pipelineFailedStep: r.pipelineFailedStep,
  });
  return {
    date,
    slot,
    exists: true,
    status,
    title: seanceCellTitle(r.title, date, slot),
    time: seanceCellTime(r.time, slot),
    cancelReason: r.cancelReason,
    hasContent: Boolean(r.summary) || r._count.assets > 0,
    assetCount: r._count.assets,
    messageCount: r._count.messages,
    isPast: date < today,
    canRevertToScheduled: status !== 'done',
    // "Vu par X" only for a held (published) session with a real replay; a
    // scheduled/cancelled/undeclared cell has nothing to open → null.
    viewerCount: status === 'done' ? (viewerCounts.get(r.id) ?? 0) : null,
    pipeline: {
      steps: pipeline.steps,
      badge: pipeline.badge,
      hasData: pipeline.hasData,
      deadLetter: pipeline.deadLetter,
      failedStep: r.pipelineFailedStep,
      failedError: r.pipelineFailedError,
      syncedAt: r.pipelineSyncedAt ? r.pipelineSyncedAt.toISOString() : null,
    },
  };
}

function placeholderCell(
  date: LocalDateString,
  slot: SeanceSlot,
  today: LocalDateString,
): AdminSeanceCell {
  const pipeline = derivePipelineStatus({
    status: 'scheduled',
    cpMp4: false,
    cpVimeo: false,
    cpTranscript: false,
    cpAi: false,
    cpDeployed: false,
    vimeoProcessing: false,
    transcriptPending: false,
    contentNeedsReview: false,
    pipelineFailedStep: null,
  });
  return {
    date,
    slot,
    exists: false,
    status: 'undeclared',
    title: deriveSeanceTitle(date, slot),
    time: seanceCellTime(null, slot),
    cancelReason: null,
    hasContent: false,
    assetCount: 0,
    messageCount: 0,
    isPast: date < today,
    canRevertToScheduled: true,
    // Undeclared placeholder → no session, nothing to view.
    viewerCount: null,
    pipeline: {
      steps: pipeline.steps,
      badge: pipeline.badge,
      hasData: pipeline.hasData,
      deadLetter: pipeline.deadLetter,
      failedStep: null,
      failedError: null,
      syncedAt: null,
    },
  };
}

// ── Read: the admin calendar ─────────────────────────────────────────────────

/**
 * Assemble the admin calendar: every existing `ReplaySession` in the rolling
 * window `[today − PAST, today + HORIZON]` UNIONed with the future weekday cells
 * the admin can declare ahead into (`futureSeanceCells`). Newest-day-first; both
 * slots per day in chronological order. PII-free, counts only (posture §2).
 */
export async function listSeancesForAdmin(now: Date = new Date()): Promise<AdminSeancesView> {
  const today = seanceToday(now);
  const fromDate = parseLocalDate(shiftLocalDate(today, -ADMIN_SEANCE_PAST_DAYS));
  const toDate = parseLocalDate(shiftLocalDate(today, ADMIN_SEANCE_HORIZON_DAYS));

  const rows = await db.replaySession.findMany({
    where: { date: { gte: fromDate, lte: toDate } },
    orderBy: [{ date: 'desc' }, { slot: 'asc' }],
    select: {
      id: true,
      date: true,
      slot: true,
      status: true,
      title: true,
      time: true,
      cancelReason: true,
      summary: true,
      cpMp4: true,
      cpVimeo: true,
      cpTranscript: true,
      cpAi: true,
      cpDeployed: true,
      vimeoProcessing: true,
      transcriptPending: true,
      contentNeedsReview: true,
      pipelineFailedStep: true,
      pipelineFailedError: true,
      pipelineSyncedAt: true,
      _count: { select: { assets: true, messages: true } },
    },
  });

  // J6 scope 5 — "Vu par X/N" coverage. Count distinct viewers for the held
  // (published) sessions in ONE batched groupBy (no N+1), and the cohort-wide
  // active-member denominator once. Only `done` sessions carry a real replay.
  const doneIds = rows.filter((r) => r.status === 'done').map((r) => r.id);
  const [viewerCounts, memberCount] = await Promise.all([
    countViewersForSessions(doneIds),
    activeMemberCount(),
  ]);

  const byKey = new Map<string, AdminSeanceCell>();
  const key = (date: string, slot: string): string => `${date}#${slot}`;

  for (const r of rows) {
    const cell = rowToCell(r, today, viewerCounts);
    byKey.set(key(cell.date, cell.slot), cell);
  }

  // UNION with the future weekday cells (declarable ahead) not already present.
  for (const { date, slot } of futureSeanceCells(today)) {
    const k = key(date, slot);
    if (!byKey.has(k)) byKey.set(k, placeholderCell(date, slot, today));
  }

  const cells = [...byKey.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // date desc
    return SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]; // analyse before debrief
  });

  // Group into day buckets (already date-desc sorted).
  const days: AdminSeanceDay[] = [];
  let current: AdminSeanceDay | null = null;
  for (const cell of cells) {
    if (!current || current.date !== cell.date) {
      current = { date: cell.date, label: formatDayLabel(cell.date), cells: [] };
      days.push(current);
    }
    current.cells.push(cell);
  }

  const declaredCells = [...byKey.values()].filter((c) => c.exists);
  const stats: AdminSeanceStats = {
    declared: declaredCells.length,
    done: declaredCells.filter((c) => c.status === 'done').length,
    cancelled: declaredCells.filter((c) => c.status === 'cancelled').length,
    upcoming: declaredCells.filter((c) => c.status === 'scheduled' && !c.isPast).length,
  };

  const latestMessages = await getLatestDoneSessionMessages();

  return { stats, days, latestMessages, activeMemberCount: memberCount };
}

/** FR "lundi 29 juin 2026" from a YYYY-MM-DD (UTC-pinned, no tz drift). */
function formatDayLabel(date: LocalDateString): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseLocalDate(date));
}

/**
 * The 6 copyable Discord messages of the MOST-RECENT held (`done`) session
 * (mirror the static hub: only the latest session's messages are surfaced).
 * Returns null when no done session has messages yet (J4 fills them).
 */
export async function getLatestDoneSessionMessages(): Promise<AdminLatestMessages | null> {
  const row = await db.replaySession.findFirst({
    where: { status: 'done', messages: { some: {} } },
    orderBy: [{ date: 'desc' }, { slot: 'asc' }],
    select: {
      date: true,
      slot: true,
      title: true,
      messages: {
        orderBy: { position: 'asc' },
        select: { asset: true, text: true },
      },
    },
  });
  if (!row) return null;
  const date = toLocalDate(row.date);
  const slot = row.slot as SeanceSlot;
  return {
    date,
    slot,
    title: seanceCellTitle(row.title, date, slot),
    messages: row.messages.map((m) => ({ asset: m.asset, text: m.text })),
  };
}

// ── Write: the go/no-go declaration ──────────────────────────────────────────

export interface DeclaredSeance {
  date: LocalDateString;
  slot: SeanceSlot;
  status: SeanceStatus;
}

/**
 * Declare go/no-go for one `(date, slot)`. Loads the row, runs the pure FSM
 * planner, then applies it:
 *   - **create** a new `scheduled`/`done`/`cancelled` row (no-backfill enforced
 *     by the planner: a past day with no row is refused),
 *   - **update** an existing row, with any reinstate OUT of `cancelled` (→ done
 *     or → scheduled) wiping stale content + checkpoints + assets + messages in
 *     ONE transaction so a reinstated session never republishes an outdated
 *     analysis (Règle n°1),
 *   - **refuse** a no-rewind (`done → scheduled`) with {@link SeanceGoNoGoError}.
 *
 * `title` is DERIVED (never admin-input). `time` is the admin-owned field
 * (normalised "HH:MM" → "12h00"). `reason` is `safeFreeText`-sanitised and only
 * stored when the target is `cancelled`.
 */
export async function declareSeanceGoNoGo(
  input: {
    date: LocalDateString;
    slot: SeanceSlot;
    status: SeanceStatus;
    time?: string;
    reason?: string;
  },
  now: Date = new Date(),
): Promise<DeclaredSeance> {
  // Validate the civil date (throws → the action maps to invalid_input).
  const dateObj = parseLocalDate(input.date);
  const today = seanceToday(now);
  const isPastDate = input.date < today;

  const existing = await db.replaySession.findUnique({
    where: { date_slot: { date: dateObj, slot: input.slot } },
    select: { id: true, status: true },
  });

  const decision = planSeanceGoNoGo({
    existingStatus: (existing?.status ?? null) as SeanceStatus | null,
    target: input.status,
    isPastDate,
  });
  if (!decision.ok) throw new SeanceGoNoGoError(decision.reason);

  const time = normalizeSeanceTime(input.time);
  const reason = input.status === 'cancelled' && input.reason ? safeFreeText(input.reason) : null;

  if (decision.mode === 'create') {
    await db.replaySession.create({
      data: {
        date: dateObj,
        slot: input.slot,
        status: input.status,
        title: deriveSeanceTitle(input.date, input.slot),
        time,
        cancelReason: reason,
      },
    });
    return { date: input.date, slot: input.slot, status: input.status };
  }

  // mode === 'update' — `existing` is guaranteed non-null here (planner only
  // returns 'update' when existingStatus !== null).
  const id = existing!.id;

  // Common writable fields. `time` only overwrites when the admin supplied one
  // (null = keep the stored value); the cancel reason is set only for cancelled.
  const baseData: Record<string, unknown> = {
    status: input.status,
    cancelReason: input.status === 'cancelled' ? reason : null,
  };
  if (time !== null) baseData.time = time;

  if (decision.wipeContent) {
    // Reinstate out of cancelled (→ done or → scheduled): wipe stale editorial
    // content + checkpoints + assets + messages atomically so nothing outdated
    // is ever republished as "à jour" (incl. via a later scheduled → done).
    await db.$transaction(async (tx) => {
      await tx.replayAsset.deleteMany({ where: { sessionId: id } });
      await tx.replayMessage.deleteMany({ where: { sessionId: id } });
      await tx.replaySession.update({
        where: { id },
        data: {
          ...baseData,
          cancelReason: null,
          summary: null,
          keyTakeaways: [],
          duration: null,
          vimeoId: null,
          vimeoHash: null,
          vimeoEmbedUrl: null,
          vimeoProcessing: false,
          transcriptSource: null,
          transcriptLang: null,
          transcriptPending: false,
          contentGenerated: false,
          contentModel: null,
          contentNeedsReview: false,
          cpMp4: false,
          cpVimeo: false,
          cpTranscript: false,
          cpAi: false,
          cpDeployed: false,
          pipelineFailedStep: null,
          pipelineFailedError: null,
          // Clear the J4 sync stamp too: a wiped session is no longer "synced"
          // — leaving the old value would surface a lying "Synchronisé …" label
          // in the admin pipeline panel, the exact stale-"à jour" the wipe kills.
          pipelineSyncedAt: null,
        },
      });
    });
    return { date: input.date, slot: input.slot, status: input.status };
  }

  await db.replaySession.update({ where: { id }, data: baseData });
  return { date: input.date, slot: input.slot, status: input.status };
}

/**
 * Re-arm the AI step on a held session so the J4 pipeline regenerates its
 * editorial content (the 6 Discord messages + the page). J3 contract: clears the
 * AI checkpoint + `contentGenerated` and flags `contentNeedsReview = false` (a
 * fresh budget, mirror the static `resetAiAttempts` — a deliberate human
 * decision, never an automatic loop). Refuses a missing or non-`done` target.
 * Upstream checkpoints (mp4/vimeo/transcript) are left intact (distinct from a
 * full re-ingestion). The actual re-generation runs in J4.
 */
export async function requestSeanceRegeneration(
  date: LocalDateString,
  slot: SeanceSlot,
): Promise<void> {
  const dateObj = parseLocalDate(date);
  const existing = await db.replaySession.findUnique({
    where: { date_slot: { date: dateObj, slot } },
    select: { id: true, status: true },
  });
  if (!existing) throw new SeanceRegenerateError('not_found');
  if (existing.status !== 'done') throw new SeanceRegenerateError('not_done');

  await db.replaySession.update({
    where: { id: existing.id },
    data: {
      cpAi: false,
      contentGenerated: false,
      contentNeedsReview: false,
      pipelineFailedStep: null,
      pipelineFailedError: null,
    },
  });
}
