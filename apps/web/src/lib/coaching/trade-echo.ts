import type { TradeExitReason, TradeOutcome } from '@/generated/prisma/enums';
import { coachingToneSchema, learningStageSchema } from '@/lib/schemas/onboarding-interview';
import { NEGATIVE_TRADING_EMOTIONS } from '@/lib/trading/emotions';

/** Tour 11 — a loss streak this long is the tilt/revenge danger zone. */
export const LOSS_STREAK_ECHO_THRESHOLD = 3;

/**
 * Tour 10 — the LIVING close echo. When a member closes a trade, the system
 * answers immediately on `/journal/[id]` with a short, member-specific reading
 * of what THIS close says about their process. This is the "vivant" moment:
 * the app reacts to the act, personalised, without a chatbot.
 *
 * Pure module (no `server-only`, no DB) so the whole decision table is
 * unit-testable — sibling of `objectives/learning-stage.ts`.
 *
 * DETERMINISTIC, ZERO AI CALL: every sentence below is FIXED French copy
 * selected by enum-derived rules (exitReason, planRespected, S26 acts,
 * emotionDuring clusters, coachingTone.register, learningStage.stage). We
 * never surface `rationale`/`evidence` (raw AI text), so AI Act §50 needs NO
 * `AIGeneratedBanner` here (precedent: learning-stage.ts, micro-objective).
 *
 * FIREWALL §21.5: display-only, never fed back into the behavioral score.
 * We read `coachingTone`/`learningStage` and NOTHING else from the profile —
 * `weakSignals` is admin-only and never crosses the member boundary.
 *
 * POSTURE §2 / §31.2 / Mark Douglas: we mirror the ACT (how the exit
 * happened, which rule held), never the trade's market content, and never
 * punitively — a loss inside the process is a normal cost, a win outside the
 * process is still a process point. French copy, simple punctuation, no
 * em-dash (Eliott's copy rule).
 */

export type CoachingRegister = 'direct' | 'pedagogique' | 'socratique';
export type EchoLearningStage = 'mechanical' | 'subjective' | 'intuitive';

/** The echo only shows while the close is FRESH — a reaction, not an archive. */
export const ECHO_WINDOW_HOURS = 24;

export interface TradeCloseEchoInput {
  /** ISO instant of the close. Null/absent → no echo (open trade). */
  closedAt: string | null;
  outcome: TradeOutcome | null;
  exitReason: TradeExitReason | null;
  planRespected: boolean;
  processComplete: boolean | null;
  slPerRule: boolean | null;
  movedToBe: boolean | null;
  partialAtTarget: boolean | null;
  emotionDuring: readonly string[];
  /** Open verification discrepancies attached to THIS trade. */
  openDiscrepancyCount: number;
  /**
   * Tour 11 — length of the run of consecutive losses ENDING on this trade
   * (this trade included). Only meaningful when `outcome === 'loss'`; the
   * caller passes the count it computed on the member's recent closed trades.
   * `0`/absent → no streak line. Undefined-safe (legacy callers omit it).
   */
  recentConsecutiveLosses?: number;
  /** Profile dimensions (already schema-validated). Null → neutral fallback. */
  learningStage: EchoLearningStage | null;
  coachingRegister: CoachingRegister | null;
  /** Injected clock for testability. */
  now: Date;
}

export interface TradeCloseEcho {
  title: string;
  /** Drives the card accent only — 'watch' stays calm (accent, never red). */
  tone: 'ok' | 'watch' | 'neutral';
  /** 1 to 3 short sentences: main reading, optional follow-up, stage anchor. */
  lines: string[];
}

/** Per-register copy for one signal. Register picked from coachingTone. */
type RegisterCopy = Record<CoachingRegister, string>;

/**
 * Main reading, by priority. The FIRST matching signal wins — one clear
 * mirror beats an inventory (§31.2: never a wall of reproaches).
 */
const FEAR_EXIT: RegisterCopy = {
  direct:
    "Tu es sorti avant ton objectif avec une émotion de pression au même moment. C'est ce geste qu'il faut observer, pas le résultat.",
  pedagogique:
    "Tu es sorti avant ton objectif pendant un moment d'émotion. Une sortie anticipée sous pression coupe ce que ton plan était censé capturer, c'est le geste qui coûte le plus cher sur la durée.",
  socratique:
    "Tu es sorti avant ton objectif pendant un moment d'émotion. Qu'est-ce qui a pesé le plus à cet instant, ton plan ou la pression ?",
};

