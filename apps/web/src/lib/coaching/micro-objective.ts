import 'server-only';

import { cache } from 'react';

import { db } from '@/lib/db';
import type { TrackingAxis } from '@/generated/prisma/enums';
import { echoProfileDims, type CoachingRegister } from '@/lib/coaching/trade-echo';
import { getMentalMap } from './service';
import type { MentalAxis, MentalMapEntry } from './mental-map';

/**
 * S5 §32-E3 — Boucle d'engagement saine : micro-objectif mental/discipline.
 *
 * WHY (brief §32-E3). À partir des insights du moteur de coaching, l'app propose
 * au membre UN micro-objectif mental ancré dans Mark Douglas (tenir une routine,
 * être honnête sur un manquement, accepter l'incertitude d'un résultat), puis
 * **referme la boucle au prochain passage** (suivi : « l'as-tu tenu ? »). La
 * progression mesurable (livrable C) = tenus / (tenus + manqués) sur les boucles
 * refermées. Un seul objectif ouvert à la fois (l'app propose UNE chose, jamais
 * une liste qui noie le message — §33.2).
 *
 * 🛡️ GARDE-FOU §2/§33.2 : process/mental uniquement. La copie (`title`/`intention`)
 * est CURÉE et déterministe (réutilise l'`action` de la carte mentale E1, elle-même
 * figée et testée anti-marché) → jamais d'analyse de marché, jamais d'`AIGeneratedBanner`.
 * Firewall §21.5 : la seule relation est User (cascade RGPD §17) — aucune FK vers
 * l'edge réel. Posture §31.2 : un `missed` est une DONNÉE de progression, jamais
 * un reproche ni un compte à rebours.
 */

export type MicroObjectiveStatusView = 'open' | 'kept' | 'missed' | 'dismissed';
/** Comment le membre referme la boucle (suivi au prochain passage). */
export type MicroObjectiveOutcome = 'kept' | 'missed' | 'dismissed';

