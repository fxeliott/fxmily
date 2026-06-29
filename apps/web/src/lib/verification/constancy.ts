import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';
import {
  localDateOf,
  localInstantToUtc,
  parseLocalDate,
  shiftLocalDate,
} from '@/lib/checkin/timezone';
import { MEETING_WINDOW_DAYS, meetingJoinFloor } from '@/lib/meeting/window';
import { listClosedOccurrences, localDateToUtcMidnight } from '@/lib/tracking/cadence';
import { getCurrentInstruments } from '@/lib/tracking/registry';

import { mapMembersChunked } from './batch-util';

/** Prisma unique-constraint violation (P2002), detected without importing @prisma/client. */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
}

/**
 * S3 §33.5 — Score de constance & d'investissement dans le travail.
 *
 * Deux moteurs DÉTERMINISTES (formules documentées + unit-testées §7.11) :
 *
 * 1. **Scan rituel quotidien** (vérification généralisée §30) : pour chaque
 *    membre actif, HIER (jour civil Paris) — chaque check-in (matin/soir)
 *    rempli émet un `ScoreEvent(filled, +1)`, chaque check-in manquant émet
 *    un `ScoreEvent(forgot_no_reason, −1)` ; une journée TOTALEMENT vide
 *    matérialise en plus un `Discrepancy(unfilled_no_reason, sev 1)` que le
 *    membre peut excuser (`memberReason` — « motif valable » DoD §29).
 *    Idempotence : les événements rituels portent un id DÉTERMINISTE
 *    (`sev1-<reason>-<memberId>-<day>-<slot>`) + `createMany skipDuplicates`
 *    → un re-run du cron n'émet jamais deux fois.
 *
 * 2. **Fold hebdo** : agrège les `ScoreEvent` de la semaine ISO courante
 *    (lundi Paris) en un `ConstancyScore` upsert idempotent sur
 *    `(memberId, periodStart)`.
 *
 * Formules (documentées, anti-complaisance mais sans culpabilisation §33.2) :
 *   - regularity  = filled / (filled + forgot_unexcused) × 100 (null si 0)
 *   - honesty     = 100 − 15×reality_gap − 40×false_declaration (événements
 *                   NON excusés uniquement ; clamp ≥ 0 ; null si le membre
 *                   n'a JAMAIS été confronté — aucune position extraite)
 *   - discipline  = écarts traités (acknowledged/resolved ou motif donné) /
 *                   écarts totaux 28j × 100 — « faire face à la réalité »
 *                   à la Mark Douglas (null si aucun écart)
 *   - value       = moyenne pondérée des axes non-null (honesty .40,
 *                   regularity .35, discipline .25, re-normalisée)
 *
 * « Le score remonte » quand le membre donne un motif valable : le fold
 * EXCLUT les événements négatifs dont l'écart lié porte un `memberReason`
 * (l'événement reste dans le journal — l'histoire ne se réécrit pas, seul
 * le score pardonne).
 */

export const HONESTY_PENALTY_REALITY_GAP = 15;
export const HONESTY_PENALTY_FALSE_DECLARATION = 40;
export const CONSTANCY_WEIGHTS = { honesty: 0.4, regularity: 0.35, discipline: 0.25 } as const;
export const DISCIPLINE_WINDOW_DAYS = 28;

// =============================================================================
// 1. Daily ritual scan (yesterday, Paris civil day)
// =============================================================================

export interface RitualScanResult {
  readonly membersScanned: number;
  readonly filledEvents: number;
  readonly forgotEvents: number;
  readonly blankDayDiscrepancies: number;
  readonly errors: number;
}

/** Deterministic ScoreEvent id — THE idempotency key of the ritual scan. */
export function ritualEventId(
  reason: 'filled' | 'forgot_no_reason',
  memberId: string,
  day: string,
  slot: 'morning' | 'evening',
): string {
  return `sev1-${reason === 'filled' ? 'f' : 'n'}-${memberId}-${day.replaceAll('-', '')}-${slot}`;
}

