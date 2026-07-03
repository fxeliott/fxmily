import type { LocalDateString } from '@/lib/checkin/timezone';
import { localDateOf } from '@/lib/checkin/timezone';

/**
 * Tour 11 — PROCESS milestones (jalons de parcours). The streak already
 * celebrates check-in regularity (7/14/30/100 via `getTodayMilestone`); this
 * module celebrates the OTHER side of the journey: the trace of process the
 * member builds. Two deterministic, one-day-only milestones:
 *
 *   - JOURNALED TRADES : the day the member reaches EXACTLY 10 / 25 / 50 / 100
 *     journaled trades (count pile). Process over outcome (§2 / Mark Douglas):
 *     it is not the number that matters, it is the trace.
 *   - FIRST MONTH : the day the member completes their first 30 days of presence
 *     (the J+30 anniversary of `createdAt`, in their local TZ).
 *
 * Pure module (no `server-only`, no DB) — twin of `lib/checkin/milestone.ts`.
 * It consumes facts the dashboard page ALREADY holds (totalTrades, createdAt)
 * so it adds ZERO DB query.
 *
 * ONE-DAY-ONLY & server-gated, exactly like `getTodayMilestone`: a trade
 * milestone fires only while the count equals an anchor EXACTLY (the next
 * journaled trade moves it off, so it naturally shows once); the month
 * milestone fires only on the anniversary calendar day. Anti-Black-Hat
 * (§31.2): a single calm acknowledgement, never a recurring nag, never a score,
 * never a countdown. Red is reserved for trade outcomes.
 *
 * FIREWALL §21.5: display-only, never fed back into any score. French copy,
 * tutoiement, simple punctuation, no em-dash (Eliott's copy rule).
 */

/** Trade-count anchors. Ascending — the exact-match detector relies on it. */
export const TRADE_JOURNAL_MILESTONES = [10, 25, 50, 100] as const;
export type TradeJournalMilestone = (typeof TRADE_JOURNAL_MILESTONES)[number];

/** Days of presence celebrated as the "first month". */
export const FIRST_MONTH_DAYS = 30;

export type JourneyMilestoneKind = 'trades' | 'first-month';

export interface JourneyMilestone {
  kind: JourneyMilestoneKind;
  /** The anchor value (trade count, or the day count for the month). */
  value: number;
  /** Eyebrow shown on the banner. */
  eyebrow: string;
  /** Headline (short, factual). */
  title: string;
  /** Process-over-outcome body copy. */
  body: string;
}

export interface JourneyMilestoneInput {
  /** Lifetime count of journaled trades (open + closed) — the page's `totalTrades`. */
  totalTrades: number;
  /** ISO instant of the member's account creation (`user.createdAt`). */
  createdAt: string | null;
  /** The member's IANA timezone (for the anniversary calendar-day check). */
  timezone: string;
  /** Injected clock for testability. */
  now: Date;
}

/** Per-anchor process-over-outcome copy. Fixed FR, never a market call. */
const TRADE_MILESTONE_BODY: Record<TradeJournalMilestone, string> = {
  10: "10 trades journalisés. Ce n'est pas le nombre qui compte, c'est l'habitude de tout tracer qui s'installe.",
  25: "25 trades journalisés. Ce n'est pas le nombre qui compte, c'est la trace que tu construis, trade après trade.",
  50: '50 trades journalisés. Chaque entrée documentée nourrit ta lucidité : continue à ton rythme.',
  100: "100 trades journalisés. Une vraie matière à relire t'appartient maintenant, et elle vient de ta constance.",
};

/**
 * Whole days elapsed between two local calendar days (b - a), computed on the
 * local-date strings so DST/offset shifts never add or drop a day. Both dates
 * are `YYYY-MM-DD` at UTC-midnight semantics (see `parseLocalDate`), so a plain
 * UTC-millisecond diff is exact.
 */
function daysBetweenLocalDates(a: LocalDateString, b: LocalDateString): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aMs = Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1);
  const bMs = Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
}

/**
 * The process milestone reached TODAY, or `null`. At most one is returned. The
 * trade milestone takes priority over the month one (a rarer, more meaningful
 * event); the caller shows at most one banner anyway.
 *
 * Returns `null` (never fabricates) when nothing lands today.
 */
export function getTodayJourneyMilestone(input: JourneyMilestoneInput): JourneyMilestone | null {
  // --- Journaled-trades milestone : exact count match ---
  const tradeAnchor = (TRADE_JOURNAL_MILESTONES as readonly number[]).includes(input.totalTrades)
    ? (input.totalTrades as TradeJournalMilestone)
    : null;
  if (tradeAnchor !== null) {
    return {
      kind: 'trades',
      value: tradeAnchor,
      eyebrow: 'Jalon de parcours',
      title: `${tradeAnchor} trades journalisés`,
      body: TRADE_MILESTONE_BODY[tradeAnchor],
    };
  }

  // --- First-month milestone : the J+30 anniversary calendar day ---
  if (input.createdAt) {
    const createdMs = Date.parse(input.createdAt);
    if (!Number.isNaN(createdMs)) {
      const createdDay = localDateOf(new Date(createdMs), input.timezone);
      const today = localDateOf(input.now, input.timezone);
      if (daysBetweenLocalDates(createdDay, today) === FIRST_MONTH_DAYS) {
        return {
          kind: 'first-month',
          value: FIRST_MONTH_DAYS,
          eyebrow: 'Jalon de parcours',
          title: 'Ton premier mois de présence',
          body: "Un mois que tu tiens ton suivi. La régularité s'installe : c'est elle, pas un résultat, qui construit ton edge.",
        };
      }
    }
  }

  return null;
}