export interface MicroObjectiveView {
  readonly id: string;
  readonly axis: string;
  readonly title: string;
  readonly intention: string;
  readonly status: MicroObjectiveStatusView;
  /** Motif d'origine tracé (E2/B) : 'alert'|'signal' + ref. */
  readonly sourceKind: string;
  readonly sourceRef: string;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

/**
 * Graine d'un micro-objectif — dérivée d'une entrée de carte mentale OU d'une
 * correction admin taggée d'un axe (J-AI corrections echo). `sourceKind` trace
 * l'origine : `alert`/`signal` = moteur de coaching (carte mentale), `annotation`
 * = une correction admin porteuse d'un `TrackingAxis`. Jamais une FK (firewall §21.5).
 */
export interface MicroObjectiveSeed {
  readonly axis: MentalAxis;
  readonly sourceKind: 'alert' | 'signal' | 'annotation';
  readonly sourceRef: string;
  readonly title: string;
  readonly intention: string;
}

/** Titre court Mark Douglas par axe (engagement doux, jamais un verdict). */
const MICRO_OBJECTIVE_TITLES: Record<MentalAxis, string> = {
  discipline: 'Tenir ta routine, un jour à la fois',
  honesty: 'Rester honnête avec toi-même',
  ego: 'Regarder les faits en face, sans te juger',
  consistency: 'Faire de la régularité ton edge silencieux',
};

/**
 * J-AI corrections echo — projette un `TrackingAxis` (11 axes méthodo,
 * `lib/tracking/axes.ts`) sur le `MentalAxis` (4 axes Mark Douglas) qui porte le
 * micro-objectif. Les axes de PROCESS/discipline (exécution, risque, prépa,
 * sommeil, routine) tirent vers `discipline` ; le bilan honnête tire vers
 * `honesty` ; le travail sur soi et les émotions/confiance vers `ego`
 * (acceptation de l'incertitude, détachement) ; l'assiduité et la régularité
 * (entraînement, formation, réunions) vers `consistency`. Table exhaustive
 * (`satisfies Record<TrackingAxis, …>`) → un nouvel axe Prisma casse la compilation
 * tant qu'il n'a pas sa projection ici (zéro axe orphelin).
 */
const AXIS_TO_MENTAL: Record<TrackingAxis, MentalAxis> = {
  execution: 'discipline',
  risk_discipline: 'discipline',
  market_analysis: 'discipline',
  routine: 'discipline',
  sleep_lifestyle: 'discipline',
  evening_review: 'honesty',
  self_work: 'ego',
  emotions_confidence: 'ego',
  training: 'consistency',
  formation: 'consistency',
  meeting_presence: 'consistency',
} satisfies Record<TrackingAxis, MentalAxis>;

/**
 * Intention curée (déterministe, anti-marché déjà testé) par axe mental — jouée
 * quand la graine vient d'une correction admin (pas d'entrée de carte mentale
 * dont réutiliser l'`action`). Un seul pas doux, ancré discipline/mental.
 */
const ANNOTATION_INTENTIONS: Record<MentalAxis, string> = {
  discipline:
    'Ton coach a relevé ce point dans une correction. Aujourd’hui, tiens ton process sur cet aspect, un pas à la fois.',
  honesty:
    'Ton coach a relevé ce point dans une correction. Aujourd’hui, regarde tes faits en face, sans te juger.',
  ego: 'Ton coach a relevé ce point dans une correction. Aujourd’hui, accueille l’inconfort sans le fuir, avec détachement.',
  consistency:
    'Ton coach a relevé ce point dans une correction. Aujourd’hui, mise sur la régularité plutôt que sur le résultat.',
};

export class MicroObjectiveNotFoundError extends Error {
  override readonly name = 'MicroObjectiveNotFoundError';
  constructor() {
    super('Micro-objective not found or access denied.');
  }
}

/**
 * Tour 11 (FINDING 1) — L'ÉCHO DE FERMETURE. Refermer la boucle était muet
 * (`{ok:true}` nu, aucun retour) : c'était pourtant LE moment Mark Douglas
 * (nommer l'acte). On répond désormais par une copie FR FIXE, personnalisée par
 * `register`, jouée en `role="status"` à la place du silence.
 *
 * DÉTERMINISTE, ZÉRO IA : chaque phrase est figée et sélectionnée par
 * (`outcome`, `register`). Sœur pure de `trade-echo.ts` (même patron : table de
 * copie par register, fenêtre de fraîcheur côté trade, max 3 lignes).
 *
 * POSTURE §31.2 / Mark Douglas : miroir de l'ACTE, jamais punitif.
 *   - `kept`     → renforcement (la répétition construit la constance) ;
 *   - `missed`   → cadre-donnée non punitif (une donnée sur la difficulté du
 *                  geste, PAS un échec) — jamais rouge, jamais culpabilisant ;
 *   - `dismissed`→ neutre (l'objectif ne collait pas, on repart libre).
 * Tone `ok`/`neutral` uniquement (le rouge reste réservé aux outcomes de trade).
 */
export type MicroObjectiveCloseEcho = {
  /** Pilote l'accent calme de la confirmation — jamais 'bad'/rouge (§31.2). */
  readonly tone: 'ok' | 'neutral';
  /** 1 à 2 phrases courtes : le miroir de l'acte, puis un cap doux optionnel. */
  readonly lines: readonly string[];
};

type CloseEchoCopy = Record<CoachingRegister, MicroObjectiveCloseEcho>;

/** `kept` — renforcement : c'est la répétition du geste qui construit la constance. */
const CLOSE_ECHO_KEPT: CloseEchoCopy = {
  direct: {
    tone: 'ok',
    lines: [
      "Tu l'as tenu. C'est la répétition de ce geste qui construit ta constance.",
      'Un pas de plus dans la bonne direction, garde ce cap.',
    ],
  },
  pedagogique: {
    tone: 'ok',
    lines: [
      "Tu l'as tenu. C'est la répétition de ce geste, jour après jour, qui construit ta constance.",
      "Ce n'est pas un exploit isolé qui compte, c'est le fait de le refaire : tu viens de le prouver.",
    ],
  },
  socratique: {
    tone: 'ok',
    lines: [
      "Tu l'as tenu. C'est la répétition de ce geste qui construit ta constance.",
      "Qu'est-ce qui t'a aidé à le tenir cette fois, et comment le reproduire ?",
    ],
  },
};

/** `missed` — cadre-donnée non punitif : une donnée sur la difficulté, jamais un échec. */
const CLOSE_ECHO_MISSED: CloseEchoCopy = {
  direct: {
    tone: 'neutral',
    lines: [
      "Pas encore tenu. C'est une donnée sur la difficulté du geste, pas un échec.",
      'Tu sais maintenant où porter ton attention au prochain passage.',
    ],
  },
  pedagogique: {
    tone: 'neutral',
    lines: [
      "Pas encore tenu, et c'est une information utile : ce geste te demande plus d'attention qu'il n'y paraît.",
      "Une boucle manquée n'est pas une faute, c'est une donnée sur ta difficulté du moment. On repart de là.",
    ],
  },
  socratique: {
    tone: 'neutral',
    lines: [
      "Pas encore tenu. C'est une donnée sur la difficulté du geste, pas un échec.",
      "Qu'est-ce qui a rendu ce geste difficile à tenir cette fois ?",
    ],
  },
};

/** `dismissed` — neutre : l'objectif ne collait pas, on repart libre pour le suivant. */
const CLOSE_ECHO_DISMISSED: CloseEchoCopy = {
  direct: {
    tone: 'neutral',
    lines: ["C'est noté, cet objectif ne collait pas. La place est libre pour le prochain."],
  },
  pedagogique: {
    tone: 'neutral',
    lines: [
      "C'est noté, cet objectif ne te parlait pas. Écarter ce qui ne colle pas fait aussi partie du travail : la place est libre pour le prochain.",
    ],
  },
  socratique: {
    tone: 'neutral',
    lines: ["C'est noté, cet objectif ne collait pas. La place est libre pour le prochain."],
  },
};

const CLOSE_ECHO_BY_OUTCOME: Record<MicroObjectiveOutcome, CloseEchoCopy> = {
  kept: CLOSE_ECHO_KEPT,
  missed: CLOSE_ECHO_MISSED,
  dismissed: CLOSE_ECHO_DISMISSED,
};

/**
 * PURE — l'écho de fermeture pour un `(outcome, register)`. Fallback register
 * `'pedagogique'` (comme `trade-echo.ts`) quand le profil est absent/illisible.
 * Exporté pour être testé en isolation.
 */
export function buildMicroObjectiveCloseEcho(
  outcome: MicroObjectiveOutcome,
  register: CoachingRegister | null,
): MicroObjectiveCloseEcho {
  return CLOSE_ECHO_BY_OUTCOME[outcome][register ?? 'pedagogique'];
}

/**
 * Charge le `register` de coaching du membre (dimension IA `coachingTone`),
 * dérivé via `echoProfileDims` (safeParse, garbage → null, fallback en aval
 * sur `'pedagogique'`). FIREWALL §21.5 : on ne lit QUE `coachingTone`, jamais
 * `weakSignals` ni les blobs bruts (rationale/evidence). `null` si aucun profil.
 */
export async function getMemberCoachingRegister(
  memberId: string,
): Promise<CoachingRegister | null> {
  const profile = await db.memberProfile.findFirst({
    where: { userId: memberId },
    select: { coachingTone: true, learningStage: true },
  });
  return echoProfileDims(profile).coachingRegister;
}

/**
 * Tour 11 (FINDING 2) — au-delà de ce seuil, une boucle ouverte reçoit UNE
 * relance douce (jamais un compte à rebours, jamais rouge). Le calcul est
 * server-side (`isMicroObjectiveStale` ci-dessous) : le membre ne voit qu'un
 * booléen, pas un décompte anxiogène.
 */
export const MICRO_OBJECTIVE_STALE_DAYS = 14;

/**
 * PURE — une boucle ouverte est « en sommeil » quand elle date de plus de
 * {@link MICRO_OBJECTIVE_STALE_DAYS} jours. Sert la relance douce membre : un
 * objectif oublié GÈLE toute nouvelle boucle (invariant ≤1 ouvert), donc on
 * invite calmement le membre à le refermer (tenu / pas encore / le laisser
 * partir) plutôt que de le laisser bloqué en silence. FACTUEL, jamais punitif
 * (§31.2). Pas d'auto-close dans ce tour — c'est le membre qui décide.
 * `now` injectable pour la testabilité.
 */
export function isMicroObjectiveStale(createdAt: Date, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs >= MICRO_OBJECTIVE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * PURE — choisit la graine du micro-objectif depuis la carte mentale du membre :
 * la première entrée ACTIONNABLE (tone ≠ 'positive' : on ne propose pas de
 * « travailler » quand tout va bien). Les entrées arrivent déjà triées par
 * priorité (alerte > vigilance), donc on prend la tête. `null` si rien à
 * travailler (aucune entrée, ou que du positif) → pas de micro-objectif fabriqué.
 *
 * L'`intention` réutilise l'`action` curée de l'entrée (DRY + anti-marché déjà
 * testé) ; le `title` est un cap Mark Douglas par axe.
 */
export function selectMicroObjectiveSeed(
  entries: readonly MentalMapEntry[],
): MicroObjectiveSeed | null {
  const entry = entries.find((e) => e.tone !== 'positive');
  if (!entry) return null;
  // Seules les sources alerte/signal sont actionnables (le positif est exclu ci-dessus).
  if (entry.source.kind === 'positive') return null;
  const sourceRef = entry.source.kind === 'alert' ? entry.source.alertId : entry.source.reason;
  return {
    axis: entry.axis,
    sourceKind: entry.source.kind,
    sourceRef,
    title: MICRO_OBJECTIVE_TITLES[entry.axis],
    intention: entry.action,
  };
}

export interface EnsureMicroObjectiveResult {
  readonly created: boolean;
  readonly objectiveId: string | null;
}

/** Prisma unique-constraint violation (P2002), détectée sans tirer `@prisma/client`. */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
}

