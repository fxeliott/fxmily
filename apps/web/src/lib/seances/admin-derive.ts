/**
 * Pure derivations for the réunion hub ADMIN surface (`/admin/seances`, J3) —
 * NO `server-only`, NO DB. The load-bearing go/no-go FSM lives here as a pure
 * planner so it is exhaustively unit-testable without a database (same discipline
 * as `occurrence.ts` / `derive.ts`).
 *
 * Ported faithfully from the static hub's `state.mjs` (declareGoNoGo guards) and
 * `generate.mjs` (pipelineState / rowBadge). The Fxmily `ReplaySession` model
 * collapses the static hub's 10-state FSM into a 3-value `status`
 * (scheduled/done/cancelled) + the `cp_*` checkpoint booleans + a
 * `pipelineFailedStep/Error` pair — so the admin authority (this module) drives
 * `status`, while the J4 pipeline drives the checkpoints. The two stay 1:1 with
 * the static hub's surface.
 *
 * Posture §2 / Règle n°1: the admin only declares WHETHER a session was held —
 * never authors the analysis (that is the faithful pipeline's job).
 */
import {
  localDateOf,
  parseLocalDate,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';

import { deriveSeanceTime, deriveSeanceTitle, type SeanceSlot, type SeanceStatus } from './derive';

/** Single source of truth for the séance timezone (V1 cohort = France). */
export const SEANCE_TIMEZONE = 'Europe/Paris';

/** Both daily slots, in chronological order (analyse@12h then debrief@20h). */
export const SEANCE_SLOTS = ['analyse', 'debrief'] as const;

/** The 3 admin-declarable statuses (≠ the richer internal pipeline steps). */
export const SEANCE_STATUSES = ['scheduled', 'done', 'cancelled'] as const;

/** Days of recent history the admin calendar surfaces (existing rows only). */
export const ADMIN_SEANCE_PAST_DAYS = 14;
/** Future weekday horizon the admin can declare ahead into (mirror static +14). */
export const ADMIN_SEANCE_HORIZON_DAYS = 14;

/** Max length of the free-text cancel reason (anti heap-amplification). */
export const SEANCE_CANCEL_REASON_MAX = 280;

// ── Time normalisation ───────────────────────────────────────────────────────

const TIME_INPUT_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Normalise an `<input type="time">` value ("HH:MM", 24h) into the FR display
 * form the model stores ("12h00" / "09h05"). Returns null on a malformed or
 * empty value (the caller then falls back to the slot default). Mirror the
 * static hub `inputToFrTime` — the admin is the PRODUCER of the `time` field.
 */
export function normalizeSeanceTime(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = TIME_INPUT_REGEX.exec(hhmm.trim());
  if (!m) return null;
  return `${m[1]}h${m[2]}`;
}

/** Inverse: "12h00" → "12:00" for prefilling `<input type="time">`. Null-safe. */
export function seanceTimeToInputValue(frTime: string | null | undefined): string {
  if (!frTime) return '';
  const m = /^([01]\d|2[0-3])h([0-5]\d)$/.exec(frTime.trim());
  return m ? `${m[1]}:${m[2]}` : '';
}

// ── Go/No-Go transition planner (the FSM — pure, fully unit-tested) ───────────

/** Why a go/no-go declaration is refused (HARD guard, mirror static state.mjs). */
export type GoNoGoRejectReason = 'backfill' | 'no_rewind';

export interface GoNoGoInput {
  /** Current persisted status, or null when no row exists yet (undeclared). */
  existingStatus: SeanceStatus | null;
  /** Desired terminal status. */
  target: SeanceStatus;
  /** True when the session's civil date is strictly before today (Paris). */
  isPastDate: boolean;
}

export type GoNoGoDecision =
  | { ok: false; reason: GoNoGoRejectReason }
  | {
      ok: true;
      /** create a new row vs update the existing one. */
      mode: 'create' | 'update';
      /**
       * Reinstating a `cancelled` slot back into the active lifecycle — to
       * `done` (republish now) OR to `scheduled` (upcoming again) — MUST wipe
       * stale editorial content + checkpoints so a reinstated session never
       * republishes an outdated analysis marked "à jour" (Règle n°1, static
       * state.mjs:413-441). Wiping on the `→ scheduled` edge too closes the
       * `done → cancelled → scheduled → done` resurfacing path (a later
       * `scheduled → done` does NOT wipe — by then the slot is already clean).
       */
      wipeContent: boolean;
    };

/**
 * Decide whether a go/no-go declaration is allowed, and how to apply it. Pure:
 * the service loads the row, calls this, then writes. Faithful port of the
 * static `declareGoNoGo` guards:
 *   - **no-backfill**: cannot CREATE a session on a past day (no fabricated
 *     history). Acting on an EXISTING past row is still allowed (e.g. cancel).
 *   - **no-rewind**: a `done` session can never revert to `scheduled`. Only
 *     `cancelled → scheduled` (reinstate to undecided) and the `scheduled`
 *     no-op are permitted into `scheduled`.
 *   - **reinstate reset**: leaving `cancelled` (→ `done` OR → `scheduled`) wipes
 *     content + checkpoints, so no stale analysis can resurface on a re-held slot.
 */
export function planSeanceGoNoGo(input: GoNoGoInput): GoNoGoDecision {
  const { existingStatus, target, isPastDate } = input;

  // no-backfill: a brand-new row may only be declared for today or the future.
  if (existingStatus === null) {
    if (isPastDate) return { ok: false, reason: 'backfill' };
    return { ok: true, mode: 'create', wipeContent: false };
  }

  // no-rewind: a held session cannot be un-held back to "prévue".
  if (target === 'scheduled' && existingStatus === 'done') {
    return { ok: false, reason: 'no_rewind' };
  }

  // reinstate: ANY transition OUT of `cancelled` (→ done = republish now, or
  // → scheduled = upcoming again) republishes from scratch — wipe stale content
  // so `done → cancelled → scheduled → done` can never resurface an old analysis.
  const wipeContent =
    existingStatus === 'cancelled' && (target === 'done' || target === 'scheduled');
  return { ok: true, mode: 'update', wipeContent };
}

// ── Pipeline status derivation (read-only display contract, J4 fills it) ──────

/** One pipeline step's display state (mirror static STEP_META). */
export type PipelineStepState = 'done' | 'active' | 'pending' | 'failed' | 'idle';

export interface PipelineStep {
  key: 'mp4' | 'vimeo' | 'transcript' | 'ai' | 'deployed';
  label: string;
  state: PipelineStepState;
  /** First not-done step → `aria-current="step"` in the UI. */
  current: boolean;
}

/** Global row badge (priority-ordered, mirror static rowBadge). */
export type PipelineBadge =
  | 'cancelled' // status cancelled
  | 'relancer' // an ingestion step failed → replay it
  | 'regenerer' // AI content needs review → regenerate
  | 'publie' // every step done
  | 'encours' // some progress, not finished
  | 'attente'; // nothing started yet

export interface PipelineStatusInput {
  status: SeanceStatus;
  cpMp4: boolean;
  cpVimeo: boolean;
  cpTranscript: boolean;
  cpAi: boolean;
  cpDeployed: boolean;
  vimeoProcessing: boolean;
  transcriptPending: boolean;
  contentNeedsReview: boolean;
  pipelineFailedStep: string | null;
}

export interface PipelineStatus {
  steps: PipelineStep[];
  badge: PipelineBadge;
  /** Any checkpoint reached / failure recorded (drives "en cours" vs "en attente"). */
  hasData: boolean;
  /** AI content flagged for regeneration (needsReview OR an ai-step failure). */
  deadLetter: boolean;
}

const STEP_DEFS: ReadonlyArray<{ key: PipelineStep['key']; label: string }> = [
  { key: 'mp4', label: 'Vidéo locale' },
  { key: 'vimeo', label: 'Hébergement Vimeo' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'ai', label: 'Rédaction' },
  { key: 'deployed', label: 'Publication' },
];

/**
 * Derive the 5-step pipeline panel + the global badge from a row's checkpoints,
 * faithfully reproducing the static hub's `pipelineState` + `rowBadge`. A failed
 * step is NEVER masked as "active" — `pipelineFailedStep` forces that step to
 * `failed` ("jamais d'échec silencieux"). Pure → unit-testable.
 */
export function derivePipelineStatus(input: PipelineStatusInput): PipelineStatus {
  const checkpoints: Record<PipelineStep['key'], boolean> = {
    mp4: input.cpMp4,
    vimeo: input.cpVimeo,
    transcript: input.cpTranscript,
    ai: input.cpAi,
    deployed: input.cpDeployed,
  };

  let firstPendingAssigned = false;
  const steps: PipelineStep[] = STEP_DEFS.map(({ key, label }) => {
    let state: PipelineStepState;
    if (input.pipelineFailedStep === key) {
      state = 'failed';
    } else if (checkpoints[key]) {
      state = 'done';
    } else if (key === 'vimeo' && input.vimeoProcessing) {
      state = 'active';
    } else if (key === 'transcript' && input.transcriptPending) {
      state = 'pending';
    } else if (key === 'ai' && input.contentNeedsReview) {
      state = 'failed';
    } else {
      state = 'idle';
    }
    // The first not-done step is the one the pipeline is "on" (aria-current).
    const current = !firstPendingAssigned && state !== 'done';
    if (current) firstPendingAssigned = true;
    return { key, label, state, current };
  });

  const allDone = STEP_DEFS.every(({ key }) => checkpoints[key]);
  const hasData =
    allDone ||
    Object.values(checkpoints).some(Boolean) ||
    input.vimeoProcessing ||
    input.transcriptPending ||
    input.contentNeedsReview ||
    input.pipelineFailedStep !== null;
  const ingestionFailed = input.pipelineFailedStep !== null && input.pipelineFailedStep !== 'ai';
  const deadLetter = input.contentNeedsReview || input.pipelineFailedStep === 'ai';

  let badge: PipelineBadge;
  if (input.status === 'cancelled') {
    badge = 'cancelled';
  } else if (ingestionFailed) {
    badge = 'relancer';
  } else if (deadLetter) {
    badge = 'regenerer';
  } else if (allDone) {
    badge = 'publie';
  } else if (hasData) {
    badge = 'encours';
  } else {
    badge = 'attente';
  }

  return { steps, badge, hasData, deadLetter };
}

// ── Admin calendar window (existing rows ∪ future weekday cells) ──────────────

/** ISO weekday helper — Sat (6) / Sun (0) via `getUTCDay()` (mirror occurrence). */
export function isWeekendDate(localDate: LocalDateString): boolean {
  const dow = parseLocalDate(localDate).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Build the ordered list of `(date, slot)` cells the admin calendar declares
 * AHEAD into: today + every future weekday up to `+ADMIN_SEANCE_HORIZON_DAYS`,
 * both slots per day. The service UNIONs this with any existing rows (incl. past
 * ones within `ADMIN_SEANCE_PAST_DAYS`). Pure + deterministic (anchor injected).
 */
export function futureSeanceCells(today: LocalDateString): Array<{
  date: LocalDateString;
  slot: SeanceSlot;
}> {
  const cells: Array<{ date: LocalDateString; slot: SeanceSlot }> = [];
  for (let offset = 0; offset <= ADMIN_SEANCE_HORIZON_DAYS; offset += 1) {
    const date = shiftLocalDate(today, offset);
    if (isWeekendDate(date)) continue;
    for (const slot of SEANCE_SLOTS) {
      cells.push({ date, slot });
    }
  }
  return cells;
}

/** Today (Europe/Paris) as `YYYY-MM-DD` from a UTC instant. */
export function seanceToday(now: Date): LocalDateString {
  return localDateOf(now, SEANCE_TIMEZONE);
}

/** Display title for a cell: stored title, else derived from date+slot. */
export function seanceCellTitle(
  title: string | null,
  date: LocalDateString,
  slot: SeanceSlot,
): string {
  return title && title.length > 0 ? title : deriveSeanceTitle(date, slot);
}

/** Display time for a cell: stored time, else the slot default. */
export function seanceCellTime(time: string | null, slot: SeanceSlot): string {
  return time && time.length > 0 ? time : deriveSeanceTime(slot);
}

/**
 * Format the J4 `pipelineSyncedAt` instant into a compact FR label ("30/06 à
 * 22h46", Europe/Paris) for the admin pipeline panel — the J3 dead column made
 * visible (the writer now stamps it on every sync). Pure + deterministic (a
 * fixed instant + a fixed timezone → no `now`, no hydration drift). Null-safe:
 * a null/unparseable input returns null (the panel then renders nothing).
 */
export function formatSyncedAtLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: SEANCE_TIMEZONE,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')} à ${get('hour')}h${get('minute')}`;
}

/** Re-export the status type for ergonomic admin imports. */
export type { SeanceSlot, SeanceStatus };