const EARLY_EXIT: RegisterCopy = {
  direct:
    "Sortie avant l'objectif prévu. Note ce qui t'a fait sortir, c'est une donnée précieuse pour ton process.",
  pedagogique:
    "Tu es sorti avant l'objectif prévu. Comprendre ce qui déclenche ces sorties, c'est ce qui rend ton plan exécutable jusqu'au bout.",
  socratique:
    "Sortie avant l'objectif prévu. Si tu rejouais ce moment, qu'est-ce qui t'aiderait à tenir jusqu'au plan ?",
};

const PLAN_BROKEN: RegisterCopy = {
  direct:
    "L'entrée était hors plan. Le résultat ne change rien à ce point, c'est le prochain trade qui compte.",
  pedagogique:
    "L'entrée s'est faite hors plan. Un plan tenu rend chaque résultat lisible, un plan cassé rend même un gain difficile à exploiter.",
  socratique:
    "L'entrée était hors plan. Qu'est-ce qui aurait dû se passer pour que tu la laisses passer ?",
};

const FORGOT_STEPS: RegisterCopy = {
  direct:
    'Des étapes du process ont été oubliées sur ce trade. Reprends ta checklist avant la prochaine entrée.',
  pedagogique:
    "Des étapes du process ont sauté sur ce trade. C'est souvent le signe d'une exécution pressée, ta checklist existe pour ça.",
  socratique:
    'Des étapes ont sauté sur ce trade. Laquelle aurait le plus changé ton exécution si elle avait été faite ?',
};

const MANAGEMENT_MISSED: RegisterCopy = {
  direct:
    "Ta gestion n'a pas suivi ta règle sur ce trade (stop, break-even ou sécurisation). Un point à reprendre, calmement.",
  pedagogique:
    "Une de tes règles de gestion n'a pas été tenue sur ce trade. Ces règles sont ta protection quand le marché décide, les tenir rend tes résultats reproductibles.",
  socratique:
    "Une règle de gestion n'a pas été tenue ici. Qu'est-ce qui l'a rendue difficile à appliquer sur ce trade ?",
};

const CLEAN_LOSS: RegisterCopy = {
  direct:
    'Perte dans le process : un coût normal du métier, pas une erreur. Ton exécution était propre.',
  pedagogique:
    'Ce trade est perdant mais ton exécution était propre. Une perte dans le process est un coût statistique, pas une faute.',
  socratique:
    'Perte, mais exécution propre. Si chaque perte ressemblait à celle-ci, ton process tiendrait-il la distance ?',
};

const CLEAN_WIN: RegisterCopy = {
  direct:
    "Exécution propre et résultat au rendez-vous. C'est la répétition de ce geste qui construit ta constance.",
  pedagogique:
    "Exécution propre, résultat positif. Ce qui compte n'est pas le gain, c'est qu'il vient de ton process : c'est répétable.",
  socratique:
    "Gain obtenu dans le process. Qu'est-ce qui a rendu cette exécution facile à tenir, et comment le reproduire ?",
};

const CLEAN_BE: RegisterCopy = {
  direct: 'Break-even dans le process : capital préservé, exécution propre.',
  pedagogique:
    "Break-even avec une exécution propre : ton risque a été géré, c'est le process qui protège ton capital.",
  socratique: 'Break-even, exécution tenue. Que retiens-tu de la gestion de ce trade ?',
};

/** Douglas "winning bad trade" follow-up — added when a WIN carries a process miss. */
const WIN_BUT_BROKEN =
  "Le gain n'efface pas le geste : c'est le process qui rend les résultats répétables.";

/**
 * Tour 11 anti-tilt follow-up — added when this loss ENDS a run of at least
 * {@link LOSS_STREAK_ECHO_THRESHOLD} consecutive losses (the tilt/revenge
 * danger zone). Anchored on the variance doctrine of `analytics/streaks.ts`
 * (Douglas / Van Tharp): a streak inside a sample is normal variance, the edge
 * is not judged on a run. It is a FOLLOW-UP line only — it never sets the card
 * tone (the main clean-loss reading stays 'ok'), never a countdown, never
 * punitive. Register-aware; `count` is interpolated in French words to stay warm.
 */