/**
 * Garantit qu'un membre a AU PLUS un micro-objectif ouvert. Idempotent : si une
 * boucle est déjà ouverte, on ne touche à rien (le membre la referme d'abord au
 * prochain passage). Sinon on en sème un depuis sa carte mentale courante. Sûr à
 * appeler à chaque passage du membre OU depuis le batch de vérification (D).
 *
 * 🛡️ INVARIANT « ≤1 ouvert » DURABLE (re-challenge S5 #3). Le `findFirst` n'est qu'un
 * court-circuit perf : entre lui et le `create`, deux passages `after()` quasi
 * simultanés (deux actions membre rapprochées — `scheduler.ts`) interlacent leurs
 * `await` et liraient TOUS DEUX « aucun ouvert » → deux insertions → un orphelin
 * ouvert permanent. Le vrai garant est l'index unique PARTIEL
 * `mental_micro_objectives_one_open_per_member` (Postgres, `WHERE status='open'`,
 * cluster-wide, donc multi-process/multi-instance) : la 2e insertion concurrente
 * échoue en P2002, qu'on récupère ici en no-op (on relit l'ouvert gagnant). 0 doublon
 * possible, jamais.
 */
export async function ensureMicroObjectiveForMember(
  memberId: string,
): Promise<EnsureMicroObjectiveResult> {
  const existing = await db.mentalMicroObjective.findFirst({
    where: { memberId, status: 'open' },
    select: { id: true },
  });
  if (existing) return { created: false, objectiveId: existing.id };

  const seed = selectMicroObjectiveSeed(await getMentalMap(memberId));
  if (!seed) return { created: false, objectiveId: null };

  try {
    const row = await db.mentalMicroObjective.create({
      data: {
        memberId,
        axis: seed.axis,
        sourceKind: seed.sourceKind,
        sourceRef: seed.sourceRef,
        title: seed.title,
        intention: seed.intention,
      },
      select: { id: true },
    });
    return { created: true, objectiveId: row.id };
  } catch (err) {
    // Course perdue : un autre passage a semé la boucle entre notre `findFirst` et
    // notre `create` (l'index partiel l'a rejetée). On relit l'ouvert gagnant — la
    // boucle existe bien, on n'en a juste pas été l'auteur.
    if (isUniqueConstraintError(err)) {
      const winner = await db.mentalMicroObjective.findFirst({
        where: { memberId, status: 'open' },
        select: { id: true },
      });
      return { created: false, objectiveId: winner?.id ?? null };
    }
    throw err;
  }
}

