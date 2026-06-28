import 'server-only';

import { getCoachingInsight } from '@/lib/coaching/service';
import { getMethodMirror } from '@/lib/method-mirror/service';
import { listMeetingsForMember } from '@/lib/meeting/service';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';
import { getLatestConstancyScore } from '@/lib/verification/constancy';
import { getVerificationOverview } from '@/lib/verification/service';
import { getMemberWeeklyRecap } from '@/lib/weekly-report/member-recap';

/**
 * S10(b) — « Ton bilan » : seam serveur du RÉCAP MEMBRE 5 AXES.
 *
 * WHY (brief S10(b)). Les surfaces de `/progression` racontent chacune UN angle
 * (scores, méthode, réunions, vérification…) mais rien ne donne au membre la VUE
 * D'ENSEMBLE « où j'en suis sur TOUS mes axes ». Ce seam est un PUR ASSEMBLAGE :
 * il `Promise.all` les loaders read-only DÉJÀ §2-safe puis projette un view-model
 * léger, axe par axe. AUCUNE nouvelle requête lourde, 0 migration, 0 écriture.
 *
 * Les 5 axes (chacun sérialisable OU `null` = NON MESURÉ → l'UI cache l'axe) :
 *   1. discipline   — `getLatestBehavioralScore` (BehavioralScore du jour)
 *   2. progression  — `getBehavioralScoreHistory` (trajectoire) + `getMemberWeeklyRecap`
 *   3. presence     — `listMeetingsForMember().rate` (union discriminée, JAMAIS un faux 0%)
 *   4. selfWork     — `getMethodMirror` + `getCoachingInsight` (travail-sur-soi / méthode)
 *   5. constance    — `getLatestConstancyScore` + `getVerificationOverview`
 *
 * 🛡️ GARDE-FOU §2/§21.5/§31.2 (BLOQUANT). Ce seam RÉ-AGRÈGE uniquement des sorties
 * déjà §2-safe : AUCUN P&L, AUCUN conseil de marché, AUCUNE lecture de
 * `Trade`/`realizedR`/`outcome` ici. Aucun nouveau FK, aucun import croisé neuf —
 * l'isolation est portée par chaque loader amont. `null` par axe N'EST JAMAIS
 * coercé en 0 ; l'union `insufficient_data` de la présence est respectée (pas de
 * faux « 0 % » quand le dénominateur est 0). Read-only + déterministe ⇒ sûr dans
 * n'importe quel RSC.
 */

/** Axe 1 — discipline : le score comportemental du jour (process, jamais un P&L). */
export interface RecapDisciplineAxis {
  /** Score discipline 0–100, ou `null` si non mesuré (pas encore de snapshot). */
  readonly score: number;
}

/** Axe 2 — progression : trajectoire de la discipline + récap hebdo chiffré. */
export interface RecapProgressionAxis {
  /** Delta du score discipline sur la fenêtre (signé), ou `null` si non défendable. */
  readonly disciplineDelta: number | null;
  /** Nombre de relevés de score sur la fenêtre (pour le libellé honnête). */
  readonly points: number;
  /** Trades enregistrés la semaine courante (count-only, jamais un objectif). */
  readonly weeklyTrades: number | null;
  /** Jours distincts de check-in cette semaine (count-only). */
  readonly weeklyCheckinDays: number | null;
}

/**
 * Axe 3 — présence aux réunions. Réutilise l'union discriminée du loader meeting
 * pour NE JAMAIS afficher un faux « 0 % » quand aucune réunion n'est programmée.
 */
export type RecapPresenceAxis =
  | { readonly kind: 'insufficient_data' }
  | {
      readonly kind: 'ok';
      /** 0 ≤ rate ≤ 1 (le formatage en % est un souci d'UI). */
      readonly rate: number;
      readonly scheduledCount: number;
      readonly completedCount: number;
    };

/** Axe 4 — travail-sur-soi / méthode : fidélité aux règles + axe de coaching. */
export interface RecapSelfWorkAxis {
  /**
   * Taux d'adhérence MOYEN aux règles mesurées de la méthode (0–100), ou `null`
   * tant qu'il n'y a pas assez de trades journalisés (`hasEnough` faux). Calme,
   * jamais punitif (§31.2) — un miroir, pas un verdict.
   */
  readonly methodRate: number | null;
  /** Cap Mark Douglas de l'axe mental dominant (process/mental), ou `null`. */
  readonly coachingHeadline: string | null;
}

/** Axe 5 — constance & honnêteté : score de constance + état de la vérification. */
export interface RecapConstancyAxis {
  /** Score de constance 0–100, ou `null` si jamais calculé. */
  readonly score: number | null;
  /** Preuves MT5 déposées (count-only — la « inaltérabilité » matérialisée). */
  readonly proofsCount: number;
  /** Comptes broker déclarés (count-only). */
  readonly accountsCount: number;
}

/**
 * Le view-model léger consommé par {@link MemberRecapCard}. Chaque axe est `null`
 * quand il n'est PAS mesuré → la carte cache l'axe (jamais un faux 0).
 */
export interface Member5AxisRecap {
  readonly discipline: RecapDisciplineAxis | null;
  readonly progression: RecapProgressionAxis | null;
  readonly presence: RecapPresenceAxis | null;
  readonly selfWork: RecapSelfWorkAxis | null;
  readonly constance: RecapConstancyAxis | null;
}

