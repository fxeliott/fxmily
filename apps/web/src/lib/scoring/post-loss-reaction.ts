import { localDateOf } from '@/lib/checkin/timezone';

/**
 * S25 #6 — « Reprendre après un SL » : pure derivation of the member's INTRADAY
 * reaction to a loss, the sharpest tilt/revenge signal there is.
 *
 * WHY (gap audit S25). Eliott's method is explicit: one SL ends the trading day
 * ("une perte par jour ; dès que j'ai pris une perte je sors du marché"). So the
 * meaningful behavioural signal is: after a realized loss, does the member re-open
 * a position the SAME day — and how fast? The existing `recoveryAfterLoss` only
 * measures the mood the NEXT day (J+1), never the minutes of the live reaction.
 * Those timestamps are already on `Trade` (entered/closed/outcome) → derive-at-
 * render, 0 migration — another "computed-then-thrown-away" signal recovered.
 *
 * Pure (no `server-only`, no DB, no `Date.now()`) ⇒ Vitest-safe in isolation; the
 * server seam maps Prisma rows and the trailing window. The method's clock is
 * Paris (NY session in heure française), so "same day" is the Europe/Paris civil
 * day via the DST-safe `localDateOf` seam.
 *
 * POSTURE §2 : timing/discipline only — never a market call. §31.2 : the surface
 * frames this CALMLY (Mark Douglas — "ce que tes données montrent"), never red,
 * never "tu as fauté". A mirror of the tilt window, not a verdict.
 */

const PARIS_TZ = 'Europe/Paris';
/** A re-entry within this many minutes of a loss = the sharpest tilt marker. */
const FAST_REENTRY_MIN = 30;
/** Below this many closed losses we stay silent (anti-fabrication). */
const MIN_LOSSES = 3;

/** A trade reduced to exactly what the reaction needs. */
export interface ReactionTrade {
  enteredAt: Date;
  closedAt: Date | null;
  outcome: 'win' | 'loss' | 'break_even' | null;
}

export interface PostLossReaction {
  /** Closed losses considered (denominator). */
  losses: number;
  /** Losses followed by a SAME-Paris-day re-entry (a slip vs "1 SL = stop"). */
  reentries: number;
  /** Median minutes from loss close → that same-day next entry, or null. */
  medianDelayMin: number | null;
  /** Re-entries within 30 min of the loss close (sharpest tilt signal). */
  fastReentries: number;
  /** Trailing window spanned (days), for the copy. */
  windowDays: number;
  /** `true` once there are enough closed losses to mirror honestly. */
  hasEnough: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(m);
}

/**
 * Compute the post-loss reaction over `trades` (already filtered to the trailing
 * window by the caller). For each realized loss, find the FIRST trade entered
 * strictly AFTER the loss closed on the SAME Paris day — that re-entry (and how
 * fast it came) is the signal. Pure + deterministic.
 */
export function computePostLossReaction(
  trades: ReactionTrade[],
  windowDays: number,
  timezone: string = PARIS_TZ,
): PostLossReaction {
  // Entries sorted ascending — we scan forward from each loss's close.
  const entries = [...trades].sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());
  // Losses are processed in CLOSE-time order so the earliest loss claims the
  // earliest re-entry — the real behavioural sequence — and the attribution is
  // deterministic regardless of the caller's input order.
  const losses = trades
    .filter((t) => t.closedAt !== null && t.outcome === 'loss')
    .sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime());

  let reentries = 0;
  let fastReentries = 0;
  const delays: number[] = [];
  // A physical re-entry trade must be attributed to AT MOST ONE loss. Without
  // this, two losses on the SAME day (e.g. closed 10:00 and 10:30) sharing a
  // single subsequent entry (11:00) would BOTH count it — inflating `reentries`
  // / `fastReentries` / `delays` past the real number of re-opens. Consuming
  // each entry once also preserves the invariant `reentries <= losses`.
  const consumed = new Set<ReactionTrade>();

  for (const loss of losses) {
    const closedAt = loss.closedAt!;
    const lossDay = localDateOf(closedAt, timezone);
    // First NOT-yet-consumed entry strictly after this loss closed, same Paris day.
    const next = entries.find(
      (t) =>
        !consumed.has(t) &&
        t.enteredAt.getTime() > closedAt.getTime() &&
        localDateOf(t.enteredAt, timezone) === lossDay,
    );
    if (!next) continue;
    consumed.add(next);
    reentries += 1;
    const delayMin = Math.round((next.enteredAt.getTime() - closedAt.getTime()) / 60_000);
    delays.push(delayMin);
    if (delayMin < FAST_REENTRY_MIN) fastReentries += 1;
  }

  return {
    losses: losses.length,
    reentries,
    medianDelayMin: median(delays),
    fastReentries,
    windowDays,
    hasEnough: losses.length >= MIN_LOSSES,
  };
}

export { MIN_LOSSES, FAST_REENTRY_MIN };