/**
 * J-AI corrections echo — sème un micro-objectif à partir d'une correction admin
 * porteuse d'un `TrackingAxis`. L'admin qui tague une correction d'un axe engage
 * le membre sur ce point Mark Douglas au prochain passage.
 *
 * 🛡️ MÊME INVARIANT « ≤1 ouvert » que `ensureMicroObjectiveForMember` : idempotent,
 * si une boucle est déjà ouverte on ne touche à rien (le membre la referme d'abord).
 * L'index partiel `mental_micro_objectives_one_open_per_member` est le vrai garant
 * (P2002 → no-op ici) : deux corrections rapprochées ne peuvent pas semer deux boucles.
 * `sourceKind='annotation'`, `sourceRef` = l'id de l'annotation (trace, jamais une FK
 * — firewall §21.5). La copie (`title`/`intention`) est CURÉE + déterministe → jamais
 * d'analyse de marché, jamais d'`AIGeneratedBanner`.
 */
export async function ensureMicroObjectiveFromAnnotation(
  memberId: string,
  axis: TrackingAxis,
  annotationId: string,
): Promise<EnsureMicroObjectiveResult> {
  const existing = await db.mentalMicroObjective.findFirst({
    where: { memberId, status: 'open' },
    select: { id: true },
  });
  if (existing) return { created: false, objectiveId: existing.id };

  const mentalAxis = AXIS_TO_MENTAL[axis];
  try {
    const row = await db.mentalMicroObjective.create({
      data: {
        memberId,
        axis: mentalAxis,
        sourceKind: 'annotation',
        sourceRef: annotationId,
        title: MICRO_OBJECTIVE_TITLES[mentalAxis],
        intention: ANNOTATION_INTENTIONS[mentalAxis],
      },
      select: { id: true },
    });
    return { created: true, objectiveId: row.id };
  } catch (err) {
    // Course perdue : une autre correction/passage a semé la boucle entre notre
    // `findFirst` et notre `create` (l'index partiel l'a rejetée). No-op : on
    // relit l'ouvert gagnant — la boucle existe, on n'en est juste pas l'auteur.
    if (isUniqueConstraintError(err)) {
      const winner = await db.mentalMicroObjective.findFirst({
        where: { memberId, status: 'open' },
        select: { id: true },
      });
      return { created: false, objectiveId: winner?.id ?? null };
    }
    throw err;
  }
}

