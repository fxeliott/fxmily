/**
 * Allowed trading pair symbols (J2, SPEC §7.3).
 *
 * Decision: pairs are stored as plain uppercase strings on `Trade.pair`
 * rather than a Postgres enum so adding a new symbol later doesn't require
 * a schema migration. The allowlist is enforced at the form (Zod) and
 * Server Action (defense in depth) edges instead.
 *
 * Eliot validated the V1 set on 2026-05-05: 7 forex majors + 2 metals + 3
 * US indices. Crypto and exotic pairs are explicitly out of scope.
 */

export const TRADING_PAIRS = [
  // Forex majors
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'USDCHF',
  'AUDUSD',
  'USDCAD',
  'NZDUSD',
  // Metals
  'XAUUSD',
  'XAGUSD',
  // US indices (CFDs)
  'US30',
  'NAS100',
  'SPX500',
] as const;

export type TradingPair = (typeof TRADING_PAIRS)[number];

const TRADING_PAIRS_SET: ReadonlySet<string> = new Set(TRADING_PAIRS);

/** Type guard — useful in Zod refinements and Server Actions. */
export function isTradingPair(value: string): value is TradingPair {
  return TRADING_PAIRS_SET.has(value);
}

/**
 * Asset class buckets.
 *
 * Used for UX hints (decimal precision, default lot size suggestions, "what is
 * a lot here?" tooltips). NOT persisted in DB — derive at render time.
 */
export type AssetClass = 'forex' | 'metal' | 'index';

const ASSET_CLASS: Record<TradingPair, AssetClass> = {
  EURUSD: 'forex',
  GBPUSD: 'forex',
  USDJPY: 'forex',
  USDCHF: 'forex',
  AUDUSD: 'forex',
  USDCAD: 'forex',
  NZDUSD: 'forex',
  XAUUSD: 'metal',
  XAGUSD: 'metal',
  US30: 'index',
  NAS100: 'index',
  SPX500: 'index',
};

export function assetClassOf(pair: TradingPair): AssetClass {
  return ASSET_CLASS[pair];
}

/**
 * Suggested decimal precision for the entry/exit/stop-loss inputs. Helps the
 * UI render `<input type="number" step="...">` with sane defaults.
 *   - Forex majors: 5 (e.g. 1.08234)
 *   - JPY pairs:    3 (e.g. 152.342)
 *   - Metals:       2 (e.g. 2034.50)
 *   - Indices:      2 (e.g. 35420.00)
 */
export function pricePrecisionOf(pair: TradingPair): number {
  if (pair === 'USDJPY') return 3;
  if (assetClassOf(pair) === 'forex') return 5;
  return 2;
}
