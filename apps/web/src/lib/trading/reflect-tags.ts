import type { TradeTagSlug } from '@/lib/schemas/trade';

/**
 * Tour 11 — shared FR labels for the V1.8 REFLECT bias tags (CFA LESSOR +
 * Steenbarger). Single source for every surface that RESTITUTES tags to the
 * member (trade detail pills, /patterns aggregate), mirroring the wording
 * already used at capture time by `TradeTagsPicker` (TAG_METAS).
 *
 * Pure module (no `server-only`, no DB) so both server pages and client
 * components can import it. `Record<TradeTagSlug, string>` keeps the map
 * exhaustive by construction: adding a slug to `TRADE_TAG_SLUGS` breaks the
 * build here until a label is provided.
 *
 * Posture (Mark Douglas): a tag is a post-mortem classification of the ACT,
 * never a judgment of the trader. `discipline-high` is the strengths-based
 * counterpoint (only tag rendered with the `ok` tone); every bias tag stays
 * neutral/mute — red is reserved for trade outcomes.
 */
export const TRADE_TAG_LABELS: Record<TradeTagSlug, string> = {
  'loss-aversion': 'Aversion à la perte',
  overconfidence: 'Sur-confiance',
  'regret-aversion': 'Aversion au regret',
  'status-quo': 'Statu quo',
  endowment: 'Effet de dotation',
  'self-control-fail': 'Manque de discipline',
  'discipline-high': 'Discipline solide',
  'revenge-trade': 'Revenge trade',
};

/** Strengths-based tag — the only one that may carry the `ok` tone. */
export function isPositiveTradeTag(slug: TradeTagSlug): boolean {
  return slug === 'discipline-high';
}
