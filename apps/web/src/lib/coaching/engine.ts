import type { DimensionMomentum } from '@/lib/scoring/momentum';
import type { ConstancyBreakdown, ConstancyScoreView } from '@/lib/verification/constancy';
import type { DominantSignal } from '@/lib/verification/dominant-signals';

import type { MentalAxis, MentalMapEntry, MentalTone } from './mental-map';
import type { MicroObjectiveProgress } from './micro-objective';

/**
 * S5 §32-C — Moteur d'analyses psychologiques ultra-autonomes (PUR & déterministe).
 *
 * WHY (brief §32-C). Le moteur « transforme la data en sens, en continu » : il
 * exploite les signaux RÉELS du membre (carte mentale E1 issue des alertes S3 +
 * signaux dominants + constance ; progression des micro-objectifs E2/E3 ; momentum
 * comportemental) et en synthétise UN insight psychologique **non générique** —
 * cause (observé) → effet (sens Mark Douglas) → prochain pas — assorti d'une
 * **progression mesurable** et d'une **traçabilité** (de quels signaux il découle).
 * Cet insight alimente l'espace membre (S4) ET, via `renderCoachingContextSection`,
 * le contexte des rapports Claude weekly/monthly (S6) — sans jamais s'y substituer.
 *
 * POURQUOI DÉTERMINISTE (et pas un 5e batch Claude). Les batches weekly/monthly SONT
 * déjà le « Claude Opus 4.8 en local ». Le rôle de ce moteur est de les ANCRER dans
 * la psychologie réelle du membre (il leur fournit un contexte structuré et curé),
 * pas d'ajouter un pipeline LLM redondant. Étant déterministe (arithmétique + copie
 * curée réutilisée de la carte mentale), il est §2-safe par construction, tourne à
 * coût nul « en continu », et ne requiert AUCUN `AIGeneratedBanner` (exactement comme
 * `mental-map.ts` / `derived-goals.ts`).
 *
 * 🛡️ GARDE-FOU §2/§33.2 (BLOQUANT). Toute la copie provient de la carte mentale curée
 * (process / discipline / honnêteté / ego / routines) — jamais une analyse de marché,
 * jamais un P&L (firewall §21.5). Module PUR (pas de `server-only`, imports de TYPE
 * seulement) ⇒ testable en isolation et importable par les prompt builders S6.
 */

/** Tendance honnête d'une progression — `null` quand on ne peut pas la défendre. */
export type CoachingTrend = 'up' | 'down' | null;

export interface CoachingProgression {
  /** Ce qui est mesuré (« Micro-objectifs tenus », « Constance »). */
  readonly label: string;
  /** Valeur courante. */
  readonly value: number;
  readonly unit: '%' | '/100';
  /** Tendance dérivée du momentum réel / des signaux dominants, ou `null`. */
  readonly trend: CoachingTrend;
  /** Détail factuel et member-specific (« 3 tenus sur 4 refermés »). */
  readonly detail: string;
}

export interface CoachingInsight {
  readonly axis: MentalAxis;
  readonly tone: MentalTone;
  /** Cap Mark Douglas court (par axe). */
  readonly headline: string;
  /** Cause : ce qui est observé dans la donnée réelle (factuel, process). */
  readonly observation: string;
  /** Effet : ce que ça signifie sur le plan mental (lecture Mark Douglas). */
  readonly meaning: string;
  /** Prochain pas concret (process / mental). */
  readonly nextStep: string;
  /** Progression MESURÉE (livrable C), ou `null` si pas encore de matière. */
  readonly progression: CoachingProgression | null;
  /** Traçabilité (E2/B) : les signaux réels d'où découle l'insight. */
  readonly basis: readonly string[];
}

