/**
 * V1.7 §30 — Meeting attendance rate (J-M1 data layer, pure module).
 *
 * Honesty doctrine, carbon copy of `pre-trade/analytics.ts` :
 *   - Discriminated union `{ kind: 'ok' | 'insufficient_data' }` — the
 *     `insufficient_data` branch STRUCTURALLY cannot expose a `rate`
 *     (compile-time guarantee against ever rendering a misleading number).
 *   - `scheduledCount === 0` (no meeting held in the window) → `insufficient_data`
 *     with reason `no_meetings` → the UI shows a pedagogical empty state,
 *     NEVER a fake "0 %" (SPEC §30.4 "jamais « 0% » mensonger si dénominateur 0").
 *
 * Note the asymmetry vs `pre-trade/analytics.ts`: there is NO statistical
 * sample-size floor (à la `MIN_SAMPLE = 8`) here. A member with 1 scheduled
 * meeting and 1 complete attendance genuinely is at 100 % — it is a real (if
 * noisy) signal, not a fabricated distribution. The ONLY insufficient case is a
 * zero denominator (division by zero). This matches the engagement skip in
 * J-M4, which is keyed on `scheduledCount` (0 → null sub-score → score
 * unchanged), NOT on `completedCount`.
 *
 * Pure: no DB, no `Date.now()`, no `import 'server-only'`. The two counts come
 * from `countMeetingAttendance` (service layer); this turns them into a rate.
 *
 * Posture §2 / anti Black-Hat (Yu-kai Chou): the rate is a neutral fact for the
 * member to read, never a punishment. UI tone is the consumer's concern (J-M2:
 * neutral, never red, never "tu es à 40 %" accusateur).
 */

/**
 * Result of {@link computeMeetingAttendanceRate}. Discriminated union — the
 * `insufficient_data` branch does NOT carry a `rate` (structural impossibility
 * to fake a rate when the denominator is zero).
 */
export type MeetingAttendanceRateResult =
  | {
      kind: 'insufficient_data';
      scheduledCount: 0;
      completedCount: 0;
      reason: 'no_meetings';
    }
  | {
      kind: 'ok';
      scheduledCount: number;
      completedCount: number;
      /** 0 ≤ rate ≤ 1. Formatting to "%" is a UI concern. */
      rate: number;
    };

/**
 * Turn a (scheduledCount, completedCount) pair into an honest rate.
 *
 * - `scheduledCount === 0` → `insufficient_data` (`no_meetings`). A negative or
 *   non-finite denominator is defensively treated the same way (the service
 *   never produces those, but the pure fn stays total).
 * - otherwise → `ok` with `rate = completedCount / scheduledCount`,
 *   clamped to `[0, 1]` (completed can never legitimately exceed scheduled,
 *   but we clamp defensively so a future caller bug surfaces as 100 %, never >1).
 */
export function computeMeetingAttendanceRate(
  scheduledCount: number,
  completedCount: number,
): MeetingAttendanceRateResult {
  if (!Number.isFinite(scheduledCount) || scheduledCount <= 0) {
    return {
      kind: 'insufficient_data',
      scheduledCount: 0,
      completedCount: 0,
      reason: 'no_meetings',
    };
  }
  const completed = Math.max(0, completedCount);
  const rate = Math.min(1, completed / scheduledCount);
  return { kind: 'ok', scheduledCount, completedCount: completed, rate };
}
