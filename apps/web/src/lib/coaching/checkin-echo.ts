import { NEGATIVE_TRADING_EMOTIONS } from '@/lib/trading/emotions';

import type { CoachingRegister, EchoLearningStage } from './trade-echo';

/**
 * Tour 11 — the LIVING check-in echo. The check-in is the app's most frequent
 * act (2x/day). Until now the confirmation was a flat "Check-in matin
 * enregistre" identical for everyone. This module answers the ACT immediately:
 * a short, member-specific reading of what the member just declared this
 * morning (mood, sleep, emotions) or this evening (plan respected, stress,
 * intention kept), selected by rules on enums/booleans.
 *
 * Twin of `trade-echo.ts` — same shape, same posture, same deterministic
 * decision-table pattern. Pure module (no `server-only`, no DB) so the whole
 * table is unit-testable.
 *
 * DETERMINISTIC, ZERO AI CALL: every sentence below is FIXED French copy
 * selected by enum/boolean-derived rules (moodScore, sleepQuality,
 * emotionTags clusters, planRespectedToday, stressScore, intentionKept,
 * coachingRegister, learningStage). We surface no `rationale`/`evidence` (raw
 * AI blobs) so AI Act needs no banner (precedent: trade-echo.ts).
 *
 * FIREWALL §21.5: display-only, never fed back into the behavioral score.
 * We read `coachingRegister`/`learningStage` (already derived via
 * `echoProfileDims`) and NOTHING else from the profile. `weakSignals` never
 * crosses the member boundary.
 *
 * POSTURE §2 / §31.2 / Mark Douglas: we mirror the ACT (the declared state,
 * the rule that held), never punitively, never a countdown. RED is reserved
 * for trade outcomes: a soft process signal renders tone 'watch' (accent),
 * a calm positive state renders tone 'ok'. French copy, simple punctuation,
 * no em-dash (Eliott's copy rule).
 *
 * NULL PASSTHROUGH (§S26): a null/absent self-report NEVER fabricates a
 * signal. A morning with no mood + no negative emotion + no sleep score is a
 * neutral "note du matin", not a "watch".
 */

/** Mood at or below this (1-10 scale) reads as a low-energy morning. */
export const LOW_MOOD_THRESHOLD = 4;
/** Sleep quality at or below this (1-5 scale) reads as a short/poor night. */
export const LOW_SLEEP_THRESHOLD = 2;
/** Stress at or above this (1-10 scale) reads as a tense evening. */
export const HIGH_STRESS_THRESHOLD = 7;

export interface MorningCheckinEchoInput {
  /** 1-10 self-reported mood. Null/absent → no mood signal. */
  moodScore: number | null;
  /** 1-5 self-reported sleep quality. Null/absent → no sleep signal. */
  sleepQuality: number | null;
  /** Selected emotion tag slugs (shared referential with trades). */
  emotionTags: readonly string[];
  learningStage: EchoLearningStage | null;
  coachingRegister: CoachingRegister | null;
}

export interface EveningCheckinEchoInput {
  /** Did the member respect their plan today? Tri-state; null → no signal. */
  planRespectedToday: boolean | null;
  /** 1-10 self-reported stress. Null/absent → no stress signal. */
  stressScore: number | null;
  /** Did the member keep this morning's intention? Tri-state; null → no signal. */
  intentionKept: boolean | null;
  /** Selected emotion tag slugs (shared referential with trades). */
  emotionTags: readonly string[];
  learningStage: EchoLearningStage | null;
  coachingRegister: CoachingRegister | null;
}

export interface CheckinEcho {
  title: string;
  /** Drives the card accent only — 'watch' stays calm (accent, never red). */
  tone: 'ok' | 'watch' | 'neutral';
  /** 1 to 3 short sentences: main reading, then an optional stage anchor. */
  lines: string[];
}

/** Per-register copy for one signal. Register picked from coachingTone. */
type RegisterCopy = Record<CoachingRegister, string>;

// =============================================================================
// Morning copy — priority order, FIRST match wins (one mirror, never a wall).
// =============================================================================

