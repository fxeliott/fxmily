import type { AlertView } from '@/lib/verification/alerts';
import type { ConstancyBreakdown, ScoreEventView } from '@/lib/verification/constancy';
import type { DominantSignal } from '@/lib/verification/dominant-signals';

/**
 * S5 §32-E1 — « Carte mentale » lisible & impactante côté membre.
 *
 * WHY (brief S5). L'accompagnement psychologique doit être IMMÉDIATEMENT visible :
 * pour chaque alerte transformée (S3 → §32-B) et chaque signal dominant, le membre
 * voit en clair le triptyque **ce qui est observé → ce que ça signifie sur le plan
 * mental → l'action concrète proposée**. Il sait où il en est sur sa discipline et
 * son mental SANS effort de compréhension (CONTEXTE GLOBAL « Engagement & lisibilité »).
 *
 * Pur (pas de `server-only`, pas de DB) ⇒ testable en isolation. Les imports de
 * `AlertView` / `ScoreEventView` / `DominantSignal` sont des imports de TYPE
 * (erasés à la compilation), donc le garde `server-only` de `verification/*` n'est
 * jamais tiré dans un test node — même pattern que `dominant-signals.ts`.
 * Déterministe (arithmétique + copie curée, jamais une analyse IA) ⇒ AUCUN
 * `AIGeneratedBanner` requis, exactement comme `derived-goals.ts` / `method-mirror`.
 *
 * 🛡️ GARDE-FOU §2/§33.2 (BLOQUANT, non négociable). La carte mentale ne lit QUE des
 * signaux de PROCESS / discipline (présence, honnêteté déclaré-vs-réel, régularité du
 * suivi) — jamais un résultat de marché, jamais un P&L, jamais une analyse Lhedge
 * (inconnue de l'app). Chaque `meaning`/`action` reste strictement dans le registre
 * psychologique à la manière de Mark Douglas : acceptation de l'incertitude, ego &
 * honnêteté avec soi, discipline, routines. Un conseil sur l'EXÉCUTION (se montrer,
 * tenir une routine, faire face à un écart) est autorisé ; un conseil sur le CONTENU
 * d'une analyse (setup/direction/entrée/sortie) serait une violation de périmètre.
 * Aucune branche de ce module ne peut produire un tel conseil par construction : la
 * copie est curée et figée ci-dessous.
 */

/** Axe psychologique d'une entrée (jamais un instrument de marché). */
export type MentalAxis = 'discipline' | 'honesty' | 'ego' | 'consistency';

/** Tonalité de l'entrée — pilote le rendu calme (jamais de rouge punitif, §33.2). */
export type MentalTone = 'alert' | 'watch' | 'positive';

/** Traçabilité E2 : d'où vient l'entrée (jusqu'au motif d'origine, brief §32-B/E2). */
export type MentalMapSource =
  | { readonly kind: 'alert'; readonly alertId: string; readonly triggerType: string }
  | { readonly kind: 'signal'; readonly reason: ScoreEventView['reason'] }
  | { readonly kind: 'positive'; readonly reason: ScoreEventView['reason'] };

export interface MentalMapEntry {
  /** Id stable (clé React + dédup + référence de trace E2). */
  readonly id: string;
  /** Ce qui est OBSERVÉ dans la donnée réelle du membre (factuel, process only). */
  readonly observation: string;
  /** Ce que ça signifie sur le plan MENTAL (lecture Mark Douglas — jamais le marché). */
  readonly meaning: string;
  /** L'action concrète proposée (un seul pas, doux, ancré discipline/mental). */
  readonly action: string;
  readonly axis: MentalAxis;
  readonly tone: MentalTone;
  readonly source: MentalMapSource;
}

