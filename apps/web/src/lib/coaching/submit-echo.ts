import type { CoachingRegister, EchoLearningStage } from '@/lib/coaching/trade-echo';

/**
 * Tour 11 — the LIVING submit echo for the REFLECT module (finding 3).
 *
 * When a member submits a reflection (`/reflect`) or a weekly review
 * (`/review`), the landing used to answer with ONE frozen paragraph, identical
 * for everyone and blind to what they wrote. This module replaces that with a
 * short, member-specific reading of the ACT of naming a thought / closing a
 * week, declined by coaching register and stage.
 *
 * Pure module (no `server-only`, no DB) so the whole decision table is
 * unit-testable — sibling of `coaching/trade-echo.ts` (same grammar: per
 * register copy, `echoProfileDims`-derived register/stage, fallback register
 * 'pedagogique', an optional stage anchor line).
 *
 * DETERMINISTIC, ZERO AI CALL: every sentence below is FIXED French copy
 * selected by PRESENCE flags only (a disputation was written, a next-week
 * focus was written). We NEVER read the free-text content itself, so AI Act
 * §50 needs no `AIGeneratedBanner` here (precedent: trade-echo.ts).
 *
 * FIREWALL §21.5: display-only, never fed back into any score. We read only
 * `coachingTone`/`learningStage` from the profile (via `echoProfileDims`) and
 * NOTHING else — `weakSignals` and raw AI blobs never cross this boundary.
 *
 * POSTURE §31.2 / Mark Douglas: we mirror the ACT (naming the thought, closing
 * the week), never punitively, never a countdown. These are calm 'ok'/'neutral'
 * acknowledgements — the RED tone is reserved for trade outcomes and is never
 * produced here. French copy, tutoiement, simple punctuation, no em-dash.
 */

export interface SubmitEcho {
  title: string;
  /** Drives the confirmation accent only — 'ok' calm-positive, 'neutral' plain. */
  tone: 'ok' | 'neutral';
  /** 1 to 2 short sentences: main reading, optional stage anchor. */
  lines: string[];
}

/** Per-register copy for one reading. Register picked from coachingTone. */
type RegisterCopy = Record<CoachingRegister, string>;

// ===========================================================================
// REFLECT — the ABCD reflection submit echo.
// ===========================================================================

export interface ReflectSubmitEchoInput {
  /**
   * Whether the member wrote a disputation (the D of ABCD, the reframe). The
   * caller derives this from the persisted entry with a presence check ONLY,
   * never by reading the text (firewall). `false`/absent stays a valid, calm
   * acknowledgement, never a reproach.
   */
  hasDisputation: boolean;
  /** Profile dimensions (already schema-validated). Null → neutral fallback. */
  learningStage: EchoLearningStage | null;
  coachingRegister: CoachingRegister | null;
}

/** Reflection WITH a reframe written — the full ABCD loop was closed. */
const REFLECT_WITH_REFRAME: RegisterCopy = {
  direct:
    "La pensée est nommée et tu lui as déjà opposé une lecture alternative. C'est exactement le geste qui désamorce une croyance automatique.",
  pedagogique:
    "Tu as nommé la pensée et écrit sa mise en question. Nommer puis contester une croyance automatique, c'est le coeur du reframe : tu viens de faire le travail complet.",
  socratique:
    'La pensée est nommée et tu lui as opposé une autre lecture. Laquelle des deux tiendra le mieux la prochaine fois que le déclencheur reviendra ?',
};

/** Reflection captured WITHOUT a filled reframe — still a real first step. */
const REFLECT_NAMED: RegisterCopy = {
  direct:
    "La pensée est nommée. C'est déjà le premier pas : une croyance mise en mots perd de son emprise automatique.",
  pedagogique:
    "La pensée est nommée, et c'est déjà l'essentiel : mettre des mots sur une croyance automatique, c'est ce qui la rend observable au lieu de subie.",
  socratique:
    "La pensée est nommée. Qu'est-ce que tu pourrais lui opposer la prochaine fois qu'elle se présente ?",
};