export async function scanRitualsForAllMembers(
  options: { now?: Date } = {},
): Promise<RitualScanResult> {
  const now = options.now ?? new Date();
  // Surfaces S3 are Paris-keyed like the calendar/meetings (MAJ-17 canon).
  const yesterday = shiftLocalDate(localDateOf(now, 'Europe/Paris'), -1);
  const yesterdayDate = parseLocalDate(yesterday);

  const members = await db.user.findMany({
    where: {
      status: 'active',
      role: 'member',
      // A member who joined yesterday or later owes nothing for yesterday —
      // compared against PARIS midnight of that civil day (adverse-review:
      // a UTC-midnight compare let a 00:00-02:00 CEST signup be scanned for
      // their own signup day).
      createdAt: { lt: localInstantToUtc(yesterday, 0, 0, 0, 0, 'Europe/Paris') },
    },
    select: { id: true },
  });

  // S10 perf — batch yesterday's check-ins for ALL scanned members in ONE
  // query instead of a findMany per member (was O(members) round-trips on a
  // daily cron — the only trivially-batchable N+1 in the verification scan).
  // Grouped into a Map<userId, Set<slot>>; the per-member loop below keeps its
  // own try/catch + deterministic event ids, so robustness + idempotence are
  // byte-identical to the per-member read.
  const memberIds = members.map((m) => m.id);
  const allCheckins = await db.dailyCheckin.findMany({
    where: { userId: { in: memberIds }, date: yesterdayDate },
    select: { userId: true, slot: true },
  });
  const checkinsByMember = new Map<string, Set<string>>();
  for (const c of allCheckins) {
    let set = checkinsByMember.get(c.userId);
    if (!set) {
      set = new Set<string>();
      checkinsByMember.set(c.userId, set);
    }
    set.add(c.slot);
  }

  let filledEvents = 0;
  let forgotEvents = 0;
  let blankDayDiscrepancies = 0;
  let errors = 0;

  // Chunked-parallel per member (throughput at scale) — counters are mutated in
  // the closure with their EXACT original placement (synchronous `+=` between
  // awaits is atomic under JS's cooperative scheduling, so the sums are
  // order-independent and byte-identical to the former sequential loop); only
  // error handling moves to the settled-results zip.
  const settled = await mapMembersChunked(members, async (member) => {
    const filledSlots = checkinsByMember.get(member.id) ?? new Set<string>();

    // A FULLY blank day materialises ONE excusable discrepancy FIRST, so
    // the day's `forgot` events can reference it — giving a « motif
    // valable » then excuses the whole day in the fold (« le score
    // remonte », DoD §29/§31#3). Identity-deduped on (member, day).
    let blankDayDiscrepancyId: string | null = null;
    if (filledSlots.size === 0) {
      const existing = await db.discrepancy.findFirst({
        where: { memberId: member.id, type: 'unfilled_no_reason', detectedAt: yesterdayDate },
        select: { id: true },
      });
      if (existing) {
        blankDayDiscrepancyId = existing.id;
      } else {
        try {
          const created = await db.discrepancy.create({
            data: {
              memberId: member.id,
              type: 'unfilled_no_reason',
              severity: 1,
              detectedAt: yesterdayDate,
              claudeReasoning:
                'Journée sans aucun check-in (matin et soir vides), sans motif déclaré pour le moment.',
            },
            select: { id: true },
          });
          blankDayDiscrepancyId = created.id;
          blankDayDiscrepancies += 1;
        } catch (err) {
          // The read-then-create above is NOT concurrency-safe: the daily
          // `verification-scan` cron and an event-driven `batch.ts` pass can both
          // read « none » for the same blank day before either commits, then both
          // INSERT — a duplicate excusable accusation for one day (and the day's
          // `forgot` events would split their excuse link across two rows). The
          // partial unique index `discrepancies_blank_day_uniq` (member, day)
          // makes the loser's create raise P2002; fold it to a no-op by re-reading
          // the winner so this pass's `forgot` events still reference the single
          // surviving discrepancy. Mirror reconcile.ts `createIfNew`. NOT counted
          // in `blankDayDiscrepancies` — the winning pass already counted it.
          if (!isUniqueConstraintError(err)) throw err;
          const winner = await db.discrepancy.findFirst({
            where: { memberId: member.id, type: 'unfilled_no_reason', detectedAt: yesterdayDate },
            select: { id: true },
          });
          blankDayDiscrepancyId = winner?.id ?? null;
        }
      }
    }

    const events: Array<{
      id: string;
      memberId: string;
      delta: number;
      reason: 'filled' | 'forgot_no_reason';
      relatedDiscrepancyId: string | null;
      createdAt: Date;
    }> = [];
    for (const slot of ['morning', 'evening'] as const) {
      if (filledSlots.has(slot)) {
        events.push({
          id: ritualEventId('filled', member.id, yesterday, slot),
          memberId: member.id,
          delta: 1,
          reason: 'filled',
          relatedDiscrepancyId: null,
          // Stamp the RITUAL day (Paris civil midnight), NOT the scan time.
          // The scan runs the morning AFTER the ritual day, so without this
          // a Sunday ritual (scanned Monday) defaults `createdAt` to Monday
          // and the weekly fold — which buckets by `createdAt` over the ISO
          // week [Mon, next Mon) (recomputeConstancyForAllMembers) — leaks it
          // into the NEXT week. Anchoring `createdAt` to `yesterdayDate`
          // keeps every ritual event in the week it belongs to.
          createdAt: yesterdayDate,
        });
      } else {
        events.push({
          id: ritualEventId('forgot_no_reason', member.id, yesterday, slot),
          memberId: member.id,
          delta: -1,
          reason: 'forgot_no_reason',
          relatedDiscrepancyId: blankDayDiscrepancyId,
          createdAt: yesterdayDate,
        });
      }
    }

    await db.scoreEvent.createMany({ data: events, skipDuplicates: true });
    filledEvents += events.filter((e) => e.reason === 'filled').length;
    forgotEvents += events.filter((e) => e.reason === 'forgot_no_reason').length;
  });
  settled.forEach((s, idx) => {
    if (s.status === 'rejected') {
      errors += 1;
      reportError(
        'verification.constancy.scan',
        s.reason instanceof Error ? s.reason : new Error('ritual_scan_failed'),
        { memberId: members[idx]!.id },
      );
    }
  });

  return {
    membersScanned: members.length,
    filledEvents,
    forgotEvents,
    blankDayDiscrepancies,
    errors,
  };
}