/**
 * Tour 11 (FINDING 3) — projette le `dimensionId` d'un signal faible (slug libre
 * de dimension d'instrument, ex `discipline_plan_adherence`) sur le `MentalAxis`
 * (4 axes Mark Douglas) qui portera le micro-objectif semé depuis ce signal.
 *
 * On ne lit QUE le préfixe technique du slug (jamais le TEXTE du signal — firewall
 * §21.5 : le contenu du weakSignal ne traverse JAMAIS vers le membre). Table de
 * préfixes curée + fallback `discipline` (l'axe process le plus neutre) pour tout
 * slug inconnu → jamais de crash, jamais d'axe fabriqué à partir de texte libre.
 */
const DIMENSION_PREFIX_TO_MENTAL: Record<string, MentalAxis> = {
  discipline: 'discipline',
  risk: 'discipline',
  execution: 'discipline',
  plan: 'discipline',
  routine: 'discipline',
  process: 'discipline',
  honesty: 'honesty',
  review: 'honesty',
  bilan: 'honesty',
  ego: 'ego',
  emotion: 'ego',
  emotions: 'ego',
  confidence: 'ego',
  fear: 'ego',
  consistency: 'consistency',
  regularity: 'consistency',
  training: 'consistency',
  formation: 'consistency',
};

