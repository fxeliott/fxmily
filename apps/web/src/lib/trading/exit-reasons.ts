import type { TradeExitReasonSlug } from '@/lib/schemas/trade';

/**
 * Tour 10 — shared FR labels for `Trade.exitReason` (single source for the
 * close form, the trade detail view and the close echo). Factual wording on
 * purpose (SPEC §2 / §31.2): every option describes HOW the position ended,
 * none of them is framed as a fault — `sl_hit` is a normal cost of doing
 * business, `manual_before_target` is an act to LOOK at, not a verdict.
 */
export const EXIT_REASON_LABELS: Record<TradeExitReasonSlug, string> = {
  tp_hit: 'TP atteint',
  sl_hit: 'SL touché',
  be_exit: 'Break-even',
  manual_before_target: "Sortie avant l'objectif",
  time_exit: 'Bougie 20h',
};

/** Ordered option list for the close form's radio group (plan-first order). */
export const EXIT_REASON_OPTIONS: readonly TradeExitReasonSlug[] = [
  'tp_hit',
  'sl_hit',
  'be_exit',
  'manual_before_target',
  'time_exit',
];
