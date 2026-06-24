import type { MethodMirror, MethodRuleKey } from '@/lib/method-mirror/compute';

/**
 * S25 #2 — l'OBJECTIF du membre DÉRIVÉ de sa donnée réelle et ÉVOLUTIF.
 *
 * WHY (gap audit S25). Jusqu'ici le seul objectif « propre au membre » venait
 * d'un TEXTE d'onboarding figé (`coachingAxis`) — pas de son trading. Le
 * `MethodMirror` (S24) calcule déjà sa fidélité à chaque règle dure sur 30j mais
 * ne la montre qu'en miroir PASSIF. Ce module la transforme en cible chiffrée et
 * mobile : on prend la règle où il est le plus FAIBLE (= sa « chose à bosser »,
 * dérivée de LUI), et on fixe un palier doux juste au-dessus. Le membre voit
 * « MON objectif, issu de MA donnée, et j'avance dessus » ; quand il progresse, le
 * palier monte ; s'il régresse, il redescend calmement — un objectif vivant.
 *
 * Pur (pas de `server-only`, pas de DB) ⇒ testable en isolation. Le `MethodMirror`
 * arrive déjà calculé du seam serveur. Déterministe ⇒ AUCUN `AIGeneratedBanner`
 * requis (ce n'est pas une analyse IA, c'est de l'arithmétique sur sa donnée).
 *
 * POSTURE §2 : chaque règle est un objet de PROCESS/discipline (fenêtre horaire,
 * 1 trade/jour, coupure 20h, visée RR) — jamais un signal de marché. §31.2 : le
 * palier est un encouragement doux, jamais un reproche ni un compte à rebours.
 */

/** Pas du palier (on monte/descend par tranches de 10). */
const LADDER_STEP = 10;
/** Plafond de cible : on ne vise jamais 100 % (la perfection rigide n'est pas le but). */
const TARGET_CAP = 95;
/** Au-dessus de ce taux, la règle est « tenue » → pas d'objectif fabriqué dessus. */
const MASTERED_RATE = 90;
/** Échantillon minimal d'une règle pour en faire une cible (anti-bruit : éviter
 *  un « 0 % sur 1 trade »). Le `hasEnough` global garde déjà le total ≥ 5. */
const MIN_RULE_SAMPLE = 3;

export interface DerivedMethodGoal {
  /** La règle ciblée (la plus faible, avec assez d'échantillon). */
  rule: MethodRuleKey;
  /** Libellé court de la règle ("Fenêtre 13h–16h"). */
  label: string;
  /** Ligne descriptive (process, jamais un signal). */
  hint: string;
  /** Taux d'adhérence actuel 0–100 (le `rate` de la règle). */
  current: number;
  /** Prochain palier doux au-dessus de `current` (≤ 95). */
  target: number;
  /** Numérateur (jours/trades conformes) — pour une copie honnête. */
  good: number;
  /** Dénominateur (échantillon). */
  total: number;
  /** Fenêtre glissante couverte (jours), pour la légende. */
  windowDays: number;
}

/**
 * Dérive l'objectif évolutif du membre depuis son miroir de fidélité. `null`
 * quand : pas assez de trades (`!hasEnough`), aucune règle assez échantillonnée,
 * ou le membre est déjà fidèle partout (≥ 90 %) — dans ce cas on ne fabrique pas
 * un faux objectif, on le laisse savourer sa constance (les anneaux + le streak
 * portent la suite).
 */
export function deriveMethodGoal(mirror: MethodMirror): DerivedMethodGoal | null {
  if (!mirror.hasEnough) return null;

  // Candidats = règles avec un taux RÉEL et un échantillon suffisant.
  const candidates = mirror.rules.filter(
    (r): r is typeof r & { rate: number } => r.rate !== null && r.total >= MIN_RULE_SAMPLE,
  );
  if (candidates.length === 0) return null;

  // La règle la plus faible = sa « chose à bosser », dérivée de SA donnée. Ordre
  // stable des règles ⇒ départage déterministe en cas d'égalité (pas de random).
  const weakest = candidates.reduce((lo, r) => (r.rate < lo.rate ? r : lo));

  // Déjà fidèle partout → pas d'objectif fabriqué.
  if (weakest.rate >= MASTERED_RATE) return null;

  const current = weakest.rate;
  const target = Math.min(TARGET_CAP, (Math.floor(current / LADDER_STEP) + 1) * LADDER_STEP);

  return {
    rule: weakest.key,
    label: weakest.label,
    hint: weakest.hint,
    current,
    target,
    good: weakest.good,
    total: weakest.total,
    windowDays: mirror.windowDays,
  };
}
