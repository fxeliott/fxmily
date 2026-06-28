import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';

/** Prisma unique-constraint violation (P2002), detected without importing @prisma/client. */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
}

/**
 * Run a `discrepancy.create` + penalising `scoreEvent.create` pair idempotently.
 *
 * The in-memory `existingKeys` guard (read-then-create) skips the common re-run
 * case, but it is NOT concurrency-safe: the daily `verification-scan` cron and
 * an event-driven `batch.ts` pass can both read « none » for the same gap before
 * either commits, then both INSERT — a duplicate accusation AND a duplicate
 * NEGATIVE ScoreEvent (the member punished twice for one presumed gap). The
 * partial unique index `discrepancies_reconcile_key_uniq` makes the loser's
 * discrepancy create raise P2002, folded here into a no-op. Only the discrepancy
 * create can raise P2002 (score_events has no unique constraint), so wrapping
 * both writes means a lost race never emits the penalty either. Returns true iff
 * a row was actually created (so the caller only counts real new écarts).
 */
async function createIfNew(write: () => Promise<void>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (err) {
    if (isUniqueConstraintError(err)) return false;
    throw err;
  }
}

/**
 * S3 §33.5 — Réconciliation déclaré ↔ réalité (moteur DÉTERMINISTE).
 *
 * Croise les `Trade` déclarés (journal) avec les `ExtractedPosition` lues
 * par la vision (preuves MT5) et matérialise :
 *   - `Trade.matchStatus/verifiedAt/source` (matched / mismatch / unmatched)
 *   - `Discrepancy` rows : missing_declared (position réelle jamais déclarée),
 *     false_declared (trade déclaré sans contrepartie alors que la période
 *     est couverte par des preuves), mismatch (les deux existent mais les
 *     volumes divergent)
 *   - `ScoreEvent` rows (reality_gap / false_declaration) liés aux écarts
 *     NOUVELLEMENT créés (dédup par l'écart, jamais ré-émis)
 *
 * Choix déterministes documentés (le verdict doit rester auditable §33.5 —
 * Claude n'intervient PAS ici) :
 *   - clé de matching = symbole (uppercase exact) + side + |openTime −
 *     enteredAt| ≤ 3 h (tolérance fuseau serveur broker, cf.
 *     MATCH_TIME_TOLERANCE_MS) + volume à ±15 % quand les deux sont connus.
 *     JAMAIS le prix exact : la lecture OCR d'un digit peut dévier sur les
 *     petites polices (probe mobile 2026-06-11) — le prix n'est pas une clé.
 *   - greedy par distance temporelle croissante, appariement unique.
 *   - HONNÊTETÉ anti-survente (§33.6) : un trade déclaré sans contrepartie
 *     n'est `false_declared` QUE si sa date d'entrée tombe dans une fenêtre
 *     couverte par les positions extraites (sinon il reste `unmatched` —
 *     « pas encore confrontable », pas un mensonge prouvé).
 */

/**
 * |openTime − enteredAt| tolerance — declared times are hand-entered AND the
 * two clocks rarely agree:
 *   - `Trade.enteredAt` is the member's real instant (Paris datetime-local →
 *     UTC), accurate to the minute they typed;
 *   - `ExtractedPosition.openTime` comes from the MT5 history header, printed
 *     in the BROKER SERVER timezone (FTMO & most prop firms run EET = UTC+2/+3)
 *     and usually WITHOUT a visible offset. The vision prompt then falls back
 *     to "assume Europe/Paris" (prompt.ts) → a systematic ~1-3 h residual for
 *     any non-Paris server.
 *
 * A 45-min window let that residual flip an HONEST trade to `false_declared` /
 * its position to `missing_declared` — the exact false accusation §33.6
 * forbids ("préférer ne pas accuser"). Until the per-account server timezone is
 * captured and `openTime` normalised to UTC (BrokerAccount.serverUtcOffset, V2),
 * the window is widened to 3 h: it absorbs every realistic broker-vs-Paris
 * offset while the symbol + side + volume(±15 %) keys remain the real
 * discriminators (a fabricated trade still needs the same instrument, side and
 * size as a real position within 3 h to escape detection — and erring toward a
 * missed lie over a false accusation is precisely the §33.6 trade-off).
 */
