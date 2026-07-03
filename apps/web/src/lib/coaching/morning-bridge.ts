import type { CoachingRegister } from './trade-echo';

/**
 * Tour 11 — the MORNING BRIDGE. When a member opens the hub in the morning, the
 * app answers with a short, personal echo of YESTERDAY: it reads last night's
 * evening check-in (intention kept, plan respected, stress) and mirrors it back
 * so an assiduous member no longer arrives to a blank greeting.
 *
 * Two shapes, one module:
 *   - RETURN AFTER ABSENCE : when the member has been away for several days, the
 *     bridge SUBSTITUTES a warm welcome for the yesterday-echo. An absence is a
 *     DATUM, never a failure (§31.2), and the streak restarting at 0 is not
 *     scolded.
 *   - YESTERDAY BRIDGE : otherwise, 1 to 2 fixed FR sentences derived from the
 *     evening self-report enums, declined by `register`.
 *
 * Pure module (no `server-only`, no DB) so the whole decision table is unit-
 * testable — sibling of `trade-echo.ts`. The page reads the evening check-in +
 * profile upstream and feeds the derived values here.
 *
 * DETERMINISTIC, ZERO AI CALL: every sentence is FIXED French copy selected by
 * enum/boolean rules (intentionKept, planRespectedToday, stressScore band,
 * coachingTone.register). No raw AI text is ever surfaced, so AI Act §50 needs
 * NO `AIGeneratedBanner` (precedent: learning-stage.ts).
 *
 * FIREWALL §21.5: display-only, never fed back into the behavioral score. We
 * read the member's OWN self-reports and the `register` enum, and NOTHING from
 * `weakSignals` (admin-only, never crosses the member boundary).
 *
 * POSTURE §2 / §31.2 / Mark Douglas: we mirror the ACT (an intention held, a
 * plan respected), never punitively, never with a countdown. Tone stays 'ok' or
 * 'neutral' — red is reserved for trade outcomes. French copy, tutoiement,
 * simple punctuation, no em-dash (Eliott's copy rule).
 *
 * NULL-PASSTHROUGH (§S26): a null/absent self-report NEVER fabricates a signal.
 * A missing evening check-in (no data yesterday) returns `null` — no bridge.
 */

/** The bridge only appears in the MORNING — a reaction to a new day, not an archive. */
export const MORNING_BRIDGE_END_HOUR = 12;

/** Absence threshold: at or beyond this many days since the last check-in, the
 *  bridge becomes the warm welcome-back instead of a yesterday-echo. */
export const ABSENCE_DAYS_THRESHOLD = 3;

/** High-stress band (evening `stressScore` is 0..10). At/above → add a calm,
 *  self-care follow-up. Deliberately conservative: a real high-stress signal,
 *  never a nag. */
const HIGH_STRESS_MIN = 7;

export interface MorningBridgeInput {
  /**
   * The member's local hour (0..23) right now, in THEIR timezone. Only 0..11
   * shows the bridge (morning). The page derives it from `User.timezone`.
   */
  localHour: number;
  /**
   * Whole days since the member's most recent check-in (any slot), or `null`
   * when the member has never checked in. `0` = checked in today, `1` =
   * yesterday, etc. Drives the return-after-absence branch.
   */
  daysSinceLastCheckin: number | null;
  /** Yesterday's evening self-report (tri-state booleans, null when skipped). */
  yesterdayEvening: {
    intentionKept: boolean | null;
    planRespectedToday: boolean | null;
    /** 0..10, null when not reported. */
    stressScore: number | null;
  } | null;
  /** Profile-derived register (already schema-validated). Null → 'pedagogique'. */
  coachingRegister: CoachingRegister | null;
}

export interface MorningBridge {
  /** Eyebrow/title for the card. */
  title: string;
  /** 'welcome-back' after an absence, else 'yesterday'. Lets the UI pick a glyph. */
  kind: 'welcome-back' | 'yesterday';
  /** Drives the calm card accent — 'ok' (accent) or 'neutral'. Never red. */
  tone: 'ok' | 'neutral';
  /** 1 to 2 short sentences. */
  lines: string[];
}

/** Per-register copy for one signal. Register picked from coachingTone. */
type RegisterCopy = Record<CoachingRegister, string>;

/** Warm welcome after several days away. Never culpabilisant (§31.2). */
const WELCOME_BACK: RegisterCopy = {
  direct: 'Content de te revoir. On reprend calmement, un jour à la fois.',
  pedagogique:
    "Content de te revoir. Une absence n'efface rien de ton travail, on reprend calmement, un jour à la fois.",
  socratique:
    'Content de te revoir. Quel premier petit geste te remettrait dans ton rythme aujourd’hui ?',
};

