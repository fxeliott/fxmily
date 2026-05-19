import 'server-only';

/**
 * Monthly-debrief cost pricing (V1.4 — SPEC §25, J-M2).
 *
 * The monthly pipeline reuses the EXACT same Claude pricing table as the
 * weekly report (batch-local Claude Max ⇒ 0€ marginal, kept for
 * traceability/audit, SPEC §25.3). Re-exporting rather than duplicating the
 * constants keeps a single source of truth — a future pricing change (FX
 * drift, new model) lands in one file and both cadences stay consistent.
 * Importing `@/lib/weekly-report/pricing` here is §21.5-clean: it is pure
 * cost arithmetic with zero training reference and is NOT a real-edge
 * surface (the anti-leak Block A globs `lib/weekly-report/builder.ts` only;
 * WeeklyReport is the sanctioned INPUT source for §25 — mirror month-window).
 */

export {
  CLAUDE_CODE_LOCAL_MODEL,
  PRICING_USD_PER_MTOK,
  USD_TO_EUR,
  computeCostEur,
  sumCostsEur,
  type ClaudeUsage,
  type CostBreakdown,
  type SupportedModel,
} from '@/lib/weekly-report/pricing';