export const MATCH_TIME_TOLERANCE_MS = 3 * 60 * 60 * 1000;
/** Relative volume tolerance when both sides carry a size. */
export const MATCH_VOLUME_TOLERANCE = 0.15;
/** Coverage margin around the extracted-position window (§33.6 honesty). */
export const COVERAGE_MARGIN_MS = 12 * 60 * 60 * 1000;

export interface ReconcileTradeInput {
  readonly id: string;
  readonly pair: string;
  readonly direction: 'long' | 'short';
  readonly enteredAt: Date;
  readonly lotSize: number | null;
  readonly matchStatus: 'unmatched' | 'matched' | 'mismatch' | null;
  /** Adverse-review TIER1 fix: the vision prompt extracts CLOSED positions
   *  only, so an OPEN declared trade structurally has no counterpart yet —
   *  it can MATCH (member declared at entry, closed in MT5 already) but must
   *  NEVER be accused of `false_declared`. */
  readonly isClosed: boolean;
}

export interface ReconcilePositionInput {
  readonly id: string;
  readonly symbol: string;
  readonly side: 'long' | 'short';
  readonly openTime: Date;
  readonly volume: number;
}

export type ReconcileVerdict =
  | { readonly kind: 'matched'; readonly tradeId: string; readonly positionId: string }
  | { readonly kind: 'mismatch'; readonly tradeId: string; readonly positionId: string }
  | { readonly kind: 'missing_declared'; readonly positionId: string }
  | { readonly kind: 'false_declared'; readonly tradeId: string }
  | { readonly kind: 'uncovered'; readonly tradeId: string };

/**
 * Pure matching core — unit-testable without a DB (pattern §7.11).
 *
 * Pass 1 matches on the full key (time + symbol + side + volume). Pass 2
 * re-scans the leftovers on a relaxed key (time + symbol + side, volume
 * divergent) → `mismatch` (both sides exist, the numbers diverge). Leftover
 * positions → `missing_declared`. Leftover trades → `false_declared` when
 * covered by a proof window, `uncovered` otherwise.
 */
export function reconcileMember(
  trades: readonly ReconcileTradeInput[],
  positions: readonly ReconcilePositionInput[],
): ReconcileVerdict[] {
  const verdicts: ReconcileVerdict[] = [];
  const usedPositions = new Set<string>();
  const matchedTrades = new Set<string>();

  interface Candidate {
    tradeId: string;
    positionId: string;
    distanceMs: number;
    volumeOk: boolean;
  }

  const candidates: Candidate[] = [];
  for (const trade of trades) {
    const pair = trade.pair.toUpperCase();
    for (const pos of positions) {
      if (pos.symbol.toUpperCase() !== pair) continue;
      if (pos.side !== trade.direction) continue;
      const distanceMs = Math.abs(pos.openTime.getTime() - trade.enteredAt.getTime());
      if (distanceMs > MATCH_TIME_TOLERANCE_MS) continue;
      const volumeOk =
        trade.lotSize === null ||
        trade.lotSize <= 0 ||
        Math.abs(pos.volume - trade.lotSize) <=
          MATCH_VOLUME_TOLERANCE * Math.max(trade.lotSize, pos.volume);
      candidates.push({ tradeId: trade.id, positionId: pos.id, distanceMs, volumeOk });
    }
  }

  // Pass 1 — strict (volume agrees), closest first, unique pairing.
  candidates.sort((a, b) => a.distanceMs - b.distanceMs);
  for (const c of candidates) {
    if (!c.volumeOk) continue;
    if (matchedTrades.has(c.tradeId) || usedPositions.has(c.positionId)) continue;
    matchedTrades.add(c.tradeId);
    usedPositions.add(c.positionId);
    verdicts.push({ kind: 'matched', tradeId: c.tradeId, positionId: c.positionId });
  }

  // Pass 2 — relaxed (volume diverges) → mismatch, still unique pairing.
  for (const c of candidates) {
    if (c.volumeOk) continue;
    if (matchedTrades.has(c.tradeId) || usedPositions.has(c.positionId)) continue;
    matchedTrades.add(c.tradeId);
    usedPositions.add(c.positionId);
    verdicts.push({ kind: 'mismatch', tradeId: c.tradeId, positionId: c.positionId });
  }

  // Leftover positions — real activity never declared (l'oubli).
  for (const pos of positions) {
    if (!usedPositions.has(pos.id)) {
      verdicts.push({ kind: 'missing_declared', positionId: pos.id });
    }
  }

  // Leftover trades — covered window ⇒ false_declared, else uncovered.
  // OPEN trades emit NO verdict at all (adverse-review TIER1): they are not
  // confrontable yet — the diligent member who declares at entry and proves
  // the same day must never be flagged a liar.
  const windows = coverageWindows(positions);
  for (const trade of trades) {
    if (matchedTrades.has(trade.id)) continue;
    if (!trade.isClosed) continue;
    const t = trade.enteredAt.getTime();
    const covered = windows.some(([start, end]) => t >= start && t <= end);
    verdicts.push(
      covered
        ? { kind: 'false_declared', tradeId: trade.id }
        : { kind: 'uncovered', tradeId: trade.id },
    );
  }

  return verdicts;
}