/** Yesterday: intention kept. The strongest positive mirror. */
const INTENTION_KEPT: RegisterCopy = {
  direct: 'Hier tu as tenu ton intention. On repart de là.',
  pedagogique:
    'Hier tu as tenu ton intention. Ce sont ces journées tenues, mises bout à bout, qui construisent ta constance.',
  socratique: 'Hier tu as tenu ton intention. Qu’est-ce qui t’a aidé à la garder en tête ?',
};

/** Yesterday: intention NOT kept. A datum to observe, never a reproach. */
const INTENTION_MISSED: RegisterCopy = {
  direct: "Hier ton intention n'a pas tenu. C'est une donnée, pas un échec. On repart au clair.",
  pedagogique:
    "Hier ton intention n'a pas tenu, et c'est une information utile, pas une faute. Reprends aujourd'hui avec une intention simple et tenable.",
  socratique:
    "Hier ton intention n'a pas tenu. Qu'est-ce qui l'a rendue difficile, et comment l'ajuster aujourd'hui ?",
};

/** Yesterday: plan respected (no intention signal available). */
const PLAN_RESPECTED: RegisterCopy = {
  direct: 'Hier tu as respecté ton plan. On garde cette ligne aujourd’hui.',
  pedagogique:
    'Hier tu as respecté ton plan. Un plan tenu rend chaque journée lisible, on continue sur cette base.',
  socratique: 'Hier tu as respecté ton plan. Qu’est-ce qui t’a aidé à rester dans ton cadre ?',
};

/**
 * Fallback when there IS an evening check-in but no readable intention/plan
 * signal (both skipped). We still acknowledge the presence, never fabricate a
 * verdict. Register-invariant (a simple, neutral nod).
 */
const NEUTRAL_PRESENT =
  'Hier tu as pris le temps de faire ton bilan du soir. On repart de cette base aujourd’hui.';

/** High-stress evening → one calm self-care follow-up. Never alarmist. */
const STRESS_FOLLOWUP =
  'Ton stress était élevé hier soir. Accorde-toi un démarrage doux avant de te lancer.';

/**
 * Build the morning bridge. Returns `null` when it should not show:
 *   - not the morning (localHour >= {@link MORNING_BRIDGE_END_HOUR}),
 *   - the member has never checked in (`daysSinceLastCheckin === null`),
 *   - already checked in today (`daysSinceLastCheckin === 0`) — the day is
 *     underway, the "arrival" moment has passed,
 *   - no evening check-in yesterday AND not an absence (nothing to bridge from).
 */
export function buildMorningBridge(input: MorningBridgeInput): MorningBridge | null {
  if (input.localHour < 0 || input.localHour >= MORNING_BRIDGE_END_HOUR) return null;
  if (input.daysSinceLastCheckin === null) return null;
  // Already checked in today — the arrival echo is not relevant anymore.
  if (input.daysSinceLastCheckin === 0) return null;

  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';

  // RETURN AFTER ABSENCE — takes priority over any stale yesterday-echo.
  if (input.daysSinceLastCheckin >= ABSENCE_DAYS_THRESHOLD) {
    return {
      title: 'Content de te revoir',
      kind: 'welcome-back',
      tone: 'ok',
      lines: [WELCOME_BACK[register]],
    };
  }

  // YESTERDAY BRIDGE — needs an evening check-in to read from.
  const evening = input.yesterdayEvening;
  if (!evening) return null;

  let tone: MorningBridge['tone'] = 'neutral';
  let main: string;

  // Intention is the primary mirror; plan is the fallback signal; presence last.
  if (evening.intentionKept === true) {
    tone = 'ok';
    main = INTENTION_KEPT[register];
  } else if (evening.intentionKept === false) {
    // A miss is observed calmly, never in red (tone stays 'neutral').
    main = INTENTION_MISSED[register];
  } else if (evening.planRespectedToday === true) {
    tone = 'ok';
    main = PLAN_RESPECTED[register];
  } else {
    main = NEUTRAL_PRESENT;
  }

  const lines: string[] = [main];

  // One optional self-care follow-up on a genuinely high-stress evening. Null
  // stress never triggers it (§S26 null-passthrough).
  if (evening.stressScore !== null && evening.stressScore >= HIGH_STRESS_MIN) {
    lines.push(STRESS_FOLLOWUP);
  }

  return {
    title: 'Ton pont avec hier',
    kind: 'yesterday',
    tone,
    lines,
  };
}