// =============================================================================
// 1bis. Meeting no-show scan (vérification généralisée §31 — beyond check-ins)
// =============================================================================

const MS_PER_DAY = 86_400_000;

/**
 * Daily cron re-scans the band of meetings whose 30-day rattrapage window JUST
 * closed. 2 days wide so a single missed cron run is recovered; the
 * `@@unique([memberId, meetingId])` dedup makes the overlap a no-op.
 */
export const MEETING_MISS_SCAN_LOOKBACK_DAYS = 2;

const MEETING_DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
});

export interface MeetingNoShowScanResult {
  readonly membersScanned: number;
  readonly meetingsClosed: number;
  readonly discrepanciesCreated: number;
  readonly errors: number;
}

/**
 * S3 §31 — "applique le même principe à l'ensemble des données, pas seulement
 * les trades ; quand rien n'est fait sans motif valable → manque de discipline".
 * A SCHEDULED meeting the member neither attended (live OR replay + content
 * reviewed) nor excused, once its 30-day rattrapage window has CLOSED, becomes a
 * `meeting_missed_no_reason` Discrepancy — EXCUSABLE (`memberReason` → the score
 * recovers, §29) and strictly fed into the existing discipline axis + repetition
 * alert. NEVER fires while the meeting is still rattrapable (the window is open)
 * nor for a `cancelled` slot (§30.2/§33.6 — no unjust accusation).
 *
 * Mirrors the ritual blank-day pattern: idempotent, deterministic, §2-clean
 * static `claudeReasoning` (NOT Claude output), no positive event needed (the
 * discipline axis = addressed/total discrepancies, so the gap alone moves it).
 */
export async function scanMeetingNoShowsForAllMembers(
  options: { now?: Date } = {},
): Promise<MeetingNoShowScanResult> {
  const now = options.now ?? new Date();
  const windowMs = MEETING_WINDOW_DAYS * MS_PER_DAY;
  // Window closes at scheduledAt + 30d → scan scheduledAt ∈ [now−(30+LB)d, now−30d).
  const closedFrom = new Date(
    now.getTime() - windowMs - MEETING_MISS_SCAN_LOOKBACK_DAYS * MS_PER_DAY,
  );
  const closedTo = new Date(now.getTime() - windowMs);

  const meetings = await db.meeting.findMany({
    where: { status: 'scheduled', scheduledAt: { gte: closedFrom, lt: closedTo } },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
  });
  if (meetings.length === 0) {
    return { membersScanned: 0, meetingsClosed: 0, discrepanciesCreated: 0, errors: 0 };
  }

  const members = await db.user.findMany({
    where: { status: 'active', role: 'member' },
    select: { id: true, joinedAt: true },
  });

  const memberIds = members.map((mem) => mem.id);
  const meetingIds = meetings.map((m) => m.id);

  try {
    // BATCHED reads (S10 N+1 canon — the ritual scan above batches the same way):
    // ONE query for every member's COMPLETE attendances over the closing
    // meetings, ONE for the gaps already materialised. No per-member round-trip.
    const [completeAttendances, existingGaps] = await Promise.all([
      db.meetingAttendance.findMany({
        where: {
          userId: { in: memberIds },
          meetingId: { in: meetingIds },
          // Complete = attended (live OR replay) AND content reviewed (mirror service.ts).
          attendanceMode: { not: null },
          contentReviewed: true,
        },
        select: { userId: true, meetingId: true },
      }),
      db.discrepancy.findMany({
        where: { memberId: { in: memberIds }, meetingId: { in: meetingIds } },
        select: { memberId: true, meetingId: true },
      }),
    ]);

    const completeByMember = new Map<string, Set<string>>();
    for (const a of completeAttendances) {
      let set = completeByMember.get(a.userId);
      if (!set) {
        set = new Set<string>();
        completeByMember.set(a.userId, set);
      }
      set.add(a.meetingId);
    }
    const existingKeys = new Set(existingGaps.map((d) => `${d.memberId}|${d.meetingId}`));

    // Build every gap in memory; the `@@unique([memberId, meetingId])` index +
    // `skipDuplicates` make the insert idempotent (a re-run / band overlap
    // inserts 0 duplicates), so no per-row try/catch and no per-member dedup
    // query are needed — the whole scan is now ~3 constant-count queries.
    const toCreate = members.flatMap((member) => {
      const joinFloor = meetingJoinFloor(member.joinedAt).getTime();
      const completed = completeByMember.get(member.id);
      return meetings
        .filter(
          (m) =>
            // Expected (held on/after the join day) + no complete attendance + fresh.
            m.scheduledAt.getTime() >= joinFloor &&
            !completed?.has(m.id) &&
            !existingKeys.has(`${member.id}|${m.id}`),
        )
        .map((m) => ({
          memberId: member.id,
          type: 'meeting_missed_no_reason' as const,
          meetingId: m.id,
          severity: 1,
          // Detection instant (≈ window close) so the gap lands in the constancy
          // (28d) + alert (14d) windows, not the old meeting date.
          detectedAt: now,
          claudeReasoning: `Une réunion programmée le ${MEETING_DATE_FMT.format(m.scheduledAt)} n'a pas été suivie (ni en direct ni en replay) dans le délai de rattrapage de 30 jours, sans motif déclaré.`,
        }));
    });

    let discrepanciesCreated = 0;
    if (toCreate.length > 0) {
      const result = await db.discrepancy.createMany({ data: toCreate, skipDuplicates: true });
      discrepanciesCreated = result.count;
    }

    return {
      membersScanned: members.length,
      meetingsClosed: meetings.length,
      discrepanciesCreated,
      errors: 0,
    };
  } catch (err) {
    // Isolate a scan failure from the rest of the cron (mirror the sibling
    // scans' error-count contract — never 500 the whole verification run).
    reportError(
      'verification.constancy.meetings',
      err instanceof Error ? err : new Error('meeting_noshow_scan_failed'),
      { meetingsClosed: meetings.length },
    );
    return {
      membersScanned: members.length,
      meetingsClosed: meetings.length,
      discrepanciesCreated: 0,
      errors: 1,
    };
  }
}