/** Max gap between two consecutive extracted positions inside ONE coverage
 *  cluster. Beyond it, the windows split — a January proof and a June proof
 *  must NOT fuse into one giant window that "covers" a never-screened March
 *  (adverse-review TIER2: false accusation on unproven periods). */
export const COVERAGE_CLUSTER_GAP_MS = 3 * 24 * 60 * 60 * 1000;

/** Coverage = clustered [min−margin, max+margin] windows over the extracted
 *  positions' openTimes (split on gaps > COVERAGE_CLUSTER_GAP_MS). Documented
 *  limit (§33.6): a member screening only SOME days can still hide a trade —
 *  the screenshot is a confrontation signal, never absolute forensics. */
function coverageWindows(positions: readonly ReconcilePositionInput[]): Array<[number, number]> {
  if (positions.length === 0) return [];
  const times = positions.map((p) => p.openTime.getTime()).sort((a, b) => a - b);
  const windows: Array<[number, number]> = [];
  let clusterStart = times[0] as number;
  let clusterEnd = times[0] as number;
  for (const t of times.slice(1)) {
    if (t - clusterEnd > COVERAGE_CLUSTER_GAP_MS) {
      windows.push([clusterStart - COVERAGE_MARGIN_MS, clusterEnd + COVERAGE_MARGIN_MS]);
      clusterStart = t;
    }
    clusterEnd = t;
  }
  windows.push([clusterStart - COVERAGE_MARGIN_MS, clusterEnd + COVERAGE_MARGIN_MS]);
  return windows;
}

// =============================================================================
// DB orchestration
// =============================================================================

export interface ReconcileRunResult {
  readonly membersScanned: number;
  readonly tradesMatched: number;
  readonly tradesMismatched: number;
  readonly discrepanciesCreated: number;
  readonly errors: number;
}

/** Negative deltas (§33.5) — formulas documented + unit-tested. */
export const SCORE_DELTA_REALITY_GAP = -3;
export const SCORE_DELTA_FALSE_DECLARATION = -8;

/**
 * Run the reconciliation for every member who has extracted positions.
 * Idempotent: verdicts are recomputed from source data; discrepancies are
 * deduplicated on their identity (member + type + declared/extracted ids)
 * and ScoreEvents only fire for NEWLY created discrepancies.
 */
