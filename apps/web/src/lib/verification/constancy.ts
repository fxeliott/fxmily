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

  for (const member of members) {
    try {
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
        }
      }

      const events: Array<{
        id: string;
        memberId: string;
        delta: number;
        reason: 'filled' | 'forgot_no_reason';
        relatedDiscrepancyId: string | null;
      }> = [];
      for (const slot of ['morning', 'evening'] as const) {
        if (filledSlots.has(slot)) {
          events.push({
            id: ritualEventId('filled', member.id, yesterday, slot),
            memberId: member.id,
            delta: 1,
            reason: 'filled',
            relatedDiscrepancyId: null,
          });
        } else {
          events.push({
            id: ritualEventId('forgot_no_reason', member.id, yesterday, slot),
            memberId: member.id,
            delta: -1,
            reason: 'forgot_no_reason',
            relatedDiscrepancyId: blankDayDiscrepancyId,
          });
        }
      }

      await db.scoreEvent.createMany({ data: events, skipDuplicates: true });
      filledEvents += events.filter((e) => e.reason === 'filled').length;
      forgotEvents += events.filter((e) => e.reason === 'forgot_no_reason').length;
    } catch (err) {
      errors += 1;
      reportError(
        'verification.constancy.scan',
        err instanceof Error ? err : new Error('ritual_scan_failed'),
        { memberId: member.id },
      );
    }
  }

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

  for (const member of members) {
    try {
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
            e.relatedDiscrepancy?.memberReason != null ||
            e.relatedDiscrepancy?.status === 'resolved',
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
      if (folded.value === null) continue;

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
    } catch (err) {
      errors += 1;
      reportError(
        'verification.constancy.recompute',
        err instanceof Error ? err : new Error('constancy_recompute_failed'),
        { memberId: member.id },
      );
    }
  }

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