const MORNING_TENSE_START: RegisterCopy = {
  direct:
    "Tu démarres la journée avec une émotion sous tension. Nomme-la avant d'ouvrir le marché, c'est déjà la moitié du travail.",
  pedagogique:
    "Tu notes une émotion sous tension ce matin. La reconnaître maintenant, avant le marché, t'évite qu'elle pilote tes décisions sans que tu la voies.",
  socratique:
    "Tu notes une émotion sous tension ce matin. Qu'est-ce qui l'a déclenchée, et qu'est-ce qui t'aiderait à entrer quand même dans ton cadre ?",
};

const MORNING_LOW_ENERGY: RegisterCopy = {
  direct:
    "Humeur basse et nuit courte : ta vigilance sera plus fragile aujourd'hui. Réduis la voilure, tiens ton plan strictement.",
  pedagogique:
    "Humeur basse et sommeil léger ce matin. Ces jours-là, ta discipline demande plus d'effort : un plan strict et moins de positions protègent ton edge.",
  socratique:
    "Humeur basse et nuit courte ce matin. Sachant ça, qu'est-ce que tu ajustes aujourd'hui pour rester dans ton process ?",
};

const MORNING_LOW_MOOD: RegisterCopy = {
  direct:
    "Humeur basse au réveil. Ce n'est pas un mauvais jour, c'est une donnée : entre avec un plan strict.",
  pedagogique:
    "Tu démarres avec une humeur basse. C'est une information utile, pas un verdict : les jours comme ça, ton cadre est ton meilleur allié.",
  socratique:
    "Humeur basse au réveil. Qu'est-ce qui te maintiendrait dans ton plan si le marché te sollicite fort aujourd'hui ?",
};

const MORNING_SHORT_NIGHT: RegisterCopy = {
  direct: 'Nuit courte cette nuit. Ta patience sera plus limitée, garde ton plan à portée de main.',
  pedagogique:
    "Sommeil léger cette nuit. La fatigue érode la patience avant tout : c'est le moment de t'appuyer sur ta checklist plutôt que sur ton ressenti.",
  socratique:
    'Nuit courte cette nuit. Comment tu comptes compenser cette fatigue dans ton exécution du jour ?',
};

const MORNING_CALM_START: RegisterCopy = {
  direct: 'Départ calme et posé. Sers-toi de cet état pour exécuter ton plan sans le forcer.',
  pedagogique:
    "Tu démarres dans un état posé. C'est le terrain idéal pour laisser ton process travailler : rien à prouver, juste à exécuter.",
  socratique:
    'Départ calme ce matin. Comment reproduire cet état les jours où il ne vient pas seul ?',
};

/** Neutral: morning noted, but no readable low/tense/calm signal. */
const MORNING_NEUTRAL =
  'Check-in du matin posé. Cadrer ton intention avant le marché fait déjà partie du travail.';

// =============================================================================
// Evening copy — priority order, FIRST match wins.
// =============================================================================

const EVENING_PLAN_BROKEN: RegisterCopy = {
  direct:
    "Ton plan n'a pas tenu aujourd'hui. Le noter ce soir, sans te juger, c'est ce qui te fait progresser pour demain.",
  pedagogique:
    "Ton plan n'a pas tenu aujourd'hui. L'important n'est pas la journée elle-même mais ce que tu en tires : qu'est-ce qui a cédé, et quand ?",
  socratique:
    "Ton plan n'a pas tenu aujourd'hui. À quel moment précis ça a basculé, et qu'est-ce qui l'aurait évité ?",
};

const EVENING_INTENTION_MISSED: RegisterCopy = {
  direct:
    "L'intention de ce matin n'a pas été tenue. Ce n'est pas un échec, c'est une info à relire calmement.",
  pedagogique:
    "Tu n'as pas tenu l'intention posée ce matin. Boucler la boucle matin/soir, même sur un écart, c'est ça qui rend tes patterns visibles.",
  socratique:
    "L'intention du matin n'a pas tenu. Qu'est-ce qui s'est mis entre elle et ton exécution aujourd'hui ?",
};