function lossStreakFollowUp(count: number, register: CoachingRegister): string {
  const nth = ordinalLossFr(count);
  const copy: RegisterCopy = {
    direct: `${nth} perte d'affilée. Sur un échantillon, une série comme celle-ci reste dans la variance normale : ton edge ne se juge pas sur une série. Garde ta taille de position, ne cherche pas à te refaire.`,
    pedagogique: `${nth} perte d'affilée. Statistiquement, une série de pertes arrive même avec un bon process, c'est la variance normale d'un échantillon. Ce moment est celui où l'on augmente la taille pour se refaire : c'est exactement ce qu'il faut éviter.`,
    socratique: `${nth} perte d'affilée. Une série de pertes reste dans la variance normale d'un échantillon. Qu'est-ce qui protégerait le mieux ton capital là maintenant, respecter ta taille habituelle ou tenter de te refaire ?`,
  };
  return copy[register];
}

/** French ordinal for the streak length ("Troisième", "Quatrième", ...). */
function ordinalLossFr(count: number): string {
  const words: Record<number, string> = {
    3: 'Troisième',
    4: 'Quatrième',
    5: 'Cinquième',
    6: 'Sixième',
    7: 'Septième',
    8: 'Huitième',
  };
  return words[count] ?? `${count}e`;
}

/** Verification follow-up — same factual wording family as the journal badge. */
const DISCREPANCY_OPEN =
  'Un écart de vérification est encore ouvert sur ce trade, va le regarder dans Vérification.';

/**
 * Stage anchor — closes the echo on WHERE this member's work currently lives.
 * Mirrors the `learning-stage.ts` hints so both surfaces speak the same frame.
 */
const STAGE_ANCHOR: Record<EchoLearningStage, string> = {
  mechanical: 'À ton stade, la priorité reste le respect strict de tes règles, trade après trade.',
  subjective: "À ton stade, garde ton cadre comme garde-fou pendant que ta lecture s'affine.",
  intuitive: 'À ton stade, la constance de ton process est ce qui transforme ta lecture en edge.',
};

/**
 * Neutral fallback when the close carries no readable signal at all (every
 * self-report skipped AND the entry was declared off-plan is absent). Rare.
 */
const NEUTRAL_FALLBACK =
  'Trade clôturé et journalisé. Chaque clôture documentée nourrit ton suivi.';

function hasNegativeDuring(emotionDuring: readonly string[]): boolean {
  return emotionDuring.some((slug) => NEGATIVE_TRADING_EMOTIONS.has(slug));
}

/**
 * Build the close echo. Returns `null` when the trade is open or the close is
 * older than {@link ECHO_WINDOW_HOURS} (the echo is a reaction to the event,
 * not a permanent verdict pinned on the trade — §31.2).
 */
export function buildTradeCloseEcho(input: TradeCloseEchoInput): TradeCloseEcho | null {
  if (!input.closedAt) return null;
  const closedMs = Date.parse(input.closedAt);
  if (Number.isNaN(closedMs)) return null;
  const ageMs = input.now.getTime() - closedMs;
  if (ageMs < 0 || ageMs > ECHO_WINDOW_HOURS * 60 * 60 * 1000) return null;

  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';

  const managementMissed =
    input.slPerRule === false || input.movedToBe === false || input.partialAtTarget === false;
  const fearExit =
    input.exitReason === 'manual_before_target' && hasNegativeDuring(input.emotionDuring);
  const earlyExit = input.exitReason === 'manual_before_target' && !fearExit;
  const planBroken = input.planRespected === false;
  const forgotSteps = input.processComplete === false;
  const processMiss = fearExit || earlyExit || planBroken || forgotSteps || managementMissed;
  // "Clean" = the entry was in-plan and nothing was DECLARED broken. Null
  // self-reports never fabricate a miss (SPEC §2 null-passthrough).
  const processClean = !processMiss && input.planRespected === true;

  let tone: TradeCloseEcho['tone'] = 'neutral';
  let main: string | null = null;

  if (fearExit) {
    tone = 'watch';
    main = FEAR_EXIT[register];
  } else if (earlyExit) {
    tone = 'watch';
    main = EARLY_EXIT[register];
  } else if (planBroken) {
    tone = 'watch';
    main = PLAN_BROKEN[register];
  } else if (forgotSteps) {
    tone = 'watch';
    main = FORGOT_STEPS[register];
  } else if (managementMissed) {
    tone = 'watch';
    main = MANAGEMENT_MISSED[register];
  } else if (processClean && input.outcome === 'loss') {
    tone = 'ok';
    main = CLEAN_LOSS[register];
  } else if (processClean && input.outcome === 'win') {
    tone = 'ok';
    main = CLEAN_WIN[register];
  } else if (processClean && input.outcome === 'break_even') {
    tone = 'ok';
    main = CLEAN_BE[register];
  } else {
    main = NEUTRAL_FALLBACK;
  }

  const lines: string[] = [main];

  // One optional follow-up, in priority order — never more than one (3 lines
  // max). A loss streak and a win are mutually exclusive by construction, so
  // the streak line slots between WIN_BUT_BROKEN and DISCREPANCY_OPEN without
  // ever colliding with the winning-bad-trade line.
  const lossStreak = input.recentConsecutiveLosses ?? 0;
  if (input.outcome === 'win' && processMiss) {
    lines.push(WIN_BUT_BROKEN);
  } else if (input.outcome === 'loss' && lossStreak >= LOSS_STREAK_ECHO_THRESHOLD) {
    lines.push(lossStreakFollowUp(lossStreak, register));
  } else if (input.openDiscrepancyCount > 0) {
    lines.push(DISCREPANCY_OPEN);
  }

  if (input.learningStage) {
    lines.push(STAGE_ANCHOR[input.learningStage]);
  }

  return {
    title: 'Ce que cette clôture dit de ton process',
    tone,
    lines,
  };
}

