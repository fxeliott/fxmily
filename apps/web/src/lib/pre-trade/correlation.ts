/**
 * V2.3 ext #4 — Session II backend (pre-trade × outcome correlation) pure module.
 *
 * **Différenciateur Fxmily** — révélateur empirique : "Est-ce que mes trades
 * `edge` performent réellement mieux que mes trades `fomo`/`revenge`/`boredom` ?"
 *
 * Pas de Pearson/Spearman ici (variable catégorielle `reasonToTrade` ×
 * outcome `win|loss|break_even` ∪ continuous `realizedR`). On fait un
 * **breakdown per-category** : 4 buckets (1 par reason), chacun avec
 * `winRate` + `lossRate` + `breakEvenRate` + `avgRealizedR` + sample sizes.
 *
 * Honesty doctrine (carbone V2.1.3 + Session HH analytics) :
 *   - `MIN_SAMPLE_PER_REASON_CORRELATION = 8` floor PER REASON (chaque bucket
 *     indépendant — un bucket peut être `insufficient_data` pendant qu'un
 *     autre est `ok`).
 *   - Discriminated union `{kind: 'ok'} | {kind: 'insufficient_data', reason}`.
 *   - `avgRealizedR` exclut les trades `realizedRSource='estimated'` (caller
 *     responsabilité : passer `realizedR: null` pour les estimated, le module
 *     ne voit pas la `realizedRSource`). `avgRSampleSize` distincte de
 *     `sampleSize` pour transparence honesty.
 *   - `reason: 'no_linked_trades'` (n=0) distinct de `'below_threshold'`
 *     (1 ≤ n < 8) pour les empty states UI distincts.
 *
 * Posture Mark Douglas neutre : output fact-only "edge: 60% win rate, +0.8R
 * avg, n=12". AUCUNE comparaison ("edge > fomo") au niveau du module pur —
 * c'est au membre d'interpréter via la couche UI (Session II frontend).
 *
 * Pure function : 0 DB, 0 I/O, 0 `Date.now()`, 0 `import 'server-only'`.
 *
 * Window filtering = service-layer concern (carbone analytics.ts pattern).
 */

import type { ReasonCounts } from './analytics';

/**
 * Input shape : 1 entrée par PreTradeCheck linké à un Trade closed (outcome
 * non null). Le service layer joint `PreTradeCheck.linkedTradeId` →
 * `Trade.id` + extrait outcome + `realizedR` SI `realizedRSource = 'computed'`
 * (sinon `realizedR: null` pour exclure des magnitudes).
 */
export interface LinkedPreTradeOutcome {
  reasonToTrade: 'edge' | 'fomo' | 'revenge' | 'boredom';
  outcome: 'win' | 'loss' | 'break_even';
  /** `null` si `realizedRSource='estimated'` ou non-computed. Exclu de l'`avgR`. */
  realizedR: number | null;
}

/**
 * Honesty threshold PER REASON. Aligné `MIN_SAMPLE_PRE_TRADE_ANALYTICS`
 * (Session HH) + `MIN_CORRELATION_PAIRS` (V2.1.3) — convention repo-wide.
 */
export const MIN_SAMPLE_PER_REASON_CORRELATION = 8;

/**
 * Stats par reason. Discriminated union — la branche `insufficient_data`
 * STRUCTURELLEMENT n'expose pas `winRate`/`avgRealizedR` (compile-time
 * honesty guarantee).
 */
export type PerReasonStats =
  | {
      kind: 'insufficient_data';
      sampleSize: number;
      reason: 'no_linked_trades' | 'below_threshold';
    }
  | {
      kind: 'ok';
      /** Total linked trades for this reason (closed, including realizedR-null estimated). */
      sampleSize: number;
      /** 0 ≤ winRate ≤ 1 (wins / sampleSize). */
      winRate: number;
      /** 0 ≤ lossRate ≤ 1 (losses / sampleSize). */
      lossRate: number;
      /** 0 ≤ breakEvenRate ≤ 1 (break_even / sampleSize). winRate + lossRate + breakEvenRate === 1. */
      breakEvenRate: number;
      /**
       * Average `realizedR` over the COMPUTED subset. `null` si aucun trade
       * computed dans le bucket (tous estimated). Honesty : magnitudes
       * exigent la source-truth `computed` (V1.5 Trade.realizedRSource canon).
       */
      avgRealizedR: number | null;
      /**
       * Subset size of trades with `realizedR !== null`. `avgRSampleSize <=
       * sampleSize` toujours. UI doit afficher les 2 distinctement.
       */
      avgRSampleSize: number;
    };

/** Result map : 1 entry per canonical reason (4 keys). */
export type CorrelationByReason = Record<keyof ReasonCounts, PerReasonStats>;

const REASONS: ReadonlyArray<keyof ReasonCounts> = ['edge', 'fomo', 'revenge', 'boredom'] as const;

/**
 * Compute the per-reason breakdown of pre-trade × outcome correlation.
 *
 * Pure : 0 DB, 0 I/O. `outcomes` est l'array déjà filtré par fenêtre 30j
 * + joint au Trade closed + `realizedR` extrait selon `realizedRSource`.
 */
export function computeCorrelationByReason(
  outcomes: readonly LinkedPreTradeOutcome[],
): CorrelationByReason {
  // Partition by reason — single pass O(n).
  const buckets: Record<keyof ReasonCounts, LinkedPreTradeOutcome[]> = {
    edge: [],
    fomo: [],
    revenge: [],
    boredom: [],
  };
  for (const o of outcomes) {
    buckets[o.reasonToTrade].push(o);
  }

  const result = {} as CorrelationByReason;
  for (const reason of REASONS) {
    result[reason] = aggregateBucket(buckets[reason]);
  }
  return result;
}

function aggregateBucket(bucket: ReadonlyArray<LinkedPreTradeOutcome>): PerReasonStats {
  const sampleSize = bucket.length;
  if (sampleSize === 0) {
    return { kind: 'insufficient_data', sampleSize: 0, reason: 'no_linked_trades' };
  }
  if (sampleSize < MIN_SAMPLE_PER_REASON_CORRELATION) {
    return { kind: 'insufficient_data', sampleSize, reason: 'below_threshold' };
  }

  let wins = 0;
  let losses = 0;
  let breakEvens = 0;
  let rSum = 0;
  let rCount = 0;
  for (const o of bucket) {
    if (o.outcome === 'win') wins += 1;
    else if (o.outcome === 'loss') losses += 1;
    else breakEvens += 1;
    if (o.realizedR !== null) {
      rSum += o.realizedR;
      rCount += 1;
    }
  }

  return {
    kind: 'ok',
    sampleSize,
    winRate: wins / sampleSize,
    lossRate: losses / sampleSize,
    breakEvenRate: breakEvens / sampleSize,
    avgRealizedR: rCount === 0 ? null : rSum / rCount,
    avgRSampleSize: rCount,
  };
}