export interface MentalMapInput {
  /** Alertes de RÉPÉTITION S3 (déjà escaladées) — la matière prioritaire. */
  readonly alerts: readonly AlertView[];
  /** Les 2-3 signaux qui ont le plus bougé le score (sous le seuil d'alerte). */
  readonly dominantSignals: readonly DominantSignal[];
  /** Breakdown de constance courant (honnêteté/régularité/discipline), ou `null`. */
  readonly constancy: ConstancyBreakdown | null;
  /**
   * S5 §32-C — axes psychologiques que le membre s'est fixés à l'onboarding (profil
   * S2), déjà mappés depuis le texte libre par `classifyPriorityAxes`. Sert de
   * tie-break de priorisation (jamais surfacé en texte ⇒ §50/§2-safe). Absent ⇒
   * aucune influence (rétro-compatible : la carte reste triée par gravité curée).
   */
  readonly priorityAxes?: readonly MentalAxis[];
}

/** Au plus 4 entrées : impactant, jamais une liste qui noie le message (§33.2). */
export const MAX_MENTAL_MAP_ENTRIES = 4;

/**
 * S5 §32-C — boost de priorisation quand une entrée porte sur un axe que le membre
 * s'est fixé (profil S2). BORNÉ < 1 par INVARIANT (testé) : (a) il ne franchit
 * JAMAIS une frontière de tonalité (alerte ≥ 103, vigilance ≥ 11, positif = 0 :
 * écart ≥ 88) — une vigilance ne peut donc jamais passer devant une alerte ; (b) il
 * ne renverse JAMAIS la gravité curée entre deux poids de base distincts (écart
 * minimal = 1). Il ne fait que DÉPARTAGER des entrées de MÊME poids de base, en
 * surfaçant en premier l'axe que le membre a lui-même choisi de travailler.
 */
const PRIORITY_BOOST = 0.5;

type SignalReason = ScoreEventView['reason'];

/** Copie curée d'une alerte de répétition (la seule source de conseil S5). */
interface AlertCopy {
  readonly observation: (repeatCount: number) => string;
  readonly meaning: string;
  readonly action: string;
  readonly axis: MentalAxis;
  /** Poids de tri (gravité psychologique) — l'honnêteté/ego prime sur la discipline. */
  readonly weight: number;
}

const ALERT_COPY: Record<string, AlertCopy> = {
  false_declaration_repeat: {
    observation: (n) =>
      `Des trades déclarés sans contrepartie réelle, à plusieurs reprises (×${n}).`,
    meaning:
      'Se mentir à soi-même coûte toujours plus cher que n’importe quelle perte. Le socle du trader constant n’est pas la performance affichée, c’est l’honnêteté radicale avec soi-même.',
    action:
      'À ta prochaine déclaration, note seulement ce qui s’est réellement passé. La vérité brute est ton meilleur allié, pas ton ennemie.',
    axis: 'honesty',
    weight: 5,
  },
  reality_gap_repeat: {
    observation: (n) =>
      `Plusieurs écarts répétés entre ce que tu déclares et ton historique réel (×${n}).`,
    meaning:
      'L’écart entre le déclaré et le réel n’est pas un détail technique : c’est l’ego qui réécrit l’histoire. On ne progresse que sur les faits qu’on accepte de regarder en face.',
    action:
      'Reprends un écart signalé et nomme-le honnêtement, sans te juger. Voir le fait, c’est déjà commencer à le désamorcer.',
    axis: 'ego',
    weight: 4,
  },
  forgot_no_reason_repeat: {
    observation: (n) => `Plusieurs journées sans suivi, sans motif (×${n}).`,
    meaning:
      'Ne pas regarder son propre travail, c’est souvent éviter une vérité inconfortable. La discipline ne dépend pas du résultat du jour — elle se prouve surtout les jours où l’on n’en a pas envie.',
    action:
      'Ce soir, remplis ton bilan — même en une seule ligne. Te montrer, même un mauvais jour, c’est déjà gagner.',
    axis: 'discipline',
    weight: 3,
  },
  meeting_missed_repeat: {
    observation: (n) => `Plusieurs réunions manquées sans motif (×${n}).`,
    meaning:
      'La présence n’est pas une contrainte, c’est un rendez-vous avec ta propre progression. La régularité se construit précisément dans les moments où l’on serait tenté de lâcher.',
    action:
      'Bloque la prochaine réunion dans ton agenda, ou rattrape-la en replay et coche-la. Un rendez-vous tenu en appelle d’autres.',
    axis: 'discipline',
    weight: 3,
  },
  tracking_skipped_repeat: {
    observation: (n) => `Plusieurs outils de suivi laissés de côté sans motif (×${n}).`,
    meaning:
      'Le suivi n’a de valeur que s’il est régulier : c’est la répétition qui révèle tes vrais schémas. Sauter, c’est se priver de se connaître.',
    action:
      'Choisis UN suivi en retard et remplis-le maintenant. Tu réenclencheras toute la routine d’un seul geste.',
    axis: 'consistency',
    weight: 3,
  },
};