// ===========================================================================
// Tour 11 — the OPEN echo. Finding 1: when a member OPENS a trade,
// `createTradeAction` redirects to `/journal/{id}` with the position still
// open (`closedAt === null`), so the close echo returns null and the member
// sees no reaction. Yet plan-respect, the entry emotions and the stop-loss are
// ALREADY declared at entry. We accueille the ENGAGEMENT (never accuse: the
// trade just opened, no outcome exists), mirroring only the ACT of entering.
//
// POSTURE §31.2 / Mark Douglas: never red, never punitive, never a countdown.
// An off-plan entry or a negative entry emotion is a calm 'watch' (accent),
// a clean in-plan entry with a stop is an 'ok' acknowledgement. FIREWALL
// §21.5: reads only enum/boolean self-reports + `coachingTone`/`learningStage`,
// never `weakSignals` or raw AI blobs.
// ===========================================================================

export interface TradeOpenEchoInput {
  /** ISO instant the trade was OPENED in the app (Trade.createdAt). Null → no echo. */
  openedAt: string | null;
  planRespected: boolean;
  /** Emotions declared at entry (Trade.emotionBefore). */
  emotionBefore: readonly string[];
  /** Whether a stop-loss price was set at entry. */
  hasStopLoss: boolean;
  /** Profile dimensions (already schema-validated). Null → neutral fallback. */
  learningStage: EchoLearningStage | null;
  coachingRegister: CoachingRegister | null;
  /** Injected clock for testability. */
  now: Date;
}

export interface TradeOpenEcho {
  title: string;
  /** Accent only — 'watch' stays calm (accent, never red), 'ok' acknowledges. */
  tone: 'ok' | 'watch' | 'neutral';
  /** 1 to 2 short sentences: entry reading, optional stage anchor. */
  lines: string[];
}

/** Off-plan entry — declared out of plan at the moment of engagement. */
const OPEN_OFF_PLAN: RegisterCopy = {
  direct:
    "Entrée déclarée hors plan. Tu l'as notée, c'est déjà de la lucidité : observe ce qui t'a fait entrer, pas le résultat à venir.",
  pedagogique:
    "Tu es entré en te déclarant hors plan. Reconnaître l'écart au moment de l'entrée, c'est déjà travailler ta discipline : la gestion de la position reste entièrement entre tes mains.",
  socratique:
    "Entrée déclarée hors plan. Qu'est-ce qui a rendu cette entrée difficile à laisser passer ?",
};

/** Entry under a negative emotion (in-plan) — accueil, jamais reproche. */
const OPEN_TENSE: RegisterCopy = {
  direct:
    "Tu entres avec une émotion de tension notée. C'est une bonne donnée : garde ta gestion telle que prévue, laisse le plan travailler.",
  pedagogique:
    "Tu es entré en notant une émotion de tension. En avoir conscience à l'entrée est déjà un atout : ta gestion prévue est ce qui te protège maintenant.",
  socratique:
    "Tu entres avec une émotion de tension notée. Qu'est-ce qui t'aiderait à laisser ton plan travailler sans y toucher ?",
};