// =============================================================================
// 1ter. Tracking-instrument skip scan (vérification généralisée §32 — the S2
//        universal tracking engine, beyond check-ins/meetings)
// =============================================================================

/**
 * Rattrapage grace AFTER a recurring tracking occurrence's period closes before a
 * skip becomes a discrepancy. A FULL extra period for weekly (the member had the
 * whole week the instrument was due, PLUS the following week) — calm, §31.2: never
 * accused the instant the period ends.
 */
export const TRACKING_SKIP_GRACE_DAYS = 7;
const DAILY_TRACKING_SKIP_GRACE_DAYS = 2;
/** Never back-accuse a skip older than the discipline window (aligned 28 j). */
export const TRACKING_SKIP_LOOKBACK_DAYS = DISCIPLINE_WINDOW_DAYS;

export interface TrackingSkipScanResult {
  readonly membersScanned: number;
  readonly instrumentsScanned: number;
  readonly discrepanciesCreated: number;
  readonly errors: number;
}

/**
 * THE dedup key of a tracking skip — one gap per (member, instrument, occurrence).
 * Stored in `Discrepancy.trackingRef`; the `@@unique([memberId, trackingRef])`
 * index makes a re-run / band overlap a no-op (NULL for every other type).
 */
export function trackingSkipRef(instrumentKey: string, occurrenceKey: string): string {
  return `${instrumentKey}@${occurrenceKey}`;
}

// Period labels are formatted in the UTC frame because `periodStartUtc` /
// `periodEndUtc` are UTC-midnight PINS of the civil date (see cadence.ts) — a
// member-facing date, never the raw ISO occurrence key (`2026-W24`).
const TRACKING_PERIOD_DAY_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  timeZone: 'UTC',
});
const TRACKING_PERIOD_FULL_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Human FR period label for a skip — « du 8 au 14 juin 2026 » (weekly) or
 *  « du 18 juin 2026 » (daily). The ISO key stays in `trackingRef` for dedup. */
function trackingSkipPeriodLabel(
  periodStartUtc: Date,
  periodEndUtc: Date,
  isWeekly: boolean,
): string {
  if (!isWeekly) return `du ${TRACKING_PERIOD_FULL_FMT.format(periodStartUtc)}`;
  // The displayed last day is the Sunday: the period end pin is the NEXT Monday.
  const lastDay = new Date(periodEndUtc.getTime() - MS_PER_DAY);
  return `de la semaine du ${TRACKING_PERIOD_DAY_FMT.format(periodStartUtc)} au ${TRACKING_PERIOD_FULL_FMT.format(lastDay)}`;
}