/** Copie curée d'un signal dominant SOUS le seuil (micro-vigilance, jamais une alerte). */
interface SignalCopy {
  readonly observation: (count: number) => string;
  readonly meaning: string;
  readonly action: string;
  readonly axis: MentalAxis;
  readonly weight: number;
}

const WATCH_COPY: Partial<Record<SignalReason, SignalCopy>> = {
  false_declaration: {
    observation: () => 'Une déclaration sans contrepartie réelle, repérée récemment.',
    meaning:
      'Rien de grave isolément — mais c’est l’instant idéal pour réancrer l’honnêteté avec toi-même, tant que c’est facile.',
    action: 'Vérifie ta dernière déclaration face à ton historique, calmement.',
    axis: 'honesty',
    weight: 2,
  },
  reality_gap: {
    observation: () => 'Un écart ponctuel entre ton déclaré et le réel.',
    meaning:
      'Pas de drame : juste l’occasion de réaligner ce que tu dis avec ce que tu fais, pendant que l’écart est encore petit.',
    action: 'Compare ta dernière déclaration à ton historique réel.',
    axis: 'ego',
    weight: 2,
  },
  forgot_no_reason: {
    observation: () => 'Quelques check-ins oubliés ces derniers jours.',
    meaning:
      'Un oubli isolé n’est rien — c’est le moment parfait pour reposer la routine avant qu’elle ne s’effrite.',
    action:
      'Refais ton prochain check-in à l’heure. Une routine se répare par le geste suivant, jamais par la culpabilité.',
    axis: 'discipline',
    weight: 1,
  },
};

const POSITIVE_COPY: SignalCopy = {
  observation: () => 'Tu te montres régulièrement dans ton suivi.',
  meaning:
    'C’est exactement ainsi que la constance se construit : un geste tenu, répété, indépendamment du résultat. Garde ce cap.',
  action: 'Continue sur ta lancée — la régularité est ton edge silencieux.',
  axis: 'consistency',
  weight: 0,
};

/**
 * Trigger types couverts par une copie d'accompagnement (clés de `ALERT_COPY`).
 * Exposé pour le contrat de couverture §32-B : `alert-coverage.test.ts` vérifie que
 * CHAQUE `ALERT_RULES.triggerType` y figure (0 alerte orpheline). Canon S10.
 */
export const MENTAL_MAP_ALERT_TRIGGERS: readonly string[] = Object.keys(ALERT_COPY);

/** Le signal-of-process qu'une alerte couvre déjà (évite le doublon alerte ↔ watch). */
const ALERT_COVERS_REASON: Record<string, SignalReason> = {
  false_declaration_repeat: 'false_declaration',
  reality_gap_repeat: 'reality_gap',
  forgot_no_reason_repeat: 'forgot_no_reason',
};

