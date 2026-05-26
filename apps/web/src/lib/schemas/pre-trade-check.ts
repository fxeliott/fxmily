import { z } from 'zod';

/**
 * V2.3 — `PreTradeCheck` Zod schema (Session BB, ADR-003).
 *
 * Single source of truth for the wizard's per-step validation AND the Server
 * Action re-validation. Server is the only authority (carbon-copy V1.5 §27
 * mindset-check Zod pattern).
 *
 * Pre-trade circuit breaker — 4 questions one-tap (~30s) before each trade :
 *   reasonToTrade      : edge / fomo / revenge / boredom (PreTradeReason)
 *   emotionLabel       : calme / excite / frustre / anxieux (PreTradeEmotion)
 *   planAlignment      : does this trade respect the documented plan?
 *   stopLossPredefined : is the stop-loss defined BEFORE entry?
 *
 * Evidence base : Mark Douglas 4 primary trading fears (Trading in the Zone,
 * ch.7-8) + Gollwitzer if-then implementation intentions meta-analysis
 * d=0.65 (Gollwitzer-Sheeran 2006, n=8461 / 94 studies). See
 * `docs/decisions/ADR-003-pre-trade-circuit-breaker.md` for the full
 * mapping vs Douglas's 4 fears + Steenbarger `boredom` extension rationale.
 *
 * **No free-text fields → no `safeFreeText` / `containsBidiOrZeroWidth`
 * import, no crisis surface, no injection surface, no EU AI Act banner.**
 * Adding any of those "just in case" would be dead code against the
 * scope-locked instrument (ADR-003 §Scope V1).
 *
 * Posture §2 : structure-only validation, zero P&L, zero market analysis,
 * never references the Lhedge system.
 */

// =============================================================================
// Enum tuples — exported for UI re-use + anti-regression length asserts
// =============================================================================

/**
 * 4 reasons mapped to Douglas's 4 primary trading fears (with Steenbarger
 * `boredom` extension documented in ADR-003 §Honesty disclaimer) :
 *   - `edge`    : setup éprouvé, je suis dans ma routine (absence des 4 fears)
 *   - `fomo`    : peur de rater quelque chose (fear of missing out, Douglas)
 *   - `revenge` : compenser une perte (fear of being wrong + losing money)
 *   - `boredom` : envie de faire quelque chose (Steenbarger low arousal,
 *                 NOT one of Douglas's 4 fears — see ADR-003 table)
 */
export const PRE_TRADE_REASONS = ['edge', 'fomo', 'revenge', 'boredom'] as const;

/**
 * 4 affective states mapping the Russell-Weiss-Mendelsohn 1989 affect grid
 * 2×2 (valence × arousal) :
 *   - `calme`   : low arousal, positive valence
 *   - `excite`  : high arousal, positive valence
 *   - `frustre` : high arousal, negative valence
 *   - `anxieux` : low-to-medium arousal, negative valence
 */
export const PRE_TRADE_EMOTIONS = ['calme', 'excite', 'frustre', 'anxieux'] as const;

export type PreTradeReason = (typeof PRE_TRADE_REASONS)[number];
export type PreTradeEmotion = (typeof PRE_TRADE_EMOTIONS)[number];

// =============================================================================
// Main schema — Server Action input
// =============================================================================

/**
 * Strict 4-field instrument. `.strict()` rejects unknown keys
 * defense-in-depth against a future LLM/UI bug that might add an extra
 * payload field.
 */
export const preTradeCheckSchema = z
  .object({
    reasonToTrade: z.enum(PRE_TRADE_REASONS, { error: 'Raison invalide.' }),
    emotionLabel: z.enum(PRE_TRADE_EMOTIONS, { error: 'Émotion invalide.' }),
    planAlignment: z.boolean({ error: "Réponse oui/non requise pour l'alignement au plan." }),
    stopLossPredefined: z.boolean({ error: 'Réponse oui/non requise pour le stop-loss.' }),
  })
  .strict();

export type PreTradeCheckInput = z.infer<typeof preTradeCheckSchema>;