/**
 * S3 §32 — "applique le même principe de preuve à l'ensemble des données, pas
 * seulement les trades ; quand le membre ne remplit rien sans motif valable → un
 * manque de discipline qui fait baisser son score de constance". The S2 universal
 * tracking engine (recurring instruments, e.g. the weekly `process-fidelity`) is
 * member-declarative data exactly like a check-in or a meeting — a DUE occurrence
 * left unfilled past its rattrapage grace, without a reason, becomes a
 * `tracking_skipped_no_reason` Discrepancy: EXCUSABLE (`memberReason` → the score
 * recovers, §29), strictly fed into the existing DISCIPLINE axis + repetition
 * alert. NEVER fires while the occurrence is still in grace nor for a SNOOZED
 * instrument (calm self-pacing is never penalised, §2).
 *
 * Mirrors the meeting no-show scan: idempotent, deterministic, §2-clean static
 * `claudeReasoning` (NOT Claude output), no positive ScoreEvent (the discipline
 * axis = addressed/total discrepancies, so the gap alone moves it). Batched reads
 * (S10 N+1 canon → ~constant query count).
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): this scan reads tracking COMPLETION metadata
 * ONLY — the existence of an occurrence key (`userId`/`instrumentKey`/
 * `occurrenceKey`) and the snooze date. It NEVER selects `responses` /
 * `confidenceLevel` / any capture CONTENT, so no tracked self-assessment can leak
 * into scoring. Occurrence keys are computed in the MEMBER's timezone — identical
 * to how `submitTrackingEntry` keys their entries — so existence checks line up.
 */