/**
 * Construit la carte mentale du membre depuis ses signaux RÉELS de process.
 *
 * Priorité : alertes de répétition (déjà escaladées) → signaux dominants en
 * vigilance (sous le seuil, non déjà couverts par une alerte) → un unique renfort
 * positif si le membre se montre régulièrement et qu’aucun signal négatif fort ne
 * domine. Plafonné à {@link MAX_MENTAL_MAP_ENTRIES} (impactant, jamais noyé).
 *
 * Retourne `[]` quand il n’y a rien à dire (jamais une entrée fabriquée — un membre
 * sans signal ne reçoit pas un faux conseil ; la surface affiche alors un état vide
 * apaisé). Aucune entrée ne peut référencer le marché : la copie est figée ci-dessus.
 */
export function buildMentalMap(input: MentalMapInput): MentalMapEntry[] {
  const entries: Array<MentalMapEntry & { weight: number }> = [];
  // §32-C — tie-break par axe prioritaire du membre (profil S2), borné (cf. PRIORITY_BOOST).
  const priority = input.priorityAxes ?? [];
  const boost = (axis: MentalAxis): number => (priority.includes(axis) ? PRIORITY_BOOST : 0);

  // 1) Alertes de répétition S3 — la matière prioritaire (déjà escaladée, §32-B).
  const alertedReasons = new Set<SignalReason>();
  for (const alert of input.alerts) {
    // Seules les alertes vivantes nourrissent la carte (une alerte écartée par le
    // membre n’est plus un message actif). `dismissed` → ignorée.
    if (alert.status === 'dismissed') continue;
    const copy = ALERT_COPY[alert.triggerType];
    if (!copy) continue;
    const covered = ALERT_COVERS_REASON[alert.triggerType];
    if (covered) alertedReasons.add(covered);
    entries.push({
      id: `alert:${alert.id}`,
      observation: copy.observation(alert.repeatCount),
      meaning: copy.meaning,
      action: copy.action,
      axis: copy.axis,
      tone: 'alert',
      source: { kind: 'alert', alertId: alert.id, triggerType: alert.triggerType },
      weight: 100 + copy.weight + boost(copy.axis),
    });
  }

  // 2) Signaux dominants SOUS le seuil — micro-vigilance, jamais une alerte. On
  //    saute ceux déjà couverts par une alerte (anti-doublon) et le « filled »
  //    (traité en renfort positif ci-dessous).
  for (const signal of input.dominantSignals) {
    if (signal.direction !== 'down') continue;
    if (alertedReasons.has(signal.reason)) continue;
    const copy = WATCH_COPY[signal.reason];
    if (!copy) continue;
    entries.push({
      id: `signal:${signal.reason}`,
      observation: copy.observation(signal.count),
      meaning: copy.meaning,
      action: copy.action,
      axis: copy.axis,
      tone: 'watch',
      source: { kind: 'signal', reason: signal.reason },
      weight: 10 + copy.weight + boost(copy.axis),
    });
  }

  // 3) Un unique renfort positif : le membre se montre (filled domine) ET aucun
  //    signal négatif n’a percé (ni alerte, ni vigilance). On célèbre la constance
  //    sans la noyer — la comparaison reste « lui vs son passé », jamais vs autrui.
  const filledDominant = input.dominantSignals.some(
    (s) => s.reason === 'filled' && s.direction === 'up' && s.count > 0,
  );
  if (filledDominant && entries.length === 0) {
    entries.push({
      id: 'positive:filled',
      observation: POSITIVE_COPY.observation(0),
      meaning: POSITIVE_COPY.meaning,
      action: POSITIVE_COPY.action,
      axis: POSITIVE_COPY.axis,
      tone: 'positive',
      source: { kind: 'positive', reason: 'filled' },
      weight: POSITIVE_COPY.weight + boost(POSITIVE_COPY.axis),
    });
  }

  return entries
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_MENTAL_MAP_ENTRIES)
    .map(({ weight: _weight, ...entry }) => entry);
}
