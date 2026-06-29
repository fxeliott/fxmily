import 'server-only';

import { db } from '@/lib/db';
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

/** Graine d'un micro-objectif — dérivée d'une entrée de carte mentale (pur). */
export interface MicroObjectiveSeed {
  readonly axis: MentalAxis;
  readonly sourceKind: 'alert' | 'signal';
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

export class MicroObjectiveNotFoundError extends Error {
  override readonly name = 'MicroObjectiveNotFoundError';
  constructor() {
    super('Micro-objective not found or access denied.');
  }
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

/** Le micro-objectif OUVERT du membre (E3 « créé »), ou `null`. */
export async function getOpenMicroObjective(memberId: string): Promise<MicroObjectiveView | null> {
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
}

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
