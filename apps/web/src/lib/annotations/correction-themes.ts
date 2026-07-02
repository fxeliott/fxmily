import 'server-only';

import type { TrackingAxis } from '@/generated/prisma/enums';
import { db } from '@/lib/db';

/**
 * J-AI corrections echo — themes the coaching corrections an admin authored on a
 * member's trades + backtests, so the app can echo the recurring points back to
 * the member (daily guidance) and feed them to the monthly IA pipelines.
 *
 * A "correction" is a `TradeAnnotation` (real trade) or a `TrainingAnnotation`
 * (backtest §21). Only corrections the admin TAGGED with a `TrackingAxis` count
 * toward a theme — untagged (null axis) corrections are ignored (they carry no
 * machine-readable coaching signal). Grouping by axis surfaces WHAT the coach
 * keeps coming back to over the window.
 *
 * PURE core (`aggregateCorrectionThemes`) + a thin DB reader (`getCorrectionThemes`)
 * so the aggregation is unit-testable without a database. POSTURE §2: every axis
 * is a process/behavioural dimension, never a market call — the same taxonomy as
 * the §28 tracking surface (`lib/tracking/axes.ts`).
 */

/** A single tagged correction, normalised across the trade + training sources. */
export interface CorrectionRecord {
  readonly axis: TrackingAxis;
  readonly comment: string;
  readonly createdAt: Date;
  /** Which surface the correction lives on — drives the member echo deep-link. */
  readonly source: 'trade' | 'training';
}

/** One coaching theme = every tagged correction sharing an axis over the window. */
export interface CorrectionTheme {
  readonly axis: TrackingAxis;
  /** How many corrections carried this axis over the window. */
  readonly count: number;
  /** The most recent correction's comment for this axis (context for the echo). */
  readonly lastComment: string;
  /** When the most recent correction for this axis was authored. */
  readonly lastAt: Date;
  /** Source of the most recent correction — picks the echo deep-link target. */
  readonly lastSource: 'trade' | 'training';
}

/**
 * PURE — group tagged corrections by axis, newest-first within each theme, and
 * return the themes sorted by count desc (ties broken by most-recent activity so
 * the freshest recurring point leads). Records with no axis are the caller's
 * concern; this function assumes every input already carries an axis.
 */
export function aggregateCorrectionThemes(records: readonly CorrectionRecord[]): CorrectionTheme[] {
  const byAxis = new Map<TrackingAxis, CorrectionRecord[]>();
  for (const rec of records) {
    const bucket = byAxis.get(rec.axis);
    if (bucket) bucket.push(rec);
    else byAxis.set(rec.axis, [rec]);
  }

  const themes: CorrectionTheme[] = [];
  for (const [axis, recs] of byAxis) {
    // Newest-first so `[0]` is the latest correction for this axis.
    const sorted = [...recs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = sorted[0]!;
    themes.push({
      axis,
      count: sorted.length,
      lastComment: latest.comment,
      lastAt: latest.createdAt,
      lastSource: latest.source,
    });
  }

  // Most-recurring first; tie-break on the freshest activity.
  themes.sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime());
  return themes;
}

/**
 * Read the member's tagged corrections over the last `windowDays` (default 30)
 * from BOTH the trade + training surfaces, then theme them. Corrections with a
 * null axis are filtered at the query (`axis: { not: null }`) so they never
 * reach the aggregate. Scoped to the member through the parent relation on each
 * side (never another member's data).
 */
export async function getCorrectionThemes(
  memberId: string,
  windowDays = 30,
  now: Date = new Date(),
): Promise<CorrectionTheme[]> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [tradeRows, trainingRows] = await Promise.all([
    db.tradeAnnotation.findMany({
      where: {
        createdAt: { gte: since, lte: now },
        axis: { not: null },
        trade: { is: { userId: memberId } },
      },
      select: { axis: true, comment: true, createdAt: true },
    }),
    db.trainingAnnotation.findMany({
      where: {
        createdAt: { gte: since, lte: now },
        axis: { not: null },
        trainingTrade: { is: { userId: memberId } },
      },
      select: { axis: true, comment: true, createdAt: true },
    }),
  ]);

  const records: CorrectionRecord[] = [
    ...tradeRows.map((r) => ({
      // `axis: { not: null }` guarantees a non-null value at runtime; the select
      // type stays `TrackingAxis | null`, so assert the narrowed shape.
      axis: r.axis as TrackingAxis,
      comment: r.comment,
      createdAt: r.createdAt,
      source: 'trade' as const,
    })),
    ...trainingRows.map((r) => ({
      axis: r.axis as TrackingAxis,
      comment: r.comment,
      createdAt: r.createdAt,
      source: 'training' as const,
    })),
  ];

  return aggregateCorrectionThemes(records);
}