export async function scanTrackingSkipsForAllMembers(
  options: { now?: Date } = {},
): Promise<TrackingSkipScanResult> {
  const now = options.now ?? new Date();

  // Only recurring (schedule-swept) instruments can be "skipped" on a cadence.
  const instruments = getCurrentInstruments().filter(
    (i) => i.cadence.kind === 'weekly' || i.cadence.kind === 'daily',
  );
  if (instruments.length === 0) {
    return { membersScanned: 0, instrumentsScanned: 0, discrepanciesCreated: 0, errors: 0 };
  }

  const members = await db.user.findMany({
    where: { status: 'active', role: 'member' },
    select: { id: true, joinedAt: true, createdAt: true, timezone: true },
  });
  if (members.length === 0) {
    return {
      membersScanned: 0,
      instrumentsScanned: instruments.length,
      discrepanciesCreated: 0,
      errors: 0,
    };
  }

  try {
    interface SkipCandidate {
      readonly memberId: string;
      readonly instrumentKey: string;
      readonly occurrenceKey: string;
      readonly ref: string;
      readonly instrumentTitle: string;
      readonly periodStartUtc: Date;
      readonly periodEndUtc: Date;
      readonly isWeekly: boolean;
    }
    const candidates: SkipCandidate[] = [];
    const memberIds = members.map((m) => m.id);

    for (const member of members) {
      const tz = member.timezone || 'Europe/Paris';
      // Owe an occurrence only if the member's LOCAL join day is on/before the
      // period's start day. Floor the join to the SAME frame as `periodStartUtc`
      // (UTC-midnight pin of the civil date in the member's own timezone) so the
      // comparison is an exact civil-date one. A raw timestamp would mis-bucket a
      // member west of UTC whose join instant crosses the UTC-midnight pin —
      // mirrors the meeting scan's `meetingJoinFloor` day-floor invariant.
      const joinFloorMs = localDateToUtcMidnight(
        localDateOf(member.joinedAt ?? member.createdAt, tz),
      ).getTime();
      for (const instrument of instruments) {
        const isWeekly = instrument.cadence.kind === 'weekly';
        const graceMs =
          (isWeekly ? TRACKING_SKIP_GRACE_DAYS : DAILY_TRACKING_SKIP_GRACE_DAYS) * MS_PER_DAY;
        const occurrences = listClosedOccurrences(instrument.cadence, now, tz, {
          graceMs,
          lookbackMs: TRACKING_SKIP_LOOKBACK_DAYS * MS_PER_DAY,
        });
        for (const occ of occurrences) {
          if (occ.periodStartUtc.getTime() < joinFloorMs) continue;
          candidates.push({
            memberId: member.id,
            instrumentKey: instrument.key,
            occurrenceKey: occ.key,
            ref: trackingSkipRef(instrument.key, occ.key),
            instrumentTitle: instrument.title,
            periodStartUtc: occ.periodStartUtc,
            periodEndUtc: occ.periodEndUtc,
            isWeekly,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return {
        membersScanned: members.length,
        instrumentsScanned: instruments.length,
        discrepanciesCreated: 0,
        errors: 0,
      };
    }

    const instrumentKeys = [...new Set(candidates.map((c) => c.instrumentKey))];
    const occurrenceKeys = [...new Set(candidates.map((c) => c.occurrenceKey))];
    const refs = [...new Set(candidates.map((c) => c.ref))];

    // BATCHED reads (constant query count regardless of member count):
    //  1. occurrences the member ALREADY filled — completion metadata ONLY
    //     (no `responses`/`confidenceLevel`, §21.5 isolation by construction);
    //  2. instruments the member SNOOZED (a calm pause is never penalised, §2);
    //  3. skip discrepancies already materialised (idempotence backstop on top
    //     of the `@@unique([memberId, trackingRef])` index).
    const [filledEntries, schedules, existingSkips] = await Promise.all([
      db.trackingEntry.findMany({
        where: {
          userId: { in: memberIds },
          instrumentKey: { in: instrumentKeys },
          occurrenceKey: { in: occurrenceKeys },
        },
        select: { userId: true, instrumentKey: true, occurrenceKey: true },
      }),
      db.trackingSchedule.findMany({
        where: { userId: { in: memberIds }, instrumentKey: { in: instrumentKeys } },
        select: { userId: true, instrumentKey: true, pausedUntil: true },
      }),
      db.discrepancy.findMany({
        where: { memberId: { in: memberIds }, trackingRef: { in: refs } },
        select: { memberId: true, trackingRef: true },
      }),
    ]);

    const filledKeys = new Set(
      filledEntries.map((e) => `${e.userId}|${e.instrumentKey}|${e.occurrenceKey}`),
    );
    const pausedUntilByKey = new Map<string, Date | null>();
    for (const s of schedules) {
      pausedUntilByKey.set(`${s.userId}|${s.instrumentKey}`, s.pausedUntil);
    }
    const existingRefs = new Set(existingSkips.map((d) => `${d.memberId}|${d.trackingRef}`));

    const toCreate = candidates
      .filter((c) => {
        // Already filled → not a skip.
        if (filledKeys.has(`${c.memberId}|${c.instrumentKey}|${c.occurrenceKey}`)) return false;
        // Snoozed THROUGH the period end → calm pause, never accused (§2/§33.6).
        const paused = pausedUntilByKey.get(`${c.memberId}|${c.instrumentKey}`);
        if (paused && paused.getTime() >= c.periodEndUtc.getTime()) return false;
        // Already materialised (idempotent).
        if (existingRefs.has(`${c.memberId}|${c.ref}`)) return false;
        return true;
      })
      .map((c) => ({
        memberId: c.memberId,
        type: 'tracking_skipped_no_reason' as const,
        trackingRef: c.ref,
        severity: 1,
        // Detection instant (≈ grace close) so the gap lands in the constancy
        // (28 j) + alert (14 j) windows — mirror the meeting no-show scan.
        detectedAt: now,
        claudeReasoning: `L'instrument de suivi « ${c.instrumentTitle} » ${trackingSkipPeriodLabel(
          c.periodStartUtc,
          c.periodEndUtc,
          c.isWeekly,
        )} n'a pas été rempli dans le délai de rattrapage, sans motif déclaré.`,
      }));

    let discrepanciesCreated = 0;
    if (toCreate.length > 0) {
      const result = await db.discrepancy.createMany({ data: toCreate, skipDuplicates: true });
      discrepanciesCreated = result.count;
    }

    return {
      membersScanned: members.length,
      instrumentsScanned: instruments.length,
      discrepanciesCreated,
      errors: 0,
    };
  } catch (err) {
    // Isolate a scan failure (mirror the sibling scans' error-count contract —
    // never 500 the whole verification run).
    reportError(
      'verification.constancy.tracking',
      err instanceof Error ? err : new Error('tracking_skip_scan_failed'),
      { instruments: instruments.length },
    );
    return {
      membersScanned: members.length,
      instrumentsScanned: instruments.length,
      discrepanciesCreated: 0,
      errors: 1,
    };
  }
}

// =============================================================================
// 2. Weekly fold → ConstancyScore upsert
// =============================================================================

export interface ConstancyBreakdown {
  readonly honesty: number | null;
  readonly regularity: number | null;
  readonly discipline: number | null;
}

export interface FoldInputEvent {
  readonly reason: 'filled' | 'forgot_no_reason' | 'reality_gap' | 'false_declaration';
  /** true when the linked discrepancy carries a member reason (excused). */
  readonly excused: boolean;
}

/**
 * Pure fold — unit-testable (DoD §31 #3 « le score monte et descend »).
 * `everConfronted` gates the honesty axis (§33.6: no proof ⇒ no honesty
 * verdict, never a fake 100).
 */
export function foldConstancy(
  events: readonly FoldInputEvent[],
  context: { everConfronted: boolean; discrepancies28d: { total: number; addressed: number } },
): { value: number | null; breakdown: ConstancyBreakdown } {
  const filled = events.filter((e) => e.reason === 'filled').length;
  const forgot = events.filter((e) => e.reason === 'forgot_no_reason' && !e.excused).length;
  const realityGaps = events.filter((e) => e.reason === 'reality_gap' && !e.excused).length;
  const falseDecls = events.filter((e) => e.reason === 'false_declaration' && !e.excused).length;

  const regularity = filled + forgot > 0 ? (filled / (filled + forgot)) * 100 : null;

  const honesty = context.everConfronted
    ? Math.max(
        0,
        100 -
          HONESTY_PENALTY_REALITY_GAP * realityGaps -
          HONESTY_PENALTY_FALSE_DECLARATION * falseDecls,
      )
    : null;

  const discipline =
    context.discrepancies28d.total > 0
      ? (context.discrepancies28d.addressed / context.discrepancies28d.total) * 100
      : null;

  const axes: Array<[number | null, number]> = [
    [honesty, CONSTANCY_WEIGHTS.honesty],
    [regularity, CONSTANCY_WEIGHTS.regularity],
    [discipline, CONSTANCY_WEIGHTS.discipline],
  ];
  const present = axes.filter((a): a is [number, number] => a[0] !== null);
  const totalWeight = present.reduce((s, [, w]) => s + w, 0);
  const value =
    present.length > 0 ? present.reduce((s, [v, w]) => s + v * (w / totalWeight), 0) : null;

  return {
    value: value === null ? null : Math.round(value * 10) / 10,
    breakdown: { honesty, regularity, discipline },
  };
}

export interface ConstancyRecomputeResult {
  readonly membersScanned: number;
  readonly scoresUpserted: number;
  readonly errors: number;
}

/** ISO-week Monday (Paris) for the period containing `now`. */
export function currentPeriodStart(now: Date): string {
  let day = localDateOf(now, 'Europe/Paris');
  // Walk back to Monday (getUTCDay on the parsed local date is stable: the
  // parse anchors at UTC midnight of the civil day).
  while (parseLocalDate(day).getUTCDay() !== 1) {
    day = shiftLocalDate(day, -1);
  }
  return day;
}

export async function recomputeConstancyForAllMembers(
  options: { now?: Date } = {},
): Promise<ConstancyRecomputeResult> {
  const now = options.now ?? new Date();
  const periodStartLocal = currentPeriodStart(now);
  const periodEndLocal = shiftLocalDate(periodStartLocal, 6);
  const periodStart = parseLocalDate(periodStartLocal);
  const periodEnd = parseLocalDate(periodEndLocal);
  // Events are timestamped (createdAt); the window covers the civil week.
  const windowStart = periodStart;
  const windowEnd = parseLocalDate(shiftLocalDate(periodStartLocal, 7));

  const members = await db.user.findMany({
    where: { status: 'active', role: 'member' },
    select: { id: true },
  });

  let scoresUpserted = 0;
  let errors = 0;

  // Chunked-parallel per member (throughput at scale); `scoresUpserted` is
  // mutated in the closure with its EXACT original placement (after the upsert,
  // before logAudit), so a logAudit failure tallies identically to the former
  // sequential loop. Synchronous `+=` between awaits is atomic under JS's
  // cooperative scheduling. Only error handling moves to the settled zip.
  const settled = await mapMembersChunked(members, async (member) => {
    const [events, confrontedCount, discrepancies] = await Promise.all([
      db.scoreEvent.findMany({
        where: { memberId: member.id, createdAt: { gte: windowStart, lt: windowEnd } },
        select: {
          reason: true,
          relatedDiscrepancy: { select: { memberReason: true, status: true } },
        },
      }),
      db.extractedPosition.count({ where: { brokerAccount: { memberId: member.id } } }),
      db.discrepancy.findMany({
        where: {
          memberId: member.id,
          detectedAt: { gte: new Date(now.getTime() - DISCIPLINE_WINDOW_DAYS * 86_400_000) },
        },
        select: { status: true, memberReason: true },
      }),
    ]);

    const folded = foldConstancy(
      events.map((e) => ({
        reason: e.reason,
        // Excused = member gave a valid reason OR the accusation was
        // RETRACTED by reality itself (reconcile resolved it — the proof
        // arrived later and confirmed the trade; the member must not have
        // to self-excuse for our own premature verdict).
        excused:
          e.relatedDiscrepancy?.memberReason != null || e.relatedDiscrepancy?.status === 'resolved',
      })),
      {
        everConfronted: confrontedCount > 0,
        discrepancies28d: {
          total: discrepancies.length,
          addressed: discrepancies.filter((d) => d.status !== 'open' || d.memberReason !== null)
            .length,
        },
      },
    );

    // No signal at all → no row (a fake neutral score would be complaisance).
    if (folded.value === null) return;

    // Plain-object cast for the Prisma Json column (mirror engine.ts canon).
    const breakdownJson = folded.breakdown as unknown as object;
    await db.constancyScore.upsert({
      where: { memberId_periodStart: { memberId: member.id, periodStart } },
      create: {
        memberId: member.id,
        value: folded.value,
        breakdown: breakdownJson,
        periodStart,
        periodEnd,
      },
      update: {
        value: folded.value,
        breakdown: breakdownJson,
        periodEnd,
        computedAt: now,
      },
    });
    scoresUpserted += 1;
    await logAudit({
      action: 'verification.score.computed',
      userId: member.id,
      metadata: {
        periodStart: periodStartLocal,
        value: folded.value,
        // Count-only breakdown — PII-free by construction.
        honesty: folded.breakdown.honesty,
        regularity: folded.breakdown.regularity,
        discipline: folded.breakdown.discipline,
      },
    });
  });
  settled.forEach((s, idx) => {
    if (s.status === 'rejected') {
      errors += 1;
      reportError(
        'verification.constancy.recompute',
        s.reason instanceof Error ? s.reason : new Error('constancy_recompute_failed'),
        { memberId: members[idx]!.id },
      );
    }
  });

  return { membersScanned: members.length, scoresUpserted, errors };
}

// =============================================================================
// Member-facing reads
// =============================================================================

export interface ConstancyScoreView {
  readonly value: number;
  readonly breakdown: ConstancyBreakdown;
  readonly periodStart: Date;
  readonly computedAt: Date;
}

export interface ScoreEventView {
  readonly id: string;
  readonly delta: number;
  readonly reason: 'filled' | 'forgot_no_reason' | 'reality_gap' | 'false_declaration';
  /** Mirror of the weekly fold's excusal rule — member reason given OR the
   *  accusation was retracted by reality (`resolved`). */
  readonly excused: boolean;
  readonly createdAt: Date;
}

/**
 * S4 (DOD3-T3-02) — the schema's promise « keeps the score explainable to
 * the member » made real: the most recent events feeding « Pourquoi ton
 * score bouge » on /verification. Applies the SAME excusal rule as the
 * weekly fold (constancy stays one single story).
 */
export async function listRecentScoreEvents(
  memberId: string,
  take = 8,
): Promise<readonly ScoreEventView[]> {
  const rows = await db.scoreEvent.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      delta: true,
      reason: true,
      createdAt: true,
      relatedDiscrepancy: { select: { memberReason: true, status: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason,
    excused:
      r.relatedDiscrepancy?.memberReason != null || r.relatedDiscrepancy?.status === 'resolved',
    createdAt: r.createdAt,
  }));
}

/** Map a `ConstancyScore` row (Json `breakdown`) to the count-only view. */
function toConstancyScoreView(row: {
  value: number;
  breakdown: unknown;
  periodStart: Date;
  computedAt: Date;
}): ConstancyScoreView {
  const breakdown = row.breakdown as {
    honesty?: unknown;
    regularity?: unknown;
    discipline?: unknown;
  };
  const axis = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    value: row.value,
    breakdown: {
      honesty: axis(breakdown?.honesty),
      regularity: axis(breakdown?.regularity),
      discipline: axis(breakdown?.discipline),
    },
    periodStart: row.periodStart,
    computedAt: row.computedAt,
  };
}

export async function getLatestConstancyScore(
  memberId: string,
): Promise<ConstancyScoreView | null> {
  const row = await db.constancyScore.findFirst({
    where: { memberId },
    orderBy: { periodStart: 'desc' },
    select: { value: true, breakdown: true, periodStart: true, computedAt: true },
  });
  return row ? toConstancyScoreView(row) : null;
}

/**
 * S6 (DOD3-01) — the ConstancyScore rows whose ISO-week `periodStart` falls in
 * `[rangeStart, rangeEnd]` (inclusive), oldest→newest. Powers the **retrospective
 * reports** (weekly/monthly): the score is folded PER ISO-WEEK
 * (`recomputeConstancyForAllMembers` upserts on `(memberId, periodStart)`), so a
 * report covering a PAST period must read the score OF THAT PERIOD — NOT
 * `getLatestConstancyScore` (which always returns the current ISO week and would
 * mis-label "ta constance de mai" with this week's value). The weekly report
 * passes its single ISO week (≤1 row); the monthly report passes the civil month
 * (~4-5 rows) and reads the latest in range. Count-only / posture §33.2 — the
 * value + breakdown are factual numbers, never a guilt counter or market view.
 */
export async function listConstancyScoresInRange(
  memberId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<readonly ConstancyScoreView[]> {
  const rows = await db.constancyScore.findMany({
    where: { memberId, periodStart: { gte: rangeStart, lte: rangeEnd } },
    orderBy: { periodStart: 'asc' },
    select: { value: true, breakdown: true, periodStart: true, computedAt: true },
  });
  return rows.map(toConstancyScoreView);
}

/**
 * S4 — the last `take` weekly `ConstancyScore` rows, oldest→newest, for the
 * MEMBER trajectory on `/verification` (« voir l'évolution », brief §29). The
 * snapshot (`getLatestConstancyScore`) answers « où j'en suis cette semaine » ;
 * this answers « comment ça bouge dans le temps » — the same gap the behavioral
 * `ScoreTrendChart` already fills on `/progression`. Take-based (not date-range)
 * so it returns exactly the most recent weeks regardless of gaps in the fold.
 * Posture §33.2 : factual numbers, never a streak or a guilt curve.
 */
export async function listRecentConstancyScores(
  memberId: string,
  take = 12,
): Promise<readonly ConstancyScoreView[]> {
  const rows = await db.constancyScore.findMany({
    where: { memberId },
    orderBy: { periodStart: 'desc' },
    take,
    select: { value: true, breakdown: true, periodStart: true, computedAt: true },
  });
  // DB returns newest→oldest for the `take`; the trajectory reads oldest→newest.
  return rows.reverse().map(toConstancyScoreView);
}