/** Clean, in-plan entry WITH a stop — acknowledge the engagement. */
const OPEN_CLEAN: RegisterCopy = {
  direct: 'Entrée dans le plan, stop en place. Le cadre est posé, laisse-le travailler.',
  pedagogique:
    "Entrée dans le plan avec un stop défini : ton cadre de risque est posé avant que le marché décide, c'est exactement ce qui rend une position tenable.",
  socratique:
    'Entrée dans le plan, stop en place. Que retiens-tu de la préparation qui a rendu cette entrée simple à poser ?',
};

/** In-plan entry WITHOUT a stop — a calm nudge, never a reproach. */
const OPEN_NO_STOP: RegisterCopy = {
  direct:
    "Entrée dans le plan. Aucun stop n'est défini sur ce trade : un stop rend ton risque exact et ton R lisible à la clôture.",
  pedagogique:
    "Entrée dans le plan. Il n'y a pas de stop défini ici : le poser, c'est ce qui borne ton risque et rend ton R exact quand tu clôtureras.",
  socratique:
    'Entrée dans le plan, sans stop défini. Où placerais-tu ton stop pour que ton risque reste borné sur ce trade ?',
};

/** Stage anchor for the OPEN moment — forward-looking (management to come). */
const OPEN_STAGE_ANCHOR: Record<EchoLearningStage, string> = {
  mechanical: 'À ton stade, la priorité reste de tenir tes règles jusqu’à la sortie.',
  subjective: 'À ton stade, garde ton cadre comme garde-fou pendant que tu gères la position.',
  intuitive: 'À ton stade, la constance de ta gestion est ce qui transforme ta lecture en edge.',
};

/**
 * Build the OPEN echo. Returns `null` when the trade is not fresh: no
 * `openedAt`, malformed, or older than {@link ECHO_WINDOW_HOURS} (the echo is
 * a reaction to the engagement, not a verdict pinned on the trade — §31.2).
 */
export function buildTradeOpenEcho(input: TradeOpenEchoInput): TradeOpenEcho | null {
  if (!input.openedAt) return null;
  const openedMs = Date.parse(input.openedAt);
  if (Number.isNaN(openedMs)) return null;
  const ageMs = input.now.getTime() - openedMs;
  if (ageMs < 0 || ageMs > ECHO_WINDOW_HOURS * 60 * 60 * 1000) return null;

  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';

  const offPlan = input.planRespected === false;
  const tenseEntry = hasNegativeDuring(input.emotionBefore);

  let tone: TradeOpenEcho['tone'];
  let main: string;

  if (offPlan) {
    // Off-plan entry is the one act worth mirroring first (calm, never red).
    tone = 'watch';
    main = OPEN_OFF_PLAN[register];
  } else if (tenseEntry) {
    tone = 'watch';
    main = OPEN_TENSE[register];
  } else if (input.hasStopLoss) {
    tone = 'ok';
    main = OPEN_CLEAN[register];
  } else {
    tone = 'watch';
    main = OPEN_NO_STOP[register];
  }

  const lines: string[] = [main];
  if (input.learningStage) {
    lines.push(OPEN_STAGE_ANCHOR[input.learningStage]);
  }

  return {
    title: 'Ce que cette ouverture dit de ton engagement',
    tone,
    lines,
  };
}

/**
 * Coerce the Prisma JSON profile blobs into the two enum inputs the echo
 * needs. SafeParse never throws on null/garbage; malformed/legacy rows
 * degrade to the neutral fallback instead of fabricating a persona.
 */
export function echoProfileDims(
  profile: {
    coachingTone: unknown;
    learningStage: unknown;
  } | null,
): { coachingRegister: CoachingRegister | null; learningStage: EchoLearningStage | null } {
  const toneParsed = coachingToneSchema.safeParse(profile?.coachingTone);
  const stageParsed = learningStageSchema.safeParse(profile?.learningStage);
  return {
    coachingRegister: toneParsed.success ? toneParsed.data.register : null,
    learningStage: stageParsed.success ? stageParsed.data.stage : null,
  };
}
