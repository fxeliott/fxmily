/**
 * Tour 15 — ONE-SHOT backfill: recompute the STORED weekly `ConstancyScore`
 * rows with the off-aware fold, so the penalties the daily scan created on
 * members' OFF days BEFORE the fold became off-aware stop dragging the score.
 * The recompute is the ONLY write: the underlying discrepancies are left
 * untouched (the off-aware fold excuses them with zero mutation — see P1-b).
 *
 * WHY: until Tour 15 the ritual scan already skipped off days, but a member who
 * declared a day off retroactively (or whose past week-ends predate the off-day
 * feature) still carried `unfilled_no_reason` blank-day discrepancies + linked
 * `forgot_no_reason` ScoreEvents that dragged their STORED weekly score down.
 * The demo member showed 14/100 with two « Journée sans suivi » events on a
 * SATURDAY. Recomputing the stored rows with the off-aware fold clears that.
 *
 * WHAT it does, per active member:
 *   1. Recomputes the STORED weekly `ConstancyScore` of the last 8 CLOSED ISO
 *      weeks with the off-aware fold (a weekend/declared-off forgot event no
 *      longer penalizes regularity; an off-day blank-day gap drops out of
 *      discipline). It reports, informationally, how many off-day blank-day gaps
 *      it saw per member — but it MUTATES NOTHING beyond the stored score rows.
 *
 * WHAT it deliberately does NOT do (review P1-b, Tour 15):
 *   - It does NOT flip off-day `unfilled_no_reason` discrepancies to
 *     `status = resolved`. The off-aware fold already neutralizes those gaps
 *     with ZERO mutation (see lib/verification/constancy.ts:926-927 for the
 *     discipline denominator, and `isEventExcused`'s `off_day` branch for the
 *     linked `forgot_no_reason` events). Writing `resolved` would be redundant
 *     for the score AND actively wrong for the member feed: the feed's label
 *     precedence (constancy.ts:1054) would show « excusé, levé par la réalité »
 *     instead of the true « jour off, rien à rattraper ». Leaving the gap `open`
 *     lets the off-day rule tell the honest story — and stays correct if the
 *     member later flips `weekendsOff` back off (no excuse frozen in the row).
 *
 * WHY only CLOSED weeks (review P1-a, Tour 15):
 *   The canonical fold anchors the 28-day discipline window at `now`
 *   (lib/verification/constancy.ts:894). Reproducing that per past week means
 *   anchoring at each week's end. For a week that is still OPEN (its Sunday is
 *   in the future vs. `now`), the two anchors diverge, so this backfill and the
 *   nightly cron would compute different values and flip-flop the member's score
 *   between runs. We therefore skip the current (open) ISO week entirely and
 *   leave it to the next cron pass, which owns the live value.
 *
 * The fold formula + off predicate are re-stated inline here (kept byte-faithful
 * to `lib/verification/constancy.ts` — the source of truth) because that module
 * is `server-only` and cannot be imported from a tsx script. If the canonical
 * formula changes, update BOTH.
 *
 * SAFETY: DRY-RUN by default. Prints exactly what WOULD change, per member.
 * Pass `--apply` to write. Idempotent: a second run (with or without --apply)
 * recomputes the same values and writes nothing new.
 *
 * Usage (prod, from the web container):
 *   # dry-run (default) — inspect the plan, writes NOTHING
 *   docker compose exec -T web pnpm --filter @fxmily/web exec tsx scripts/backfill-offday-constancy.ts
 *   # apply
 *   docker compose exec -T web pnpm --filter @fxmily/web exec tsx scripts/backfill-offday-constancy.ts --apply
 *
 * Local:
 *   $env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
 *   pnpm --filter @fxmily/web exec tsx scripts/backfill-offday-constancy.ts [--apply]
 */

import { db } from '../src/lib/db.js';

const APPLY = process.argv.includes('--apply');
const WEEKS_BACK = 8;
const DISCIPLINE_WINDOW_DAYS = 28;
const MS_PER_DAY = 86_400_000;

// Fold weights — MUST mirror lib/verification/constancy.ts (source of truth).
const HONESTY_PENALTY_REALITY_GAP = 15;
const HONESTY_PENALTY_FALSE_DECLARATION = 40;
const CONSTANCY_WEIGHTS = { honesty: 0.4, regularity: 0.35, discipline: 0.25 } as const;

// ---------------------------------------------------------------------------
// Pure date helpers (UTC-midnight civil-day frame, like @db.Date columns).
// ---------------------------------------------------------------------------

type LocalDate = string; // YYYY-MM-DD

function dbDateToLocal(d: Date): LocalDate {
  return d.toISOString().slice(0, 10);
}

function parseLocal(s: LocalDate): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function shiftLocal(s: LocalDate, days: number): LocalDate {
  return dbDateToLocal(new Date(parseLocal(s).getTime() + days * MS_PER_DAY));
}