export interface CoachingInsightInput {
  /** Carte mentale du membre (déjà priorisée + plafonnée). */
  readonly mentalMap: readonly MentalMapEntry[];
  readonly microProgress: MicroObjectiveProgress;
  readonly constancy: ConstancyScoreView | null;
  readonly dominantSignals: readonly DominantSignal[];
  /** Déclins comportementaux soutenus (detectMomentum — déclins uniquement). */
  readonly momentum: readonly DimensionMomentum[];
  /**
   * S5 §32-C — axes que le membre s'est fixés à l'onboarding (profil S2), mappés
   * depuis le texte libre. Sert à tracer l'alignement de l'insight dominant avec une
   * priorité du membre (trace CURÉE, jamais le texte libre ⇒ §50/§2-safe). Absent ⇒
   * pas de trace d'alignement (rétro-compatible).
   */
  readonly priorityAxes?: readonly MentalAxis[];
}

/** Cap Mark Douglas par axe (court, jamais un verdict). */
const HEADLINE_BY_AXIS: Record<MentalAxis, string> = {
  discipline: 'Ton focus mental : la discipline',
  honesty: 'Ton focus mental : l’honnêteté avec toi-même',
  ego: 'Ton focus mental : regarder les faits en face',
  consistency: 'Ton focus mental : la régularité',
};

/** Libellé FR de l'axe (pour le contexte rapport S6). */
const AXIS_FR: Record<MentalAxis, string> = {
  discipline: 'discipline',
  honesty: 'honnêteté avec soi-même',
  ego: 'ego & acceptation des faits',
  consistency: 'régularité',
};

/** Axe psychologique → dimension comportementale (pour lire une tendance réelle). */
const AXIS_DIMENSION: Partial<Record<MentalAxis, DimensionMomentum['dimension']>> = {
  discipline: 'discipline',
  consistency: 'consistency',
  ego: 'emotionalStability',
  // honesty : aucune dimension comportementale ne la mesure → trend reste null.
};

/** Libellé court d'un signal dominant (process only). */
const SIGNAL_LABEL: Record<DominantSignal['reason'], string> = {
  filled: 'présence au suivi',
  forgot_no_reason: 'bilans oubliés',
  reality_gap: 'écarts déclaré/réel',
  false_declaration: 'déclarations sans contrepartie',
};

/** Libellé court d'une alerte de répétition (par triggerType). */
const ALERT_LABEL: Record<string, string> = {
  forgot_no_reason_repeat: 'bilans oubliés',
  reality_gap_repeat: 'écarts déclaré/réel',
  false_declaration_repeat: 'déclarations sans contrepartie',
  meeting_missed_repeat: 'réunions manquées',
  tracking_skipped_repeat: 'suivis sautés',
};

/**
 * Trigger types disposant d'un libellé de traçabilité (clés de `ALERT_LABEL`).
 * Exposé pour le contrat de couverture §32-B : `alert-coverage.test.ts` vérifie que
 * CHAQUE `ALERT_RULES.triggerType` y figure (sinon le `basis` retombe sur le
 * fallback générique « discipline »). Canon S10.
 */
export const COACHING_BASIS_ALERT_TRIGGERS: readonly string[] = Object.keys(ALERT_LABEL);

function trendForAxis(
  momentum: readonly DimensionMomentum[],
  dominantSignals: readonly DominantSignal[],
  axis: MentalAxis,
): CoachingTrend {
  const dim = AXIS_DIMENSION[axis];
  // detectMomentum ne renvoie QUE des déclins soutenus → présence = 'down'.
  if (dim && momentum.some((m) => m.dimension === dim)) return 'down';
  // Honnêteté du badge (même classe que le découplage du taux MAJ-93) : ne JAMAIS
  // afficher « en progrès ↑ » tant qu'UNE dimension comportementale décline, même si
  // ce n'est pas celle de l'axe dominant. Un 'up' tiré du signal « présence » pendant
  // qu'un autre axe recule serait une réassurance trompeuse (§0 / §31.2). Dans le
  // doute (un déclin existe ailleurs) on n'affiche pas de flèche.
  if (momentum.length > 0) return null;
  // Aucun déclin nulle part : un signal « présence » en hausse autorise un 'up' honnête.
  if (dominantSignals.some((s) => s.reason === 'filled' && s.direction === 'up')) return 'up';
  return null;
}

