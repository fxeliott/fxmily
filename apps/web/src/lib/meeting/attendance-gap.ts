/**
 * S10 §30.8 — Meeting attendance gap (recoupement admin↔membre, pure module).
 *
 * The CONTEXTE GLOBAL of the project requires a real cross-check: Eliott (admin)
 * declares who was present; the member self-reports present/partial/absent; the
 * app crosses the two, surfaces any ÉCART (gap) on both sides, and integrates it
 * into the scoring. Until S10 only the member self-report existed (mono-source) —
 * this module is the missing cross-check, derived PURELY from the two facts.
 *
 * Two facts in:
 *   - `adminPresent`: Eliott's declaration. `null` = admin said nothing (the
 *     default — no gap is ever possible, byte-identical to pre-S10 behaviour).
 *   - the member self-report, distilled into two booleans by the caller:
 *       · `memberComplete`        = `attendanceMode != null` AND `contentReviewed`
 *       · `memberDeclaredSomething` = the member declared a mode or reviewed content
 *         (i.e. there is a self-report row that is not blank).
 *
 * One verdict out: a discriminated `AttendanceGap` string. The values are
 * mutually exclusive and total over the (admin × member) truth table.
 *
 * Pure: no DB, no `Date.now()`, no `import 'server-only'`. Posture §2 / anti
 * Black-Hat: a gap is a calm coaching signal, never a red accusation — the tone
 * is the UI consumer's concern (admin badge / member message stay neutral).
 */

/**
 * The cross-check verdict between Eliott's declaration and the member's
 * self-report for ONE meeting.
 *
 * - `none`                        — no contradiction (incl. `adminPresent === null`,
 *                                    the default: admin said nothing, no gap).
 * - `admin_absent_member_present` — the member self-declared a COMPLETE attendance
 *                                    but Eliott states they were absent. An honesty
 *                                    écart (over-claim) — the ONLY gap that touches
 *                                    the score (the self-declared completion is not
 *                                    counted, see {@link attendanceCountsAsComplete}).
 * - `admin_present_member_absent` — Eliott marks the member present but the member
 *                                    declared nothing. A benign engagement nudge
 *                                    ("Eliott t'a noté présent, pense à déclarer") —
 *                                    NEVER a penalty (the member simply has not
 *                                    logged it yet; logging it grants the credit).
 * - `admin_present_member_partial`— Eliott marks the member present and the member
 *                                    declared SOMETHING but not a complete report.
 *                                    Same benign nudge family as above.
 */
export type AttendanceGap =
  | 'none'
  | 'admin_absent_member_present'
  | 'admin_present_member_absent'
  | 'admin_present_member_partial';

/**
 * Derive the cross-check verdict from the two facts. Total + deterministic.
 *
 * Truth table (admin × member):
 *   adminPresent = null  → always `none` (admin said nothing — no cross-check).
 *   adminPresent = false:
 *     · memberComplete            → `admin_absent_member_present` (over-claim).
 *     · else                      → `none` (both sides agree on absence / no
 *                                    contradiction worth surfacing — a member who
 *                                    declared nothing AND was marked absent is just
 *                                    a confirmed absence, handled by the no-show
 *                                    discipline path, not an écart).
 *   adminPresent = true:
 *     · memberComplete            → `none` (full agreement).
 *     · memberDeclaredSomething   → `admin_present_member_partial`.
 *     · else                      → `admin_present_member_absent`.
 */
export function computeAttendanceGap(
  adminPresent: boolean | null,
  memberComplete: boolean,
  memberDeclaredSomething: boolean,
): AttendanceGap {
  if (adminPresent === null || adminPresent === undefined) return 'none';

  if (adminPresent === false) {
    return memberComplete ? 'admin_absent_member_present' : 'none';
  }

  // adminPresent === true
  if (memberComplete) return 'none';
  if (memberDeclaredSomething) return 'admin_present_member_partial';
  return 'admin_present_member_absent';
}

/**
 * Whether a member's self-declared COMPLETE attendance counts toward the
 * engagement numerator, given Eliott's declaration. This is THE single scoring
 * voie of the recoupement (chosen over a parallel discrepancy lifecycle): an
 * over-claim (`adminPresent === false` contradicting a complete self-report) is
 * NOT counted — honest accounting, never a separate punitive penalty, and
 * auto-healing the instant Eliott corrects the mark.
 *
 * - `memberComplete === false`     → false (nothing to count).
 * - `adminPresent === false`       → false (admin overrides an over-claim).
 * - `adminPresent === true | null` → mirrors `memberComplete` (admin confirms,
 *                                    or admin said nothing → trust the member).
 *
 * Used IDENTICALLY by `countMeetingAttendance` (engagement) and the member/admin
 * list views so the displayed rate can never drift from the scored rate
 * (coherence canon §30.4).
 */
export function attendanceCountsAsComplete(
  memberComplete: boolean,
  adminPresent: boolean | null,
): boolean {
  if (!memberComplete) return false;
  return adminPresent !== false;
}

/** Whether a gap is the honesty over-claim that affects the engagement score. */
export function isScoringGap(gap: AttendanceGap): boolean {
  return gap === 'admin_absent_member_present';
}