export async function reconcileAllMembers(
  options: { now?: Date } = {},
): Promise<ReconcileRunResult> {
  const now = options.now ?? new Date();

  const membersWithPositions = await db.brokerAccount.findMany({
    where: { positions: { some: {} }, member: { status: 'active' } },
    select: { memberId: true },
    distinct: ['memberId'],
  });

  let tradesMatched = 0;
  let tradesMismatched = 0;
  let discrepanciesCreated = 0;
  let errors = 0;

  for (const { memberId } of membersWithPositions) {
    try {
      const result = await reconcileOneMember(memberId, now);
      tradesMatched += result.matched;
      tradesMismatched += result.mismatched;
      discrepanciesCreated += result.discrepanciesCreated;
    } catch (err) {
      errors += 1;
      reportError(
        'verification.reconcile',
        err instanceof Error ? err : new Error('reconcile_member_failed'),
        { memberId },
      );
    }
  }

  return {
    membersScanned: membersWithPositions.length,
    tradesMatched,
    tradesMismatched,
    discrepanciesCreated,
    errors,
  };
}

/**
 * S4 §30 — exported so the verification batch can reconcile a member's freshly
 * persisted positions BEFORE the event-driven alert scan (mirrors the cron's
 * reconcile→alerts order). Idempotent: the cron already re-runs it daily, so an
 * extra event-driven pass creates no duplicate discrepancies. The in-memory
 * `existingKeys` guard covers the sequential re-run; the CONCURRENT case (this
 * pass interleaving with the cron) is backstopped at the DB by the partial
 * unique index `discrepancies_reconcile_key_uniq` → P2002 folded to a no-op in
 * `createIfNew`, so neither a second accusation nor a second penalty can land.
 */
