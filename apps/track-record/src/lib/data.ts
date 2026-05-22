// Track-record data layer — single source of truth (T0.5 2026-05-21).
//
// HISTORICAL_TRADES = 139 trades générés depuis l'ODS via
// `C:/temp/gen_historical_trades.py` (year=2025 placeholder, à confirmer Eliot).
// Toutes les KPIs publiques de la page sont DÉRIVÉES de ce const via
// `computeKpis` et helpers — zéro hardcoding qui risquerait de mentir.

import { computeKpis, buildEquityCurve, groupByMonth, groupByInstrument } from './metrics';
import { HISTORICAL_TRADES, HISTORICAL_YEAR } from './historical-trades';

export { HISTORICAL_TRADES, HISTORICAL_YEAR };

/** Date pivot historical → live. La refonte est visible. */
export const TRACK_RECORD_PIVOT_DATE = new Date('2026-05-21T00:00:00.000Z');

/** KPIs publiques, COMPUTED at module load. Single source of truth = trades. */
export const TRACK_RECORD_KPIS = computeKpis(HISTORICAL_TRADES);

/** Equity curve (cumulative %) ordered chronologically by ordinal. */
export const EQUITY_CURVE = buildEquityCurve(HISTORICAL_TRADES);

/** Monthly aggregation (Janvier 2025 → Novembre 2025). */
export const MONTHLY_AGGREGATES = groupByMonth(HISTORICAL_TRADES);

/** Per-instrument breakdown. */
export const INSTRUMENT_AGGREGATES = groupByInstrument(HISTORICAL_TRADES);

/** Verbatim ODS monthly summaries (the SOURCE OF TRUTH from the spreadsheet).
 * Kept alongside MONTHLY_AGGREGATES to surface any divergence between the
 * ODS author summary and the per-trade derivation. Discrepancies hint at
 * data quality issues in the ODS that admin needs to fix in T2. */
export const ODS_MONTHLY_SUMMARIES = [
  { month: 1, label: 'Janvier', percent: 24 },
  { month: 2, label: 'Février', percent: 61.2 },
  { month: 3, label: 'Mars', percent: 49.4 },
  { month: 4, label: 'Avril', percent: -15.5 },
  { month: 5, label: 'Mai', percent: 0 },
  { month: 6, label: 'Juin', percent: 22 },
  { month: 7, label: 'Juillet', percent: 37.65 },
  { month: 8, label: 'Août', percent: 5.5 },
  { month: 9, label: 'Septembre', percent: 6 },
  { month: 10, label: 'Octobre', percent: 21.05 },
  { month: 11, label: 'Novembre', percent: 3 },
] as const;