export function mentalAxisFromDimensionId(dimensionId: string): MentalAxis {
  const prefix = dimensionId.toLowerCase().split(/[_-]/)[0] ?? '';
  return DIMENSION_PREFIX_TO_MENTAL[prefix] ?? 'discipline';
}

/**
 * Tour 11 (FINDING 3) — sème un micro-objectif depuis un SIGNAL FAIBLE admin
 * (onglet profil). Jusqu'ici la seule voie de semis était l'annotation sur un
 * trade précis : le coach lisait les signaux faibles mais ne pouvait pas les
 * convertir en engagement membre. Cette action referme le vide.
 *
 * 🛡️ FIREWALL §21.5 ABSOLU : le TEXTE du signal ne traverse JAMAIS vers le membre.
 * La copie membre (`title`/`intention`) est une intention CURÉE déterministe par
 * axe mental (réutilise `MICRO_OBJECTIVE_TITLES` + `ANNOTATION_INTENTIONS`, déjà
 * figées et anti-marché) ; `sourceRef` est un string OPAQUE (le `dimensionId` du
 * signal, une trace technique), jamais une FK, jamais le contenu du signal.
 *
 * 🛡️ MÊME INVARIANT « ≤1 ouvert » que les deux seeders sœurs : idempotent, si une
 * boucle est déjà ouverte on ne touche à rien et on relit l'ouvert ; l'index
 * partiel `mental_micro_objectives_one_open_per_member` est le vrai garant
 * (P2002 → no-op). `sourceKind='signal'` (String libre côté DB, aucune migration).
 * Le `mentalAxis` est dérivé par l'appelant (admin action) via
 * `mentalAxisFromDimensionId` — jamais depuis le texte du signal.
 */
export async function ensureMicroObjectiveFromSignal(
  memberId: string,
  mentalAxis: MentalAxis,
  signalRef: string,
): Promise<EnsureMicroObjectiveResult> {
  const existing = await db.mentalMicroObjective.findFirst({
    where: { memberId, status: 'open' },
    select: { id: true },
  });
  if (existing) return { created: false, objectiveId: existing.id };

  try {
    const row = await db.mentalMicroObjective.create({
      data: {
        memberId,
        axis: mentalAxis,
        sourceKind: 'signal',
        sourceRef: signalRef,
        title: MICRO_OBJECTIVE_TITLES[mentalAxis],
        intention: ANNOTATION_INTENTIONS[mentalAxis],
      },
      select: { id: true },
    });
    return { created: true, objectiveId: row.id };
  } catch (err) {
    // Course perdue : un autre semis/passage a créé la boucle entre notre
    // `findFirst` et notre `create` (index partiel → P2002). No-op : on relit
    // l'ouvert gagnant — la boucle existe, on n'en est juste pas l'auteur.
    if (isUniqueConstraintError(err)) {
      const winner = await db.mentalMicroObjective.findFirst({
        where: { memberId, status: 'open' },
        select: { id: true },
      });
      return { created: false, objectiveId: winner?.id ?? null };
    }
    throw err;
  }
}

/**
 * Referme la boucle (suivi au prochain passage). Garde de propriété BOLA :
 * l'absence ET la non-propriété collapsent vers la MÊME erreur (anti-énumération).
 * Idempotent : une boucle déjà refermée n'est pas réécrite (le 1er suivi fait foi).
 */
export async function closeMicroObjective(
  memberId: string,
  objectiveId: string,
  outcome: MicroObjectiveOutcome,
): Promise<void> {
  const row = await db.mentalMicroObjective.findUnique({
    where: { id: objectiveId },
    select: { memberId: true, status: true },
  });
  if (!row || row.memberId !== memberId) throw new MicroObjectiveNotFoundError();
  // Already closed → no-op (member double-tapped the follow-up). Le 1er suivi fait foi.
  if (row.status !== 'open') return;
  // The findUnique above is a plain READ COMMITTED read and takes no row lock,
  // so the JS `status` guard alone cannot stop two concurrent closes from both
  // seeing 'open' and last-write-wins clobbering the first outcome. Move the
  // guard into the WHERE: only the row still 'open' is updated; a loser matches
  // 0 rows (count===0) and is a no-op, preserving « le 1er suivi fait foi »
  // atomically without a transaction (RC#7 TX-2).
  await db.mentalMicroObjective.updateMany({
    where: { id: objectiveId, memberId, status: 'open' },
    data: { status: outcome, closedAt: new Date() },
  });
}