function constancyDetail(breakdown: ConstancyBreakdown): string {
  const parts: string[] = [];
  if (breakdown.honesty !== null) parts.push(`honnêteté ${Math.round(breakdown.honesty)}`);
  if (breakdown.regularity !== null) parts.push(`régularité ${Math.round(breakdown.regularity)}`);
  if (breakdown.discipline !== null) parts.push(`discipline ${Math.round(breakdown.discipline)}`);
  return parts.length > 0 ? parts.join(' · ') : 'en cours de mesure';
}

function pickProgression(
  input: CoachingInsightInput,
  axis: MentalAxis,
): CoachingProgression | null {
  const { resolved, kept, keptRate } = input.microProgress;
  // Progression #1 — les boucles d'engagement refermées (la plus parlante). C'est un
  // TAUX de complétion point-in-time : on n'y accole PAS la tendance de l'axe mental.
  // Sinon « Micro-objectifs tenus · 100% · ↓ à réancrer » se lirait comme une
  // contradiction (le 100 % qui « baisse ») — la flèche d'un autre signal collée à un
  // ratio induit le membre en erreur. On affiche le fait, sans flèche (trend = null).
  if (resolved > 0 && keptRate !== null) {
    return {
      label: 'Micro-objectifs tenus',
      value: keptRate,
      unit: '%',
      trend: null,
      detail: `${kept} tenu${kept > 1 ? 's' : ''} sur ${resolved} refermé${resolved > 1 ? 's' : ''}`,
    };
  }
  // Progression #2 — le score de constance (honnêteté/régularité/discipline). C'est une
  // mesure CONTINUE de l'axe : sa dynamique (déclin soutenu / présence en hausse)
  // annote honnêtement le score, donc on porte ici la tendance de l'axe.
  if (input.constancy) {
    return {
      label: 'Constance',
      value: Math.round(input.constancy.value),
      unit: '/100',
      trend: trendForAxis(input.momentum, input.dominantSignals, axis),
      detail: constancyDetail(input.constancy.breakdown),
    };
  }
  return null;
}

function buildBasis(input: CoachingInsightInput, top: MentalMapEntry): string[] {
  const basis: string[] = [];
  // 1) Origine du thème dominant (traçabilité E2/B jusqu'au motif).
  if (top.source.kind === 'alert') {
    basis.push(`Alerte « ${ALERT_LABEL[top.source.triggerType] ?? 'discipline'} »`);
  } else if (top.source.kind === 'signal') {
    basis.push(`Signal « ${SIGNAL_LABEL[top.source.reason]} »`);
  } else {
    basis.push('Présence régulière au suivi');
  }
  // 2) Instantané de constance (chiffre réel).
  if (input.constancy) basis.push(`Constance ${Math.round(input.constancy.value)}/100`);
  // 3) Boucles refermées (chiffre réel).
  if (input.microProgress.resolved > 0) {
    const n = input.microProgress.resolved;
    basis.push(`${n} boucle${n > 1 ? 's' : ''} refermée${n > 1 ? 's' : ''}`);
  }
  // 4) Déclin comportemental le plus marqué (s'il y en a un).
  const steepest = input.momentum[0];
  if (steepest) basis.push(`${steepest.label} en recul`);
  // 5) §32-C — alignement profil S2 : trace CURÉE (jamais le texte libre de l'axe,
  //    donc §50-safe — aucun contenu AI-dérivé surfacé) quand l'insight dominant
  //    porte sur un axe que le membre s'est fixé à l'onboarding. Insérée juste après
  //    l'origine pour rester visible malgré le plafond à 3.
  if ((input.priorityAxes ?? []).includes(top.axis)) {
    basis.splice(1, 0, 'En lien avec une priorité que tu t’es fixée');
  }
  return basis.slice(0, 3);
}

