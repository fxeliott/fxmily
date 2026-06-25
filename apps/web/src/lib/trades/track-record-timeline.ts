import 'server-only';

import { db } from '@/lib/db';

/**
 * S4 §33 (enrichissement #1) — « Timeline / heatmap d'activité du track record ».
 *
 * Read-only loader qui réunit, par trade clôturé et dans l'ordre chronologique,
 * la donnée DÉJÀ collectée que trois surfaces séparées portaient jusqu'ici (la
 * fiche détail = photo + plan respecté ; /verification = écart de vérité S3 ;
 * le track record = R réalisé). But : le membre voit ses SÉRIES d'un coup d'œil
 * — régularité, périodes de discipline, ruptures.
 *
 * Posture §2 : aucune interprétation de marché — on rend ce qui est, on ne
 * calcule rien (le R, le plan, l'écart proviennent de leurs sessions
 * propriétaires S2/S3, jamais recalculés ici). §33.2 : l'écart est un signal
 * calme (jamais rouge punitif côté UI).
 */

export interface TrackRecordTimelineItem {
  readonly id: string;
  /** Clôture du trade — l'axe chronologique de la frise. */
  readonly date: Date;
  readonly pair: string;
  readonly direction: 'long' | 'short';
  /** R réalisé (P&L process) ; null si non chiffrable. */
  readonly realizedR: number | null;
  readonly realizedREstimated: boolean;
  /** Discipline déclarée à l'entrée ; null = non renseigné. */
  readonly planRespected: boolean | null;
  /** Une photo d'analyse a été jointe à l'entrée. */
  readonly hasPhoto: boolean;
  /** Un écart de vérité S3 (Discrepancy) référence ce trade. */
  readonly hasDiscrepancy: boolean;
}

const TIMELINE_CAP = 24;

/**
 * Les `limit` derniers trades clôturés du membre, rendus du plus ancien au plus
 * récent (lecture gauche → droite de la série). Annotés d'un drapeau « écart »
 * par une seule lecture supplémentaire de `Discrepancy` (la FK
 * `declaredTradeId` existe déjà — aucun reconcile relancé).
 */
export async function listTrackRecordTimeline(
  userId: string,
  options: { limit?: number } = {},
): Promise<readonly TrackRecordTimelineItem[]> {
  const limit = Math.max(1, Math.min(options.limit ?? TIMELINE_CAP, TIMELINE_CAP));

  const trades = await db.trade.findMany({
    where: { userId, closedAt: { not: null } },
    orderBy: { closedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      pair: true,
      direction: true,
      closedAt: true,
      realizedR: true,
      realizedRSource: true,
      planRespected: true,
      screenshotEntryKey: true,
    },
  });
  if (trades.length === 0) return [];

  const tradeIds = trades.map((t) => t.id);
  const discrepancies = await db.discrepancy.findMany({
    where: { memberId: userId, declaredTradeId: { in: tradeIds } },
    select: { declaredTradeId: true },
  });
  const withDiscrepancy = new Set(
    discrepancies.map((d) => d.declaredTradeId).filter((v): v is string => v !== null),
  );

  return trades
    .map((t) => ({
      id: t.id,
      // `closedAt` is non-null by the `where` filter above.
      date: t.closedAt as Date,
      pair: t.pair,
      direction: t.direction as 'long' | 'short',
      realizedR: t.realizedR === null ? null : Number(t.realizedR),
      realizedREstimated: t.realizedRSource === 'estimated',
      planRespected: t.planRespected,
      hasPhoto: t.screenshotEntryKey !== null,
      hasDiscrepancy: withDiscrepancy.has(t.id),
    }))
    .reverse();
}