function toView(row: {
  id: string;
  axis: string;
  title: string;
  intention: string;
  status: string;
  sourceKind: string;
  sourceRef: string;
  createdAt: Date;
  closedAt: Date | null;
}): MicroObjectiveView {
  return {
    id: row.id,
    axis: row.axis,
    title: row.title,
    intention: row.intention,
    status: row.status as MicroObjectiveStatusView,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

/**
 * Le micro-objectif OUVERT du membre (E3 « créé »), ou `null`.
 * `React.cache()` (tour 10) : la pill du shell (root layout) et les pages qui
 * l'affichent déjà (/dashboard, /objectifs) partagent le MÊME render tree →
 * une seule requête par requête serveur, pas une par surface.
 */
export const getOpenMicroObjective = cache(
  async (memberId: string): Promise<MicroObjectiveView | null> => {
    const row = await db.mentalMicroObjective.findFirst({
      where: { memberId, status: 'open' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        axis: true,
        title: true,
        intention: true,
        status: true,
        sourceKind: true,
        sourceRef: true,
        createdAt: true,
        closedAt: true,
      },
    });
    return row ? toView(row) : null;
  },
);

/**
 * Historique des micro-objectifs du membre (E2 — trace d'évolution), du plus
 * récent au plus ancien. Borné (liste finie, pas de scroll infini).
 */
export async function listRecentMicroObjectives(
  memberId: string,
  take = 10,
): Promise<readonly MicroObjectiveView[]> {
  const rows = await db.mentalMicroObjective.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      axis: true,
      title: true,
      intention: true,
      status: true,
      sourceKind: true,
      sourceRef: true,
      createdAt: true,
      closedAt: true,
    },
  });
  return rows.map(toView);
}

export interface MicroObjectiveProgress {
  readonly open: number;
  readonly kept: number;
  readonly missed: number;
  readonly dismissed: number;
  /** Boucles refermées avec une issue de tenue (kept + missed ; dismissed exclu). */
  readonly resolved: number;
  /** kept / (kept + missed) × 100, ou `null` si aucune boucle « tenue/manquée ». */
  readonly keptRate: number | null;
}

/**
 * S5 livrable C / D — progression MESURABLE des micro-objectifs (consommée par le
 * moteur d'analyses + S4/S6). Compte par statut sur une fenêtre optionnelle
 * (`createdAt`). Posture §33.2 : des nombres factuels, jamais un compteur de
 * culpabilité — `dismissed` est exclu du taux (un objectif écarté n'est pas un échec).
 */
export async function getMicroObjectiveProgress(
  memberId: string,
  range?: { start: Date; end: Date },
): Promise<MicroObjectiveProgress> {
  const grouped = await db.mentalMicroObjective.groupBy({
    by: ['status'],
    where: {
      memberId,
      ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
    },
    _count: { _all: true },
  });
  const count = (status: MicroObjectiveStatusView): number =>
    grouped.find((g) => g.status === status)?._count._all ?? 0;

  const kept = count('kept');
  const missed = count('missed');
  const resolved = kept + missed;
  return {
    open: count('open'),
    kept,
    missed,
    dismissed: count('dismissed'),
    resolved,
    keptRate: resolved > 0 ? Math.round((kept / resolved) * 1000) / 10 : null,
  };
}

/** Longueur max de l'extrait de correction affiché au membre (troncature douce). */
const ANNOTATION_EXCERPT_MAX = 180;