export async function reconcileOneMember(
  memberId: string,
  now: Date,
): Promise<{ matched: number; mismatched: number; discrepanciesCreated: number }> {
  const [trades, positions] = await Promise.all([
    db.trade.findMany({
      where: { userId: memberId },
      select: {
        id: true,
        pair: true,
        direction: true,
        enteredAt: true,
        exitedAt: true,
        lotSize: true,
        matchStatus: true,
      },
    }),
    db.extractedPosition.findMany({
      where: { brokerAccount: { memberId } },
      select: { id: true, symbol: true, side: true, openTime: true, volume: true },
    }),
  ]);

  const tradeStatusById = new Map(trades.map((t) => [t.id, t.matchStatus]));
  const verdicts = reconcileMember(
    trades.map((t) => ({
      id: t.id,
      pair: t.pair,
      direction: t.direction,
      enteredAt: t.enteredAt,
      lotSize: t.lotSize === null ? null : Number(t.lotSize),
      matchStatus: t.matchStatus,
      isClosed: t.exitedAt !== null,
    })),
    positions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      openTime: p.openTime,
      volume: Number(p.volume),
    })),
  );

  // Existing discrepancies — identity-level dedup (re-runs never duplicate).
  const existing = await db.discrepancy.findMany({
    where: { memberId, type: { in: ['missing_declared', 'false_declared', 'mismatch'] } },
    select: { type: true, declaredTradeId: true, extractedPositionId: true },
  });
  const existingKeys = new Set(
    existing.map((d) => `${d.type}|${d.declaredTradeId ?? ''}|${d.extractedPositionId ?? ''}`),
  );

  let matched = 0;
  let mismatched = 0;
  let discrepanciesCreated = 0;

  for (const v of verdicts) {
    if (v.kind === 'matched') {
      matched += 1;
      // `verifiedAt` only stamps the FIRST confirmation (re-runs are no-ops,
      // no churn). RETRACTION (adverse-review TIER2): reality just confirmed
      // this trade/position pair — auto-resolve any stale accusation that an
      // earlier run produced before the matching proof arrived. The fold
      // treats `resolved` discrepancies as excused → the score repairs
      // itself without the innocent member having to self-excuse.
      if (tradeStatusById.get(v.tradeId) !== 'matched') {
        await db.trade.update({
          where: { id: v.tradeId },
          data: { matchStatus: 'matched', verifiedAt: now, source: 'mt5_verified' },
        });
      }
      const retracted = await db.discrepancy.updateMany({
        where: {
          memberId,
          status: { not: 'resolved' },
          OR: [
            { type: 'false_declared', declaredTradeId: v.tradeId },
            { type: 'mismatch', declaredTradeId: v.tradeId },
            { type: 'missing_declared', extractedPositionId: v.positionId },
          ],
        },
        data: { status: 'resolved' },
      });
      if (retracted.count > 0) {
        await logAudit({
          action: 'verification.batch.persisted',
          userId: memberId,
          metadata: { scope: 'retraction', tradeId: v.tradeId, retracted: retracted.count },
        });
      }
      continue;
    }

    if (v.kind === 'uncovered') {
      // Confronté mais hors fenêtre de preuve — honnêteté §33.6 : pas un
      // mensonge prouvé, juste « pas encore confrontable ». State-consistency
      // (adverse-review): a trade leaving `matched` also drops its verified
      // stamps — `unmatched` + `mt5_verified` would be contradictory.
      await db.trade.update({
        where: { id: v.tradeId },
        data: { matchStatus: 'unmatched', verifiedAt: null, source: 'self_declared' },
      });
      continue;
    }

    if (v.kind === 'mismatch') {
      mismatched += 1;
      if (tradeStatusById.get(v.tradeId) !== 'mismatch') {
        await db.trade.update({
          where: { id: v.tradeId },
          data: { matchStatus: 'mismatch', verifiedAt: now },
        });
      }
      const key = `mismatch|${v.tradeId}|${v.positionId}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        const created = await createIfNew(async () => {
          const disc = await db.discrepancy.create({
            data: {
              memberId,
              type: 'mismatch',
              declaredTradeId: v.tradeId,
              extractedPositionId: v.positionId,
              severity: 1,
              claudeReasoning:
                'Le trade déclaré et la position MT5 correspondent (heure, sens, instrument) mais la taille diverge au-delà de la tolérance.',
            },
            select: { id: true },
          });
          await db.scoreEvent.create({
            data: {
              memberId,
              delta: SCORE_DELTA_REALITY_GAP,
              reason: 'reality_gap',
              relatedDiscrepancyId: disc.id,
            },
          });
        });
        if (created) discrepanciesCreated += 1;
      }
      continue;
    }

    if (v.kind === 'missing_declared') {
      const key = `missing_declared||${v.positionId}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        const created = await createIfNew(async () => {
          const disc = await db.discrepancy.create({
            data: {
              memberId,
              type: 'missing_declared',
              extractedPositionId: v.positionId,
              severity: 2,
              claudeReasoning:
                "Une position fermée apparaît dans l'historique MT5 fourni mais n'a pas été déclarée dans le journal.",
            },
            select: { id: true },
          });
          await db.scoreEvent.create({
            data: {
              memberId,
              delta: SCORE_DELTA_REALITY_GAP,
              reason: 'reality_gap',
              relatedDiscrepancyId: disc.id,
            },
          });
        });
        if (created) discrepanciesCreated += 1;
      }
      continue;
    }

    // false_declared — same state-consistency reset as `uncovered`.
    await db.trade.update({
      where: { id: v.tradeId },
      data: { matchStatus: 'unmatched', verifiedAt: null, source: 'self_declared' },
    });
    const key = `false_declared|${v.tradeId}|`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      const created = await createIfNew(async () => {
        const disc = await db.discrepancy.create({
          data: {
            memberId,
            type: 'false_declared',
            declaredTradeId: v.tradeId,
            severity: 3,
            claudeReasoning:
              "Un trade déclaré dans le journal n'a pas de contrepartie dans l'historique MT5 fourni, alors que la période est couverte par les preuves.",
          },
          select: { id: true },
        });
        await db.scoreEvent.create({
          data: {
            memberId,
            delta: SCORE_DELTA_FALSE_DECLARATION,
            reason: 'false_declaration',
            relatedDiscrepancyId: disc.id,
          },
        });
      });
      if (created) discrepanciesCreated += 1;
    }
  }

  if (matched + mismatched + discrepanciesCreated > 0) {
    await logAudit({
      action: 'verification.batch.persisted',
      userId: memberId,
      metadata: {
        scope: 'reconcile',
        matched,
        mismatched,
        discrepanciesCreated,
        ranAt: now.toISOString(),
      },
    });
  }

  return { matched, mismatched, discrepanciesCreated };
}
