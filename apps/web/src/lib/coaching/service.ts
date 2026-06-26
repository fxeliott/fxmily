import 'server-only';

import { coerceAxes } from '@/lib/objectives/coaching-axis';
import { getProfileForUser } from '@/lib/onboarding-interview/service';
import { detectMomentum } from '@/lib/scoring/momentum';
import { getBehavioralScoreHistory } from '@/lib/scoring/service';
import { listRecentAlertsForMember } from '@/lib/verification/alerts';
import { getLatestConstancyScore, listRecentScoreEvents } from '@/lib/verification/constancy';
import { pickDominantSignals } from '@/lib/verification/dominant-signals';

import {
  buildCoachingInsight,
  buildCoachingReportContext,
  type CoachingInsight,
  type CoachingInsightInput,
  type CoachingReportContext,
} from './engine';
import { buildMentalMap, type MentalMapEntry } from './mental-map';
import { getMicroObjectiveProgress, getOpenMicroObjective } from './micro-objective';
import { classifyPriorityAxes } from './priority-axis';

/**
 * S5 §32-E1 — seam serveur de la « carte mentale » du membre.
 *
 * Agrège les signaux RÉELS de process déjà calculés par S3/S4 (alertes de
 * répétition, événements de score, breakdown de constance) puis délègue au
 * module PUR {@link buildMentalMap} la mise en mots Mark Douglas. Aucune
 * écriture, aucune table neuve : 100 % dérivé-au-rendu (même posture que
 * `objectives/derived-goals` et `verification/dominant-signals`).
 *
 * Read-only ⇒ sûr dans n'importe quel RSC. Déterministe ⇒ pas d'`AIGeneratedBanner`
 * (§50 AI Act ne s'applique qu'au contenu DÉRIVÉ d'un LLM — ici c'est de
 * l'arithmétique sur les faits du membre, pas une analyse IA).
 *
 * 🛡️ GARDE-FOU §2/§33.2 : ne lit QUE des signaux de discipline/honnêteté/
 * régularité. Jamais de marché, de P&L, ni d'analyse Lhedge — l'invariant est
 * porté par le module pur (copie figée) ET par les sources (`Alert.category` est
 * l'enum mono-valeur `psychological`, `ScoreEvent.reason` est un enum de process).
 */
export async function getMentalMap(userId: string): Promise<MentalMapEntry[]> {
  const [alerts, scoreEvents, constancy, profile] = await Promise.all([
    listRecentAlertsForMember(userId),
    listRecentScoreEvents(userId),
    getLatestConstancyScore(userId),
    getProfileForUser(userId),
  ]);

  return buildMentalMap({
    alerts,
    dominantSignals: pickDominantSignals(scoreEvents),
    constancy: constancy?.breakdown ?? null,
    // §32-C — priorités d'onboarding (profil S2) → tie-break de priorisation.
    priorityAxes: classifyPriorityAxes(coerceAxes(profile?.axesPrioritaires)),
  });
}

/**
 * S5 §32-C/D — seam serveur du moteur d'analyses autonomes : rassemble en UNE
 * passe (Promise.all) tous les signaux RÉELS du membre que le moteur PUR exploite
 * — carte mentale (alertes S3 + signaux dominants + constance), progression des
 * micro-objectifs, et momentum comportemental (déclins soutenus). `range` borne
 * la progression à la période d'un rapport (S6) ; absent ⇒ vue cumulée (S4).
 *
 * Read-only, déterministe ⇒ sûr dans n'importe quel RSC et appelable « en continu ».
 * 🛡️ §2/§21.5 : ne lit QUE des signaux de process (jamais Trade, P&L, ni marché) —
 * l'invariant est porté par chaque source amont et par le module pur {@link buildCoachingInsight}.
 */
async function gatherCoachingInput(
  userId: string,
  range?: { start: Date; end: Date },
): Promise<CoachingInsightInput> {
  const [alerts, scoreEvents, constancy, microProgress, scoreHistory, profile] = await Promise.all([
    listRecentAlertsForMember(userId),
    listRecentScoreEvents(userId),
    getLatestConstancyScore(userId),
    getMicroObjectiveProgress(userId, range),
    getBehavioralScoreHistory(userId, { sinceDays: 90 }),
    getProfileForUser(userId),
  ]);
  const dominantSignals = pickDominantSignals(scoreEvents);
  // §32-C — exploite le profil S2 RÉELLEMENT : ses axes prioritaires (texte libre
  // d'onboarding) mappés vers l'enum mental, jamais surfacés bruts (§50/§2-safe).
  const priorityAxes = classifyPriorityAxes(coerceAxes(profile?.axesPrioritaires));
  return {
    mentalMap: buildMentalMap({
      alerts,
      dominantSignals,
      constancy: constancy?.breakdown ?? null,
      priorityAxes,
    }),
    microProgress,
    constancy,
    dominantSignals,
    momentum: detectMomentum(scoreHistory),
    priorityAxes,
  };
}

/**
 * S5 §32-C — l'insight de coaching psychologique courant du membre (vue cumulée),
 * consommé par l'espace membre (S4). `null` quand il n'y a rien à dire (carte
 * mentale vide) ⇒ la surface se cache, jamais un insight fabriqué.
 */
export async function getCoachingInsight(userId: string): Promise<CoachingInsight | null> {
  return buildCoachingInsight(await gatherCoachingInput(userId));
}

/**
 * S5 §32-D — le contexte coaching STRUCTURÉ que les rapports Claude S6
 * (weekly/monthly) injectent dans leur prompt. `range` borne les boucles
 * refermées + la progression à la période du rapport. `null` si aucun insight
 * (rien à transmettre ⇒ le prompt n'ajoute simplement pas la section).
 */
export async function getCoachingReportContext(
  userId: string,
  range?: { start: Date; end: Date },
): Promise<CoachingReportContext | null> {
  const [input, openObjective] = await Promise.all([
    gatherCoachingInput(userId, range),
    getOpenMicroObjective(userId),
  ]);
  return buildCoachingReportContext({
    insight: buildCoachingInsight(input),
    openObjective: openObjective ? { axis: openObjective.axis, title: openObjective.title } : null,
    microProgress: input.microProgress,
  });
}