const EVENING_TENSE_DAY: RegisterCopy = {
  direct:
    'Journée sous tension et fin de journée émotionnelle. Repère ce qui a fait monter la pression, tu la géreras mieux la prochaine fois.',
  pedagogique:
    "Stress élevé et émotions à vif ce soir. Nommer ce qui a chargé la journée, c'est ce qui t'aide à ne pas le reporter sur demain.",
  socratique:
    "Journée tendue, émotions à vif ce soir. Qu'est-ce qui a le plus pesé, et qu'est-ce qui t'aurait apaisé sur le moment ?",
};

const EVENING_HIGH_STRESS: RegisterCopy = {
  direct:
    "Stress élevé aujourd'hui. Le poser ici te permet de fermer la journée au lieu de la ruminer.",
  pedagogique:
    "Tu notes un stress élevé aujourd'hui. Le déposer le soir, c'est ce qui l'empêche de déborder sur ta nuit et sur demain.",
  socratique:
    "Stress élevé aujourd'hui. Qu'est-ce qui l'a nourri, et qu'est-ce que tu peux relâcher maintenant que la journée est finie ?",
};

const EVENING_HELD: RegisterCopy = {
  direct:
    'Plan tenu et intention respectée. Voilà une journée de process, exactement ce qui construit ta constance.',
  pedagogique:
    "Plan tenu et intention respectée aujourd'hui. Ce qui compte n'est pas le résultat mais que la journée soit venue de ton cadre : c'est répétable.",
  socratique:
    "Plan tenu, intention respectée. Qu'est-ce qui a rendu cette journée facile à tenir, et comment le reproduire ?",
};

/** Neutral: evening noted, no readable signal (all self-reports null/neutral). */
const EVENING_NEUTRAL =
  'Check-in du soir posé. Relire ta journée, même brièvement, fait partie du process.';

/**
 * Stage anchor — closes the echo on WHERE this member's work currently lives.
 * Reused verbatim from the trade-echo frame so both surfaces speak the same
 * language (kept local to avoid coupling to trade-echo internals).
 */
const STAGE_ANCHOR: Record<EchoLearningStage, string> = {
  mechanical: 'À ton stade, la priorité reste le respect strict de tes règles, jour après jour.',
  subjective: "À ton stade, garde ton cadre comme garde-fou pendant que ta lecture s'affine.",
  intuitive: 'À ton stade, la régularité de tes routines est ce qui entretient ton edge.',
};

function hasNegativeEmotion(tags: readonly string[]): boolean {
  return tags.some((slug) => NEGATIVE_TRADING_EMOTIONS.has(slug));
}

/**
 * Build the morning check-in echo. Never returns null: the morning was just
 * submitted, so there is always at least a neutral acknowledgement of the act.
 */
export function buildMorningCheckinEcho(input: MorningCheckinEchoInput): CheckinEcho {
  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';

  // Null passthrough: only a NUMBER below the threshold counts as a signal.
  const lowMood = input.moodScore !== null && input.moodScore <= LOW_MOOD_THRESHOLD;
  const lowSleep = input.sleepQuality !== null && input.sleepQuality <= LOW_SLEEP_THRESHOLD;
  const tense = hasNegativeEmotion(input.emotionTags);
  // A calm start = a positive emotion declared AND nothing dragging (no low
  // mood, no short night, no tense emotion). Never fabricated from silence.
  const calm =
    input.emotionTags.some((slug) => slug === 'calm' || slug === 'confident') &&
    !tense &&
    !lowMood &&
    !lowSleep;

  let tone: CheckinEcho['tone'] = 'neutral';
  let main: string;

  if (tense) {
    tone = 'watch';
    main = MORNING_TENSE_START[register];
  } else if (lowMood && lowSleep) {
    tone = 'watch';
    main = MORNING_LOW_ENERGY[register];
  } else if (lowMood) {
    tone = 'watch';
    main = MORNING_LOW_MOOD[register];
  } else if (lowSleep) {
    tone = 'watch';
    main = MORNING_SHORT_NIGHT[register];
  } else if (calm) {
    tone = 'ok';
    main = MORNING_CALM_START[register];
  } else {
    main = MORNING_NEUTRAL;
  }

  const lines: string[] = [main];
  if (input.learningStage) {
    lines.push(STAGE_ANCHOR[input.learningStage]);
  }

  return { title: 'Ce que ton matin dit de ta journée', tone, lines };
}

