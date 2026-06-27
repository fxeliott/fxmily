import 'server-only';

import { db } from '@/lib/db';
import { isConstancyDip } from '@/lib/admin/attention-logic';

/**
 * S7 §33-#2 — admin "à traiter" triage signals for the global members view.
 *
 * Surfaces, per member, what calls for the admin's attention so nobody is
 * forgotten: recent trades/backtests not yet commented, OPEN truth gaps
 * (S3 discrepancies), and a constancy score that has dipped. The admin sees
 * where to focus at a glance — calm coaching signal, never a punitive verdict
 * (SPEC §2).
 *
 * **Trust boundary** : like `members-service`, every function assumes the caller
 * is an authenticated admin. The page / proxy gate `/admin/*` upstream.
 *
 * Performance: the per-page loader is batched on the current page's member ids
 * (≤ 50) — bounded `findMany`/`groupBy` over indexed columns
 * (`@@index([memberId, status])`, `@@index([userId, enteredAt])`,
 * `@@index([memberId, computedAt])`). The cohort summary uses 3 bounded counts.
 */

const DAY_MS = 86_400_000;

/** Window for "recent" uncommented trades — what just happened and needs eyes. */
export const ATTENTION_RECENT_DAYS = 14;

/** How far back we read constancy snapshots to judge a recent dip. */
const CONSTANCY_DECLINE_LOOKBACK_DAYS = 70;

export interface MemberAttention {
  /** Recent real + training trades with no admin correction yet. */
  tradesToComment: number;
  /** Open truth gaps (S3 discrepancies) awaiting acknowledgement/resolution. */
  openDiscrepancies: number;
  /** Latest constancy snapshot dropped vs the previous one (sustained-dip hint). */
  constancyDeclining: boolean;
}

const EMPTY_ATTENTION: MemberAttention = {
  tradesToComment: 0,
  openDiscrepancies: 0,
  constancyDeclining: false,
};

/**
 * Batched attention flags for a page of members. Returns a Map keyed by member
 * id; ids with nothing pending still get a zeroed entry so the caller can render
 * a calm "à jour" state without a second lookup.
 */
export async function getMembersAttention(ids: string[]): Promise<Map<string, MemberAttention>> {
  const result = new Map<string, MemberAttention>();
  if (ids.length === 0) return result;
  for (const id of ids) result.set(id, { ...EMPTY_ATTENTION });

  const recentFloor = new Date(Date.now() - ATTENTION_RECENT_DAYS * DAY_MS);
  const constancyFloor = new Date(Date.now() - CONSTANCY_DECLINE_LOOKBACK_DAYS * DAY_MS);

  const [uncommentedReal, uncommentedTraining, openByMember, constancyRows] = await Promise.all([
    db.trade.findMany({
      where: { userId: { in: ids }, enteredAt: { gte: recentFloor }, annotations: { none: {} } },
      select: { userId: true },
    }),
    db.trainingTrade.findMany({
      where: { userId: { in: ids }, enteredAt: { gte: recentFloor }, annotations: { none: {} } },
      select: { userId: true },
    }),
    db.discrepancy.groupBy({
      by: ['memberId'],
      where: { memberId: { in: ids }, status: 'open' },
      _count: { _all: true },
    }),
    db.constancyScore.findMany({
      where: { memberId: { in: ids }, periodStart: { gte: constancyFloor } },
      orderBy: [{ memberId: 'asc' }, { periodStart: 'desc' }],
      select: { memberId: true, value: true },
    }),
  ]);

  for (const row of uncommentedReal) {
    const acc = result.get(row.userId);
    if (acc) acc.tradesToComment += 1;
  }
  for (const row of uncommentedTraining) {
    const acc = result.get(row.userId);
    if (acc) acc.tradesToComment += 1;
  }
  for (const row of openByMember) {
    const acc = result.get(row.memberId);
    if (acc) acc.openDiscrepancies = row._count._all;
  }

  // constancyRows are memberId-grouped, periodStart DESC → the first two per
  // member are its latest + previous snapshot. A drop ≥ MIN flags a dip.
  const latestSeen = new Map<string, number>();
  for (const row of constancyRows) {
    const acc = result.get(row.memberId);
    if (!acc) continue;
    const prevLatest = latestSeen.get(row.memberId);
    if (prevLatest === undefined) {
      latestSeen.set(row.memberId, row.value); // this is the LATEST (DESC order)
    } else {
      // this is the PREVIOUS snapshot; compare once, then stop caring.
      // `prevLatest` = latest value, `row.value` = previous value → a dip is
      // "previous − latest ≥ MIN" (single source of truth in attention-logic).
      if (!acc.constancyDeclining) {
        acc.constancyDeclining = isConstancyDip(prevLatest, row.value);
      }
    }
  }

  return result;
}

export interface CohortAttention {
  /** Recent real + training trades across the whole live cohort with no correction. */
  tradesToComment: number;
  /** Open truth gaps across the whole live cohort. */
  openDiscrepancies: number;
}

/**
 * Cohort-wide triage totals for the members landing strip — independent of the
 * current search/page (the strip is an overview). Three bounded counts.
 */
export async function getCohortAttention(): Promise<CohortAttention> {
  const recentFloor = new Date(Date.now() - ATTENTION_RECENT_DAYS * DAY_MS);

  const [realToComment, trainingToComment, openDiscrepancies] = await Promise.all([
    db.trade.count({
      where: {
        enteredAt: { gte: recentFloor },
        annotations: { none: {} },
        user: { status: { not: 'deleted' } },
      },
    }),
    db.trainingTrade.count({
      where: {
        enteredAt: { gte: recentFloor },
        annotations: { none: {} },
        user: { status: { not: 'deleted' } },
      },
    }),
    db.discrepancy.count({
      where: { status: 'open', member: { status: { not: 'deleted' } } },
    }),
  ]);

  return { tradesToComment: realToComment + trainingToComment, openDiscrepancies };
}
