import 'server-only';

/**
 * J-E — cost pricing for the ADMIN-ONLY monthly deep re-profiling batch.
 *
 * Carbon of `monthly-debrief/pricing.ts`: the re-profiling pipeline reuses the
 * EXACT same Claude pricing table as the weekly/monthly reports (batch-local
 * Claude Max ⇒ 0€ marginal, kept for traceability/audit only, SPEC §25.3). Re-
 * exporting rather than duplicating keeps a single source of truth — a future
 * pricing change (FX drift, new model) lands in one file and every cadence stays
 * consistent. Importing `@/lib/weekly-report/pricing` is §21.5-clean: it is pure
 * cost arithmetic with zero training reference and is NOT a real-edge surface
 * (the anti-leak Block A globs `lib/weekly-report/builder.ts` only).
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