/**
 * PUR — synthétise l'insight de coaching dominant depuis les signaux réels.
 *
 * Prend la tête de la carte mentale (déjà priorisée : alerte > vigilance > positif)
 * comme cause→effet→prochain pas, y greffe la progression MESURÉE la plus parlante
 * et la traçabilité. Retourne `null` quand il n'y a rien à dire (carte vide) — jamais
 * un insight fabriqué (DoD §33 : insights non génériques, ancrés dans le réel).
 */
export function buildCoachingInsight(input: CoachingInsightInput): CoachingInsight | null {
  const top = input.mentalMap[0];
  if (!top) return null;

  return {
    axis: top.axis,
    tone: top.tone,
    headline: HEADLINE_BY_AXIS[top.axis],
    observation: top.observation,
    meaning: top.meaning,
    nextStep: top.action,
    progression: pickProgression(input, top.axis),
    basis: buildBasis(input, top),
  };
}

/** Le micro-objectif mental OUVERT, réduit pour le contexte rapport. */
export interface CoachingReportObjective {
  readonly axis: string;
  readonly title: string;
}

/**
 * S5 §32-D — contexte STRUCTURÉ que les rapports S6 (weekly/monthly) consomment.
 * L'insight psychologique + l'état de la boucle d'engagement (objectif ouvert +
 * issues refermées sur la période). Curé/factuel ⇒ aucun risque d'injection (jamais
 * de texte libre membre), §2-safe.
 */
export interface CoachingReportContext {
  readonly insight: CoachingInsight;
  readonly openObjective: CoachingReportObjective | null;
  readonly closedOutcomes: {
    readonly kept: number;
    readonly missed: number;
    readonly dismissed: number;
  };
}

export interface CoachingReportContextInput {
  readonly insight: CoachingInsight | null;
  readonly openObjective: CoachingReportObjective | null;
  readonly microProgress: MicroObjectiveProgress;
}

/** PUR — compose le contexte rapport ; `null` si aucun insight (rien à transmettre). */
export function buildCoachingReportContext(
  input: CoachingReportContextInput,
): CoachingReportContext | null {
  if (!input.insight) return null;
  return {
    insight: input.insight,
    openObjective: input.openObjective,
    closedOutcomes: {
      kept: input.microProgress.kept,
      missed: input.microProgress.missed,
      dismissed: input.microProgress.dismissed,
    },
  };
}

/**
 * PUR — rend le contexte coaching en bloc Markdown injectable dans les prompts S6.
 * Partagé par weekly et monthly. Tout est curé/factuel ; le rappel de posture verrouille
 * l'usage côté Claude (intégrer calmement, jamais un conseil de marché, jamais un reproche).
 */
export function renderCoachingContextSection(ctx: CoachingReportContext): string {
  const { insight, openObjective, closedOutcomes } = ctx;
  const lines: string[] = [
    '## Signal de coaching psychologique (S5 — process / mental UNIQUEMENT)',
    '',
    `- Axe dominant : ${AXIS_FR[insight.axis]}`,
    `- Observé : ${insight.observation}`,
    `- Sens (lecture Mark Douglas) : ${insight.meaning}`,
    `- Prochain pas proposé : ${insight.nextStep}`,
  ];
  if (insight.progression) {
    const p = insight.progression;
    lines.push(`- Progression mesurée : ${p.label} — ${p.value}${p.unit} (${p.detail})`);
  }
  if (openObjective) lines.push(`- Micro-objectif mental en cours : ${openObjective.title}`);
  lines.push(
    `- Boucles refermées (période) : ${closedOutcomes.kept} tenue(s), ${closedOutcomes.missed} manquée(s), ${closedOutcomes.dismissed} écartée(s)`,
    '',
    'Rappel posture : intègre ce signal CALMEMENT dans ton accompagnement psychologique. Jamais un conseil de marché, jamais un reproche — une donnée de régularité.',
  );
  return lines.join('\n');
}