/**
 * Moyenne arrondie des taux de règles RÉELLEMENT mesurés (rate non-null). `null`
 * quand aucune règle n'a de donnée — jamais un 0 fabriqué (§31.2). Ne lit que des
 * faits de process (timings/plannedRR/acts de gestion), aucun P&L.
 */
function averageMethodRate(rules: readonly { rate: number | null }[]): number | null {
  const measured = rules.map((r) => r.rate).filter((r): r is number => r !== null);
  if (measured.length === 0) return null;
  const sum = measured.reduce((acc, r) => acc + r, 0);
  return Math.round(sum / measured.length);
}

/**
 * Assemble le récap 5 axes du membre. PUR assemblage de loaders existants : un
 * `Promise.all`, puis projection. Chaque axe est `null` si non mesuré.
 *
 * @param userId   membre courant (auth-gated par l'appelant).
 * @param timezone fuseau du membre (réservé aux loaders qui en ont besoin ;
 *                 les loaders Paris-keyed l'ignorent par construction).
 */
export async function getMember5AxisRecap(
  userId: string,
  // Réservé pour la parité de signature demandée par le brief : les loaders
  // sous-jacents sont Paris-keyed ou clock-injected, donc aucun n'a besoin du
  // fuseau ici. Préfixe `_` ⇒ `noUnusedParameters` (tsc) + eslint le tolèrent.
  _timezone: string,
): Promise<Member5AxisRecap> {
  const [latestScore, scoreHistory, meetings, mirror, coaching, constancy, verification, weekly] =
    await Promise.all([
      getLatestBehavioralScore(userId),
      getBehavioralScoreHistory(userId, { sinceDays: 90 }),
      listMeetingsForMember(userId),
      getMethodMirror(userId),
      getCoachingInsight(userId),
      getLatestConstancyScore(userId),
      getVerificationOverview(userId),
      getMemberWeeklyRecap(userId),
    ]);

  // ---- Axe 1 — discipline -------------------------------------------------
  // `disciplineScore` est lui-même null quand la dimension est insufficient_data
  // sur le dernier snapshot → l'axe entier est non mesuré (jamais coercé en 0).
  const discipline: RecapDisciplineAxis | null =
    latestScore?.disciplineScore != null ? { score: latestScore.disciplineScore } : null;

  // ---- Axe 2 — progression ------------------------------------------------
  // Delta de la discipline sur les relevés non-null (même règle honnête que le
  // ProgressionHero : `null` si < 2 points). Récap hebdo count-only (null si
  // membre inactif / pas de slice courante).
  const disciplinePoints = scoreHistory
    .map((p) => p.discipline)
    .filter((n): n is number => n !== null);
  // Honnêteté du delta (même règle que le ProgressionHero `hasSpark`) : un seul
  // relevé ne permet PAS de défendre une tendance — `null`, jamais un faux 0.
  const first = disciplinePoints[0];
  const last = disciplinePoints[disciplinePoints.length - 1];
  const disciplineDelta =
    disciplinePoints.length >= 2 && first !== undefined && last !== undefined ? last - first : null;
  const progression: RecapProgressionAxis | null =
    disciplinePoints.length > 0 || weekly !== null
      ? {
          disciplineDelta,
          points: disciplinePoints.length,
          weeklyTrades: weekly?.current.tradesTotal ?? null,
          weeklyCheckinDays: weekly?.current.streakDays ?? null,
        }
      : null;

  // ---- Axe 3 — présence ---------------------------------------------------
  // On RÉUTILISE l'union discriminée du loader : `insufficient_data` ⇒ pas de
  // taux (l'UI montre « en attente », jamais un faux 0 %).
  const presence: RecapPresenceAxis =
    meetings.rate.kind === 'ok'
      ? {
          kind: 'ok',
          rate: meetings.rate.rate,
          scheduledCount: meetings.rate.scheduledCount,
          completedCount: meetings.rate.completedCount,
        }
      : { kind: 'insufficient_data' };

  // ---- Axe 4 — travail-sur-soi / méthode ----------------------------------
  // Fidélité méthode : moyenne des règles mesurées, seulement quand on a assez de
  // trades pour mirror honnêtement. Coaching : cap mental dominant (process only).
  const methodRate = mirror.hasEnough ? averageMethodRate(mirror.rules) : null;
  const coachingHeadline = coaching?.headline ?? null;
  const selfWork: RecapSelfWorkAxis | null =
    methodRate !== null || coachingHeadline !== null ? { methodRate, coachingHeadline } : null;

  // ---- Axe 5 — constance & honnêteté --------------------------------------
  // Score de constance (null tant que jamais calculé) + état count-only de la
  // vérification (preuves + comptes). L'axe existe dès qu'un de ces signaux est là.
  const constanceScore = constancy?.value ?? null;
  const proofsCount = verification.proofs.length;
  const accountsCount = verification.accounts.length;
  const constance: RecapConstancyAxis | null =
    constanceScore !== null || proofsCount > 0 || accountsCount > 0
      ? { score: constanceScore, proofsCount, accountsCount }
      : null;

  return { discipline, progression, presence, selfWork, constance };
}
