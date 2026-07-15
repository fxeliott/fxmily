import 'server-only';

import { formatOffDayLabel } from '@/lib/checkin/off-day-label';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';
import { MAX_FREE_OFF_DAYS_PER_WINDOW, OFF_DAY_FORWARD_HORIZON_DAYS } from '@/lib/schemas/off-day';

/**
 * SCOPE 4 admin visibility (J3 "classement pour tous") — read-only summary of a
 * member's self-declared off days in the SAME forward window the cap is enforced
 * on. The declaration layer (`declareOffDay*Action`) makes a reason MANDATORY
 * beyond {@link MAX_FREE_OFF_DAYS_PER_WINDOW}; this surface lets the admin SEE
 * the atypical declarations (`overCap === true`) and read the reasons attached
 * to them — closing the "visible admin" half of the SPEC "Done quand" criterion.
 *
 * The over-cap flag is RECOMPUTED here from the live `MemberOffDay` rows
 * (`windowCount > MAX_FREE_OFF_DAYS_PER_WINDOW`), mirroring the EXACT boundary
 * the actions enforce (`existingOffDays + N > cap`) so the admin view can never
 * disagree with what the member actually experienced. It is a read model, never
 * a second cap — the anti-gaming lever lives entirely in the declaration layer,
 * NOT in the leaderboard gate math (settled #477/#479).
 */

/** One declared off day in the forward window, with its (optional) reason. */
export interface AdminOffDayEntry {
  /** Stored civil day as `YYYY-MM-DD` (UTC-midnight-pinned `@db.Date`). */
  date: string;
  /** Human FR label, e.g. "mardi 7 juillet" (shared formatter, UTC-pinned). */
  label: string;
  /** The member's free-text reason, or `null` when none was given. */
  reason: string | null;
}

/** Admin-facing summary of a member's forward-window off-day declarations. */
export interface MemberOffDayAdminSummary {
  /** The free cap (declarations at/below it need no reason). */
  cap: number;
  /** The rolling forward window, in civil days, the cap applies over. */
  horizonDays: number;
  /** How many off days the member has declared in `[today, today+horizon]`. */
  windowCount: number;
  /** `true` when the member front-loaded past the free cap (atypical signal). */
  overCap: boolean;
  /** The declared off days in the window, chronological, with their reasons. */
  upcoming: AdminOffDayEntry[];
}

/**
 * Load the admin over-cap summary for a member. Window `[today, today+30]` in
 * the MEMBER's timezone — the natural denominator for forward-declared off days,
 * identical to `countOffDaysInForwardWindow` in the action layer. Degrades to an
 * empty, not-over-cap summary on a DB hiccup (fail-open: an infra blip must never
 * paint a legitimate member as a gamer — mirrors the action `count_degraded`
 * posture). Read-only: no write, no audit — the caller page already audits the
 * `admin.member.viewed` event with the tab.
 */
export async function getMemberOffDayAdminSummary(
  userId: string,
  timezone: string,
): Promise<MemberOffDayAdminSummary> {
  const today = localDateOf(new Date(), timezone);
  const upper = shiftLocalDate(today, OFF_DAY_FORWARD_HORIZON_DAYS);

  let rows: { date: Date; reason: string | null }[] = [];
  try {
    rows = await db.memberOffDay.findMany({
      where: {
        userId,
        date: {
          gte: parseLocalDate(today),
          lte: parseLocalDate(upper),
        },
      },
      select: { date: true, reason: true },
      orderBy: { date: 'asc' },
    });
  } catch (err) {
    reportWarning('admin.off_day.summary', 'load_degraded', {
      code:
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'unknown',
    });
    rows = [];
  }

  const upcoming: AdminOffDayEntry[] = rows.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    label: formatOffDayLabel(row.date),
    reason: row.reason,
  }));

  const windowCount = upcoming.length;
  return {
    cap: MAX_FREE_OFF_DAYS_PER_WINDOW,
    horizonDays: OFF_DAY_FORWARD_HORIZON_DAYS,
    windowCount,
    overCap: windowCount > MAX_FREE_OFF_DAYS_PER_WINDOW,
    upcoming,
  };
}
