import 'server-only';

import { z } from 'zod';

import type { ClaudeUsage } from '@/lib/ai/claude-response';

/**
 * §26 Calendrier adaptatif — Claude cost pricing (J-C2). Carbone
 * `lib/weekly-report/pricing.ts` (a self-contained copy, NOT a re-export —
 * the calendar pipeline owns its own model allowlist : the LOCAL binary that
 * Eliot runs is Opus 4.8 again since 2026-06-11, not Sonnet 4.6 — Fable 5
 * leaves the Max plan's included models after 2026-06-22).
 *
 * Notes :
 *   - Prices in USD per **1 000 000 tokens**, converted USD → EUR at a fixed
 *     conservative rate (budget upper-bound, not FX accounting).
 *   - The §26 batch generates calendars via `claude --print` on Eliot's Claude
 *     Max subscription (flat fee) WITHOUT sending a `model`/`usage` on the
 *     wire ⇒ batch entries persist under the `claude-code-local` sentinel at
 *     0 tokens = 0 cost. The named model entries below carry the REAL API
 *     rates so the dormant paid path (`ANTHROPIC_API_KEY` set) bills honestly.
 */

// USD → EUR : conservative spot rate, mirror weekly-report/pricing (budget
// guardrail — err on "looks slightly more expensive in the DB than reality").
export const USD_TO_EUR = 0.93;

// USD per 1M tokens. Kept for a FUTURE paid Anthropic API fallback path
// (LiveCalendarClient defaults to env.ANTHROPIC_MODEL = Sonnet 4.6). Verified
// against `lib/weekly-report/pricing.ts` (Anthropic snapshot 2026-05-08).
const SONNET_4_6 = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.3, // 90% off base input
  cacheCreate: 3.75, // 25% over base input (1h ephemeral cache write)
};

/**
 * §26 sentinel — calendars generated locally via `claude --print` on Eliot's
 * Claude Max subscription. Subscription is a flat fee ⇒ per-token cost = 0.
 * Keep the entry here so `computeCostEur` returns a deterministic 0.000000
 * without taking the Sonnet fallback branch (which would `console.warn`).
 */
export const CLAUDE_CODE_LOCAL_MODEL = 'claude-code-local' as const;

/**
 * The §8 default binary (re-pinned 2026-06-11 — briefly superseded by Fable 5
 * on 2026-06-10). Priced at the REAL Anthropic API rates : since the env.ts
 * allowlist now accepts this slug, the paid path (`ANTHROPIC_API_KEY` +
 * `ANTHROPIC_MODEL=claude-opus-4-8`) is reachable and must bill honestly.
 * The LOCAL batch path is unaffected : the calendar orchestrator never sends
 * a `model` (nor `usage`) on the wire, so batch entries persist under the
 * `claude-code-local` sentinel at 0 tokens ⇒ 0 cost (Max flat fee).
 */
export const CLAUDE_OPUS_4_8_LOCAL_MODEL = 'claude-opus-4-8' as const;

/**
 * Fable 5 — §8 default binary 2026-06-10 → 2026-06-11 only (re-pinned to
 * Opus 4.8 : Fable 5 leaves the Max plan's included models after 2026-06-22,
 * usage-credits beyond). Stays allowlisted for MANUAL runs while included
 * (`FXMILY_CLAUDE_MODEL=claude-fable-5`). Priced at the REAL API rates
 * ($10/$50 MTok, Anthropic GA 2026-06-09) for the same reason as
 * {@link CLAUDE_OPUS_4_8_LOCAL_MODEL} : the paid path must never record a
 * 0 € cost for real billed tokens. Local batch cost stays 0 via the sentinel.
 */
export const CLAUDE_FABLE_5_LOCAL_MODEL = 'claude-fable-5' as const;

export const PRICING_USD_PER_MTOK = {
  'claude-sonnet-4-6': SONNET_4_6,
  // Real Fable 5 API rates — mirror `lib/weekly-report/pricing.ts`.
  [CLAUDE_FABLE_5_LOCAL_MODEL]: {
    input: 10.0,
    output: 50.0,
    cacheRead: 1.0, // 90% off base input
    cacheCreate: 12.5, // 25% over base input (1h ephemeral cache write)
  },
  // Real Opus 4.8 API rates — mirror `lib/weekly-report/pricing.ts`.
  [CLAUDE_OPUS_4_8_LOCAL_MODEL]: {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheCreate: 18.75,
  },
  // Allowlist ⊆ pricing-table parity with `lib/weekly-report/pricing.ts` :
  // every model accepted by `env.ANTHROPIC_MODEL` must be priced here too,
  // otherwise the dormant paid path would mis-bill via the Sonnet fallback.
  'claude-opus-4-7': {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheCreate: 18.75,
  },
  'claude-haiku-4-5': {
    input: 0.8,
    output: 4.0,
    cacheRead: 0.08,
    cacheCreate: 1.0,
  },
  // Local Claude Code sentinel : flat-rate Max subscription = 0 per-token.
  [CLAUDE_CODE_LOCAL_MODEL]: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
  },
} as const;

export type SupportedModel = keyof typeof PRICING_USD_PER_MTOK;

// Shared type from `@/lib/ai/claude-response` — re-exported for backwards
// compatibility (this module used to define its own copy).
export type { ClaudeUsage };

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
 * cost as a 6-decimal string ready to be written to the
 * `adaptive_calendars.cost_eur` `Decimal(10, 6)` column.
 *
 * Defensive : input is Zod-validated (rejects negatives + non-finite). Unknown
 * model strings fall back to Sonnet 4.6 pricing with a `console.warn` — the DB
 * column requires a non-null cost so we never throw here.
 */
export function computeCostEur(model: string, usage: ClaudeUsage): CostBreakdown {
  const parsed = usageSchema.parse(usage);
  const pricing = PRICING_USD_PER_MTOK[model as SupportedModel] ?? SONNET_4_6;
  if (!(model in PRICING_USD_PER_MTOK)) {
    console.warn(`[calendar.pricing] unknown model "${model}", using Sonnet 4.6 pricing`);
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

/** Sum a list of `CostBreakdown` for the batch run summary. */
export function sumCostsEur(costs: CostBreakdown[]): string {
  const total = costs.reduce((acc, c) => acc + Number(c.costEur), 0);
  return total.toFixed(6);
}
