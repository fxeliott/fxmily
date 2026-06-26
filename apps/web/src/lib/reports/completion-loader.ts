import 'server-only';

import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';

import { buildCompletionSummary, type CompletionSummary } from './completion';

/**
 * Render-time loader for the deterministic completion + continuity overview
 * (S6 §32-3). Reads the member's check-ins for an already-known report period
 * and hands them to the pure {@link buildCompletionSummary} aggregator.
 *
 * Render-time RECOMPUTE (not a persisted column): same posture as
 * `weekly-recap-card` — "no new heavy query, no new table". The report rows
 * (`WeeklyReport` / `MonthlyDebrief`) persist only the LLM output; the
 * completion overview is derived fresh from the check-ins (the single SSOT),
 * so it can never drift from a stale persisted copy and needs no migration /
 * backfill. Check-ins are never deleted, so a historical period recomputes
 * exactly.
 *
 * Bounds are `@db.Date`-correct: the period strings are member-local calendar
 * days, mapped to UTC-midnight `Date`s via `parseLocalDate` (the SAME
 * convention `lib/{weekly-report,monthly-debrief}/loader.ts` use for the
 * check-in window), so there is no timezone drift on the day boundaries.
 *
 * Count-only `select` (date / slot / morning-routine flag) — no free-text, no
 * P&L, no market content reaches this surface (posture §2).
 */
export async function loadCompletionSummary(
  userId: string,
  periodStartLocal: string,
  periodEndLocal: string,
): Promise<CompletionSummary> {
  const rows = await db.dailyCheckin.findMany({
    where: {
      userId,
      date: { gte: parseLocalDate(periodStartLocal), lte: parseLocalDate(periodEndLocal) },
    },
    select: { date: true, slot: true, morningRoutineCompleted: true },
    orderBy: { date: 'asc' },
  });

  return buildCompletionSummary({
    periodStart: periodStartLocal,
    periodEnd: periodEndLocal,
    checkins: rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      slot: row.slot,
      morningRoutineCompleted: row.morningRoutineCompleted,
    })),
  });
}
