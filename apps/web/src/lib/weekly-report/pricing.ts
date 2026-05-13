import 'server-only';

import { z } from 'zod';

/**
 * Claude Sonnet 4.6 pricing — early 2026 rates.
 *
 * Source : Anthropic pricing page snapshot (2026-05-08, verified in the J8
 * pre-flight). Keep these in code (not env) so cost_eur in the DB is
 * deterministically reproducible from token counts in audit / repro.
 *
 * Notes :
 *   - Prices in USD per **1 000 000 tokens**.
 *   - We convert USD → EUR with a fixed conservative rate (slightly above the
 *     YTD low) — the goal is "cost upper bound for budgeting", not FX accounting.
 *   - Prompt-cache 1h ephemeral : write-time bills at ~25% over base input,
 *     read-time bills at ~10% (90% rabais on hits). Pricing constants below.
 */

// USD per 1M tokens (2026-05-08 verified)
const SONNET_4_6 = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.3, // 90% off base input
  cacheCreate: 3.75, // 25% over base input (1h ephemeral cache write)
};

// USD → EUR : conservative spot rate. Round-trip: a small under-estimate would
// make us look cheap; we err on the side of "looks slightly more expensive in
// the DB than reality" so the budget guardrail SPEC §16 (~5–10€/mois) holds.
export const USD_TO_EUR = 0.93;

/**
 * V1.7 sentinel — reports generated locally via `claude --print` on Eliot's
 * Claude Max subscription. Subscription is a flat fee, so per-token cost = 0.
 * Keep the entry here so `computeCostEur` returns a deterministic 0.000000
 * without taking the SONNET_4_6 fallback branch (which would `console.warn`).
 */
export const CLAUDE_CODE_LOCAL_MODEL = 'claude-code-local' as const;

export const PRICING_USD_PER_MTOK = {
  'claude-sonnet-4-6': SONNET_4_6,
  // Fallback for the cheapest model — used in mock + future Haiku migration
  // (SPEC §18.2 risque "Haiku si > 1000 membres").
  'claude-haiku-4-5': {
    input: 0.8,
    output: 4.0,
    cacheRead: 0.08,
    cacheCreate: 1.0,
  },
  // V1.7 local Claude Code path : flat-rate Max subscription = 0 per-token.
  [CLAUDE_CODE_LOCAL_MODEL]: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
  },
} as const;

export type SupportedModel = keyof typeof PRICING_USD_PER_MTOK;

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface CostBreakdown {
  costUsd: number;
  costEur: string; // 6-decimal string for the DB `Decimal(10, 6)` column
}

const usageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0).default(0),
  cacheCreateTokens: z.number().int().min(0).default(0),
});

/**
 * Compute the EUR cost of a Claude completion given token counts. Returns the
 * cost as a 6-decimal string ready to be written to the `weekly_reports.cost_eur`
 * `Decimal(10, 6)` column.
 *
 * Defensive : input is Zod-validated (rejects negatives + non-finite). Unknown
 * model strings fall back to Sonnet 4.6 pricing with a `console.warn` — the DB
 * column requires a non-null cost so we never throw here.
 */
export function computeCostEur(model: string, usage: ClaudeUsage): CostBreakdown {
  const parsed = usageSchema.parse(usage);
  const pricing = PRICING_USD_PER_MTOK[model as SupportedModel] ?? SONNET_4_6;
  if (!(model in PRICING_USD_PER_MTOK)) {
    console.warn(`[weekly-report.pricing] unknown model "${model}", using Sonnet 4.6 pricing`);
  }

  // Per-MTok prices → per-token, multiply by counts.
  const inputUsd = (parsed.inputTokens * pricing.input) / 1_000_000;
  const outputUsd = (parsed.outputTokens * pricing.output) / 1_000_000;
  const cacheReadUsd = (parsed.cacheReadTokens * pricing.cacheRead) / 1_000_000;
  const cacheCreateUsd = (parsed.cacheCreateTokens * pricing.cacheCreate) / 1_000_000;
  const costUsd = inputUsd + outputUsd + cacheReadUsd + cacheCreateUsd;
  const costEur = costUsd * USD_TO_EUR;

  return {
    costUsd,
    costEur: costEur.toFixed(6),
  };
}

/**
 * Sum a list of `CostBreakdown` for the cron run summary.
 */
export function sumCostsEur(costs: CostBreakdown[]): string {
  const total = costs.reduce((acc, c) => acc + Number(c.costEur), 0);
  return total.toFixed(6);
}