/** Stage anchor for the reflect moment — mirrors trade-echo STAGE_ANCHOR frame. */
const REFLECT_STAGE_ANCHOR: Record<EchoLearningStage, string> = {
  mechanical:
    'À ton stade, répéter ce geste de mise en mots construit la discipline mentale, réflexion après réflexion.',
  subjective: 'À ton stade, ce recul écrit affine ta lecture de tes propres réactions.',
  intuitive:
    'À ton stade, nommer tes automatismes est ce qui garde ton mental aligné sur ton process.',
};

export function buildReflectSubmitEcho(input: ReflectSubmitEchoInput): SubmitEcho {
  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';
  const main = input.hasDisputation ? REFLECT_WITH_REFRAME[register] : REFLECT_NAMED[register];

  const lines: string[] = [main];
  if (input.learningStage) {
    lines.push(REFLECT_STAGE_ANCHOR[input.learningStage]);
  }

  return {
    title: 'Ce que cette réflexion pose',
    tone: 'ok',
    lines,
  };
}

// ===========================================================================
// REVIEW — the weekly review submit echo.
// ===========================================================================

export interface ReviewSubmitEchoInput {
  /**
   * Whether the member set a next-week focus. Presence check ONLY (firewall):
   * the caller never reads the focus text. `false`/absent stays a calm
   * acknowledgement of the recul itself.
   */
  hasNextWeekFocus: boolean;
  /** Profile dimensions (already schema-validated). Null → neutral fallback. */
  learningStage: EchoLearningStage | null;
  coachingRegister: CoachingRegister | null;
}

/** Review WITH a next-week focus — the recul turned into a forward intention. */
const REVIEW_WITH_FOCUS: RegisterCopy = {
  direct:
    "Ta revue est posée et tu as fixé un focus pour la semaine qui vient. Un recul qui débouche sur une intention claire, c'est ce qui fait progresser.",
  pedagogique:
    "Ta revue est enregistrée, avec un focus pour la semaine à venir. Regarder en arrière puis choisir un cap, c'est ce qui transforme une revue en levier plutôt qu'en simple bilan.",
  socratique:
    "Ta revue est posée et tu as choisi un focus pour la semaine qui vient. Qu'est-ce qui te dira, dimanche prochain, que tu l'as vraiment tenu ?",
};

/** Review WITHOUT a filled focus — the recul itself already has value. */
const REVIEW_RECORDED: RegisterCopy = {
  direct:
    "Ta revue est posée. Prendre ce recul chaque semaine vaut déjà par lui-même, c'est ce qui rend ton exécution lisible dans le temps.",
  pedagogique:
    'Ta revue est enregistrée. Le simple fait de mettre des mots sur ta semaine, sans te noter, est ce qui nourrit ta constance sur la durée.',
  socratique:
    "Ta revue est posée. S'il y avait une seule chose à garder de cette semaine pour la suivante, laquelle choisirais-tu ?",
};

/** Stage anchor for the review moment — forward-looking (the week to come). */
const REVIEW_STAGE_ANCHOR: Record<EchoLearningStage, string> = {
  mechanical:
    'À ton stade, cette revue hebdomadaire ancre le respect de tes règles semaine après semaine.',
  subjective: 'À ton stade, ce recul régulier affine ta lecture de ce qui marche dans ton process.',
  intuitive:
    'À ton stade, la régularité de ce recul est ce qui garde ta lecture alignée sur ta méthode.',
};

export function buildReviewSubmitEcho(input: ReviewSubmitEchoInput): SubmitEcho {
  const register: CoachingRegister = input.coachingRegister ?? 'pedagogique';
  const main = input.hasNextWeekFocus ? REVIEW_WITH_FOCUS[register] : REVIEW_RECORDED[register];

  const lines: string[] = [main];
  if (input.learningStage) {
    lines.push(REVIEW_STAGE_ANCHOR[input.learningStage]);
  }

  return {
    title: 'Ce que cette revue pose',
    tone: 'ok',
    lines,
  };
}