/**
 * Build the evening check-in echo. Never returns null: the evening was just
 * submitted, so there is always at least a neutral acknowledgement of the act.
 */
export function buildEveningCheckinEcho(input: EveningCheckinEchoInput): CheckinEcho {
  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';

  // Null passthrough: `false` is a declared miss, `null` is silence (no signal).
  const planBroken = input.planRespectedToday === false;
  const intentionMissed = input.intentionKept === false;
  const highStress = input.stressScore !== null && input.stressScore >= HIGH_STRESS_THRESHOLD;
  const tense = hasNegativeEmotion(input.emotionTags);
  // A "day held" = both plan AND intention explicitly respected (true), nothing
  // declared broken. Null on either side is silence, not a held day.
  const held = input.planRespectedToday === true && input.intentionKept === true;

  let tone: CheckinEcho['tone'] = 'neutral';
  let main: string;

  if (planBroken) {
    tone = 'watch';
    main = EVENING_PLAN_BROKEN[register];
  } else if (intentionMissed) {
    tone = 'watch';
    main = EVENING_INTENTION_MISSED[register];
  } else if (highStress && tense) {
    tone = 'watch';
    main = EVENING_TENSE_DAY[register];
  } else if (highStress) {
    tone = 'watch';
    main = EVENING_HIGH_STRESS[register];
  } else if (held) {
    tone = 'ok';
    main = EVENING_HELD[register];
  } else {
    main = EVENING_NEUTRAL;
  }

  const lines: string[] = [main];
  if (input.learningStage) {
    lines.push(STAGE_ANCHOR[input.learningStage]);
  }

  return { title: 'Ce que ta soirée dit de ta journée', tone, lines };
}

// =============================================================================
// Evening "journée bouclée" — a calm close-of-day composed from the true facts
// of the day (finding 2). Deterministic, factual, never a score, never red.
// =============================================================================

export interface DayWrapInput {
  /** Number of trades journalized on the member's local day. */
  tradesToday: number;
  /** Did the member respect their plan today? Tri-state; null → omitted. */
  planRespectedToday: boolean | null;
  /** Did the member keep this morning's intention? Tri-state; null → omitted. */
  intentionKept: boolean | null;
  /** Did the member study the course today? Tri-state; null → omitted. */
  formationFollowed: boolean | null;
}

/**
 * Compose the "Ta journée, bouclée" line from the TRUE facts of the day only.
 * Null passthrough: a fact only appears when it is explicitly known. Never a
 * score, never red, never punitive — a plain factual recap that gives the
 * member the feeling of having closed the loop.
 *
 * Returns a single sentence (facts) plus a short calm closer. When there is
 * literally nothing true to report (no trades AND all self-reports null), we
 * still close the day warmly rather than fabricate facts.
 */
export function buildDayWrap(input: DayWrapInput): string[] {
  const facts: string[] = [];

  if (input.tradesToday === 1) {
    facts.push('1 trade journalisé');
  } else if (input.tradesToday > 1) {
    facts.push(`${input.tradesToday} trades journalisés`);
  }
  if (input.intentionKept === true) facts.push('intention tenue');
  else if (input.intentionKept === false) facts.push('intention à revoir');
  if (input.planRespectedToday === true) facts.push('plan respecté');
  else if (input.planRespectedToday === false) facts.push('plan à retravailler');
  if (input.formationFollowed === true) facts.push('formation suivie');

  const lines: string[] = [];

  if (facts.length === 0) {
    // Nothing factual to report: warm close, no fabricated facts.
    lines.push('Ta journée est bouclée. Le simple fait de la clôturer ici compte déjà.');
    return lines;
  }

  // Capitalise the first fact for a clean sentence start.
  const firstFact = facts[0]!;
  const joined = [firstFact.charAt(0).toUpperCase() + firstFact.slice(1), ...facts.slice(1)].join(
    ', ',
  );
  lines.push(`Aujourd'hui : ${joined}.`);

  // Calm closer, framed as process (never performance).
  const held = input.planRespectedToday === true && input.intentionKept === true;
  lines.push(
    held
      ? "C'est une journée de process. On repart demain matin."
      : 'Journée bouclée. On repart à zéro demain matin.',
  );

  return lines;
}