/**
 * PURE — extrait court et propre du commentaire brut d'une correction admin.
 * Aplati (espaces normalisés, retours à la ligne écrasés) puis tronqué à
 * `ANNOTATION_EXCERPT_MAX` sur une frontière de mot quand c'est possible, avec
 * une ellipse « … ». Retourne `null` pour un commentaire vide (jamais un extrait
 * fantôme). Exporté pour être testé en isolation.
 */
export function buildAnnotationExcerpt(comment: string): string | null {
  const flat = comment.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return null;
  if (flat.length <= ANNOTATION_EXCERPT_MAX) return flat;
  // Coupe sur le dernier espace avant la limite pour ne pas trancher un mot ;
  // si aucun espace (mot très long), coupe dur à la limite.
  const sliced = flat.slice(0, ANNOTATION_EXCERPT_MAX);
  const lastSpace = sliced.lastIndexOf(' ');
  const head = (
    lastSpace > ANNOTATION_EXCERPT_MAX * 0.6 ? sliced.slice(0, lastSpace) : sliced
  ).trimEnd();
  return `${head}…`;
}

/**
 * C3 (tour 10) — referme visuellement la boucle « correction admin → micro-objectif ».
 * Résout le commentaire RÉEL de la correction dont un micro-objectif `annotation`
 * est issu, pour l'afficher au membre SOUS l'intention générique (il voit ce que
 * son coach lui a vraiment dit, pas juste une phrase curée).
 *
 * 🛡️ BOLA : la lecture est scopée par `trade.userId = memberId` (relation
 * `TradeAnnotation → Trade → User`), donc un membre ne peut JAMAIS résoudre
 * l'annotation d'un autre membre, même en forgeant le `sourceRef`. Pas de fuite
 * nouvelle : ces annotations lui sont déjà visibles via
 * `lib/annotations/member-service.ts`. Fallback SILENCIEUX (`null`) si le
 * micro-objectif ne vient pas d'une annotation, ou si l'annotation n'existe plus
 * / n'est pas la sienne → comportement historique inchangé (§C3 « si l'annotation
 * n'existe plus, comportement actuel inchangé »). `sourceRef` reste une trace,
 * jamais une FK (firewall §21.5) : on le résout à la lecture, à la demande.
 */
export async function getAnnotationExcerptForObjective(
  memberId: string,
  objective: Pick<MicroObjectiveView, 'sourceKind' | 'sourceRef'>,
): Promise<string | null> {
  if (objective.sourceKind !== 'annotation') return null;
  const row = await db.tradeAnnotation.findFirst({
    where: { id: objective.sourceRef, trade: { is: { userId: memberId } } },
    select: { comment: true },
  });
  if (!row) return null;
  return buildAnnotationExcerpt(row.comment);
}

/** Une ligne de « Suivi des corrections » (admin) : un micro-objectif issu d'une correction. */
export interface AnnotationObjectiveRow {
  readonly id: string;
  readonly axis: string;
  readonly title: string;
  readonly intention: string;
  readonly status: MicroObjectiveStatusView;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

/**
 * C3 (tour 10) — surface admin « Suivi des corrections » : les micro-objectifs
 * du membre SEMÉS PAR une correction taggée (`sourceKind='annotation'`), du plus
 * récent au plus ancien, pour que l'admin voie si ses corrections sont tenues
 * (open / kept / missed). Read-only, aucune action.
 *
 * Anti-N+1 : UNE seule requête `findMany` avec `select` ciblé (jamais de fetch
 * par ligne). Borné (`take`) — liste finie, pas de scroll infini. Admin-scoped :
 * l'appelant a déjà vérifié le rôle (mirror `lib/admin/*-service.ts`), donc pas
 * de re-check ici ; la seule contrainte est `memberId`.
 */
export async function listAnnotationObjectivesForMember(
  memberId: string,
  take = 20,
): Promise<readonly AnnotationObjectiveRow[]> {
  const rows = await db.mentalMicroObjective.findMany({
    where: { memberId, sourceKind: 'annotation' },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      axis: true,
      title: true,
      intention: true,
      status: true,
      createdAt: true,
      closedAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    axis: row.axis,
    title: row.title,
    intention: row.intention,
    status: row.status as MicroObjectiveStatusView,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  }));
}
