import { localDateOf } from '@/lib/checkin/timezone';
import { localHour } from '@/lib/daily-guidance/slot';

/**
 * S24 — « Fidélité à la méthode » : pure derivation of the member's adherence to
 * Eliott's HARD RULES over a trailing window. No DB, no `server-only` — the
 * server seam (`service.ts`) maps Prisma rows to {@link MirrorTrade} and calls
 * this; the unit test imports it directly.
 *
 * WHY (gap confirmed by the S24 recon agent). The day-status of these rules is
 * shown live by `SessionTimeline`, but NOTHING aggregates them OVER TIME — and
 * `getSessionRoutine` even computes `enteredOutsideWindow` then throws it away.
 * The member never sees "over my last 30 days, how faithful am I to the method?".
 * Every input already exists on `Trade` (entered/closed/plannedRR) → derive-at-
 * render, 0 migration.
 *
 * The method's hours ARE Paris hours (NY session read in heure française), so we
 * anchor on Europe/Paris for EVERY member and read the wall-clock via the same
 * DST-safe `Intl` seams as the rest of the app (`localHour`, `localDateOf`).
 *
 * POSTURE §2 + anti-Black-Hat (§31.2). Each rule is a PROCESS/discipline fact,
 * never a market call. The component frames a low rate calmly ("à renforcer"),
 * never red-punitive, never a countdown — a mirror, not a verdict.
 */

/** Execution window: 13h–16h Paris (the open momentum). */
const EXEC_FROM_HOUR = 13;
const EXEC_TO_HOUR = 16;
/** Hard cut: everything closed by 20h Paris, no overnight. */
const CUT_HOUR = 20;
/** The method targets RR ≥ 3 (90/10 close at RR3). */
const TARGET_RR = 3;
/** Below this many entered trades, we don't mirror (anti-fabrication). */
const MIN_ENTERED = 5;

export type MethodRuleKey = 'window' | 'oneADay' | 'cut' | 'targetRR';

/** A trade reduced to exactly what the mirror needs (Prisma-Decimal-free). */
export interface MirrorTrade {
  enteredAt: Date;
  closedAt: Date | null;
  /** Planned reward:risk, as a plain number (Prisma Decimal → Number at the seam). */
  plannedRR: number;
}

export interface MethodRule {
  key: MethodRuleKey;
  /** Short calm label ("Fenêtre 13h–16h"). */
  label: string;
  /** One descriptive line (process, never a market call). */
  hint: string;
  /** Compliant count. */
  good: number;
  /** Sample size (denominator). */
  total: number;
  /** `good/total` as 0–100, or `null` when `total === 0` (nothing to mirror yet). */
  rate: number | null;
}

export interface MethodMirror {
  rules: MethodRule[];
  /** Entered trades considered in the window. */
  sampleEntered: number;
  /** Trailing days the window spans (for the copy). */
  windowDays: number;
  /** `true` once there is enough data to mirror honestly. */
  hasEnough: boolean;
}

function rate(good: number, total: number): number | null {
  return total === 0 ? null : Math.round((good / total) * 100);
}

/**
 * Compute the method-fidelity mirror over `trades` (already filtered to the
 * trailing window by the caller). Pure + deterministic.
 */
export function computeMethodMirror(
  trades: MirrorTrade[],
  windowDays: number,
  timezone: string = 'Europe/Paris',
): MethodMirror {
  const entered = trades.length;
  const closed = trades.filter((t) => t.closedAt !== null);

  // Rule 1 — execution window 13h–16h (over every entered trade).
  let inWindow = 0;
  // Rule 4 — targeting RR ≥ 3 (over every entered trade).
  let targetingRR = 0;
  // Rule 2 — ≤ 1 trade per Paris day: count entries per local day.
  const perDay = new Map<string, number>();
  for (const t of trades) {
    const h = localHour(t.enteredAt, timezone);
    if (h >= EXEC_FROM_HOUR && h < EXEC_TO_HOUR) inWindow += 1;
    if (t.plannedRR >= TARGET_RR) targetingRR += 1;
    const day = localDateOf(t.enteredAt, timezone);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const tradingDays = perDay.size;
  let compliantDays = 0;
  for (const count of perDay.values()) if (count <= 1) compliantDays += 1;

  // Rule 3 — 20h cut / 0 overnight (over CLOSED trades): closed the SAME Paris
  // day AND before 20h. A position closed the next day OR after 20h breaches it.
  let cutRespected = 0;
  for (const t of closed) {
    const closedAt = t.closedAt!;
    const sameDay = localDateOf(closedAt, timezone) === localDateOf(t.enteredAt, timezone);
    if (sameDay && localHour(closedAt, timezone) < CUT_HOUR) cutRespected += 1;
  }

  const rules: MethodRule[] = [
    {
      key: 'window',
      label: 'Fenêtre 13h–16h',
      hint: 'Tes entrées sur la fenêtre d’exécution de la méthode.',
      good: inWindow,
      total: entered,
      rate: rate(inWindow, entered),
    },
    {
      key: 'oneADay',
      label: 'Un trade par jour',
      hint: 'Les jours où tu t’es tenu à un seul trade — un seul risque ouvert.',
      good: compliantDays,
      total: tradingDays,
      rate: rate(compliantDays, tradingDays),
    },
    {
      key: 'cut',
      label: 'Coupure 20h',
      hint: 'Tes clôtures avant 20h, même journée — la nuit n’est pas ta session.',
      good: cutRespected,
      total: closed.length,
      rate: rate(cutRespected, closed.length),
    },
    {
      key: 'targetRR',
      label: 'Visée RR 3',
      hint: 'Tes trades planifiés avec un objectif d’au moins 3 pour 1.',
      good: targetingRR,
      total: entered,
      rate: rate(targetingRR, entered),
    },
  ];

  return {
    rules,
    sampleEntered: entered,
    windowDays,
    hasEnough: entered >= MIN_ENTERED,
  };
}

export { MIN_ENTERED };