/** Civil day (Europe/Paris) of a UTC instant — ScoreEvent.createdAt is a Paris
 *  midnight pin, so this recovers the ritual day. */
function parisLocalDate(instant: Date): LocalDate {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = fmt.formatToParts(instant);
  const y = p.find((x) => x.type === 'year')?.value ?? '0000';
  const m = p.find((x) => x.type === 'month')?.value ?? '01';
  const d = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

/** ISO-week Monday (Paris) of a civil day. */
function isoMonday(local: LocalDate): LocalDate {
  let day = local;
  while (parseLocal(day).getUTCDay() !== 1) day = shiftLocal(day, -1);
  return day;
}

function isWeekend(local: LocalDate): boolean {
  const dow = parseLocal(local).getUTCDay();
  return dow === 0 || dow === 6;
}

interface OffContext {
  weekendsOff: boolean;
  explicitDates: Set<LocalDate>;
}

/** Mirror of lib/checkin/off-days.ts:isOffDay. */
function isOffDay(local: LocalDate, off: OffContext): boolean {
  if (off.explicitDates.has(local)) return true;
  return off.weekendsOff && isWeekend(local);
}

/** Mirror of lib/verification/constancy.ts:isEventExcused. */
function isExcused(
  memberReason: string | null,
  status: string,
  eventLocal: LocalDate,
  off: OffContext,
): boolean {
  if (memberReason != null || status === 'resolved') return true;
  return isOffDay(eventLocal, off);
}

interface FoldEvent {
  reason: 'filled' | 'forgot_no_reason' | 'reality_gap' | 'false_declaration';
  excused: boolean;
}

/** Mirror of lib/verification/constancy.ts:foldConstancy. */
function foldConstancy(
  events: FoldEvent[],
  ctx: { everConfronted: boolean; discrepancies28d: { total: number; addressed: number } },
): {
  value: number | null;
  breakdown: { honesty: number | null; regularity: number | null; discipline: number | null };
} {
  const filled = events.filter((e) => e.reason === 'filled').length;
  const forgot = events.filter((e) => e.reason === 'forgot_no_reason' && !e.excused).length;
  const realityGaps = events.filter((e) => e.reason === 'reality_gap' && !e.excused).length;
  const falseDecls = events.filter((e) => e.reason === 'false_declaration' && !e.excused).length;

  const regularity = filled + forgot > 0 ? (filled / (filled + forgot)) * 100 : null;
  const honesty = ctx.everConfronted
    ? Math.max(
        0,
        100 -
          HONESTY_PENALTY_REALITY_GAP * realityGaps -
          HONESTY_PENALTY_FALSE_DECLARATION * falseDecls,
      )
    : null;
  const discipline =
    ctx.discrepancies28d.total > 0
      ? (ctx.discrepancies28d.addressed / ctx.discrepancies28d.total) * 100
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

// ---------------------------------------------------------------------------

async function main() {
  console.log(`[backfill-offday] mode = ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}`);

  const today = parisLocalDate(new Date());
  const currentMonday = isoMonday(today);
  // P1-a — the current ISO week is OPEN (its Sunday is in the future vs `now`),
  // so its discipline window can't match the cron's `now`-anchored one. We only
  // backfill CLOSED weeks: the most recent closed week is the one before the
  // current Monday. `lastClosedMonday` is the newest week we recompute.
  const lastClosedMonday = shiftLocal(currentMonday, -7);
  const firstMonday = shiftLocal(lastClosedMonday, -7 * (WEEKS_BACK - 1));
  const windowFromLocal = shiftLocal(firstMonday, -(DISCIPLINE_WINDOW_DAYS - 1));
  const windowFrom = parseLocal(windowFromLocal);
  // Exclusive upper bound = start of the current (open) week, so the off-day and
  // discrepancy lookbacks never reach into the week we deliberately skip.
  const windowEnd = parseLocal(currentMonday);

  console.log(
    `[backfill-offday] scanning ${WEEKS_BACK} CLOSED ISO weeks ${firstMonday} .. ${lastClosedMonday} (current open week ${currentMonday} left to the cron; off/discipline lookback from ${windowFromLocal})`,
  );

  const members = await db.user.findMany({
    where: { status: 'active', role: 'member' },
    select: { id: true, email: true, weekendsOff: true },
  });

  let totalOffDayGaps = 0;
  let totalScoresRecomputed = 0;

  for (const member of members) {
    // Resolve the member's off-day context over the whole lookback window.
    const offRows = await db.memberOffDay.findMany({
      where: { userId: member.id, date: { gte: windowFrom, lt: windowEnd } },
      select: { date: true },
    });
    const off: OffContext = {
      weekendsOff: member.weekendsOff,
      explicitDates: new Set(offRows.map((r) => dbDateToLocal(r.date))),
    };

    // (a) INFORMATIONAL ONLY — count the blank-day (`unfilled_no_reason`) gaps
    //     that fall on this member's off days. We do NOT mutate them (P1-b): the
    //     off-aware fold below excuses them with zero writes, and leaving them
    //     `open` keeps the member feed's motif honest (« jour off » via the
    //     off_day rule, not « levé par la réalité » that a `resolved` flip would
    //     force). This is a visibility line for the operator, nothing more.
    const blankGaps = await db.discrepancy.findMany({
      where: {
        memberId: member.id,
        type: 'unfilled_no_reason',
        detectedAt: { gte: windowFrom, lt: windowEnd },
        status: { not: 'resolved' },
      },
      select: { id: true, detectedAt: true, status: true },
    });
    const offDayGaps = blankGaps.filter((g) => isOffDay(dbDateToLocal(g.detectedAt), off));

    if (offDayGaps.length > 0) {
      console.log(
        `[backfill-offday] ${member.email}: ${offDayGaps.length} blank-day gap(s) on off days (left open — excused by the off-aware fold, no mutation)`,
      );
      for (const g of offDayGaps) {
        console.log(`    - gap ${g.id} on ${dbDateToLocal(g.detectedAt)} (${g.status})`);
      }
      totalOffDayGaps += offDayGaps.length;
    }

    // (b) recompute the stored ConstancyScore of the last WEEKS_BACK CLOSED ISO
    //     weeks with the off-aware fold. This is the ONLY write path (score
    //     rows). It runs AFTER (a) purely for readable logging order — there is
    //     no data dependency between them, since (a) mutates nothing, so
    //     idempotence holds regardless. Read confrontation once (member-global).
    const confrontedCount = await db.extractedPosition.count({
      where: { brokerAccount: { memberId: member.id } },
    });

    for (let w = 0; w < WEEKS_BACK; w++) {
      // Anchor on the last CLOSED week (P1-a): w=0 is the most recent closed
      // week, never the current open one.
      const weekMondayLocal = shiftLocal(lastClosedMonday, -7 * w);
      const weekStart = parseLocal(weekMondayLocal);
      const weekEndExclusive = parseLocal(shiftLocal(weekMondayLocal, 7));
      const weekEnd = parseLocal(shiftLocal(weekMondayLocal, 6));

      // Only recompute a week that already has a stored row (backfill STORED
      // scores; never invent a row for a silent week — matches the fold's
      // "no signal → no row" invariant).
      const existing = await db.constancyScore.findUnique({
        where: { memberId_periodStart: { memberId: member.id, periodStart: weekStart } },
        select: { id: true, value: true },
      });
      if (!existing) continue;

      const events = await db.scoreEvent.findMany({
        where: { memberId: member.id, createdAt: { gte: weekStart, lt: weekEndExclusive } },
        select: {
          reason: true,
          createdAt: true,
          relatedDiscrepancy: { select: { memberReason: true, status: true } },
        },
      });
      // Discipline window is 28 j ending at the week's Sunday (mirror the fold's
      // `now`-anchored window applied to the recomputed week's end).
      const disc28From = new Date(weekEnd.getTime() - DISCIPLINE_WINDOW_DAYS * MS_PER_DAY);
      const discrepancies = await db.discrepancy.findMany({
        where: { memberId: member.id, detectedAt: { gte: disc28From } },
        select: { status: true, memberReason: true, type: true, detectedAt: true },
      });

      const folded = foldConstancy(
        events.map((e) => ({
          reason: e.reason,
          excused: isExcused(
            e.relatedDiscrepancy?.memberReason ?? null,
            e.relatedDiscrepancy?.status ?? 'open',
            parisLocalDate(e.createdAt),
            off,
          ),
        })),
        {
          everConfronted: confrontedCount > 0,
          discrepancies28d: {
            total: discrepancies.length,
            addressed: discrepancies.filter(
              (d) =>
                d.status !== 'open' ||
                d.memberReason !== null ||
                (d.type === 'unfilled_no_reason' && isOffDay(dbDateToLocal(d.detectedAt), off)),
            ).length,
          },
        },
      );

      if (folded.value === null) continue; // keep the existing row untouched
      if (folded.value === existing.value) continue; // no change

      console.log(
        `[backfill-offday] ${member.email}: week ${weekMondayLocal} score ${existing.value} → ${folded.value}`,
      );
      if (APPLY) {
        await db.constancyScore.update({
          where: { id: existing.id },
          data: {
            value: folded.value,
            breakdown: folded.breakdown as unknown as object,
            computedAt: new Date(),
          },
        });
      }
      totalScoresRecomputed += 1;
    }
  }

  console.log(
    `[backfill-offday] done. members=${members.length} offDayGapsSeen=${totalOffDayGaps} (left open, not mutated) scoresRecomputed=${totalScoresRecomputed} ${
      APPLY ? '(APPLIED)' : '(dry-run — re-run with --apply to write)'
    }`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-offday] FAILED', err);
    process.exit(1);
  });
