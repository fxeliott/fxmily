/**
 * Zod schemas for `MemberProfileMonthlySnapshot` (J-E — expansion IA profonde,
 * check-in mensuel ADMIN-ONLY).
 *
 * Longitudinal trajectory of the 4 deep AI dimensions, re-profiled every civil
 * month WITHOUT ever overwriting the onboarding baseline `MemberProfile`
 * (ADD-only). ADMIN-ONLY by design: `weakSignals` never crosses a member
 * surface, and none of the 4 dims is EVER a scoring input (firewall §21.5 —
 * same contract as the onboarding `MemberProfile` dims).
 *
 * Carbon of `lib/schemas/monthly-debrief.ts` (monthly cadence + cost tracking)
 * and `lib/schemas/onboarding-interview.ts` (the 4 evidence-grounded dim
 * sub-schemas are REUSED verbatim, so the admin renderer can treat an
 * onboarding profile and a monthly snapshot identically):
 *
 *   - `memberProfileMonthlySnapshotOutputSchema` — what the batch-local Claude
 *     Max run must return (JSON strict). Validated TWICE (envelope JSON-schema
 *     + this post-parse double-net). Each dim is OPTIONAL (the model omits it
 *     when the month's signal is insufficient) but STRICT when present, and its
 *     `evidence[]` must be a verbatim NFC substring of the month's corpus —
 *     validated at persist by the SAME `runSafetyGate` as the onboarding batch.
 *   - `memberProfileMonthlySnapshotCostSchema` — reused from monthly-debrief
 *     (generic batch-local Claude Max cost tracking ⇒ 0€ marginal, kept for
 *     audit/traceability, SPEC §25.2/§25.3).
 *   - `memberProfileMonthlySnapshotPersistInputSchema` — output + cost +
 *     civil-month dates (DB write, mirror monthly-debrief).
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5/§27.7). This file carries ZERO
 * real-edge P&L token by construction: it composes ONLY the onboarding dim
 * sub-schemas (evidence-grounded psycho/process axes) + a free-text narrative.
 * `.strict()` everywhere rejects a hallucinated key; the narrative is
 * `safeFreeText` + bidi/zero-width-hardened (mirror monthly-debrief).
 */

import { z } from 'zod';

import { normalizeAiTypography } from '@/lib/text/normalize-typography';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';
import {
  axesStructuredSchema,
  coachingToneSchema,
  learningStageSchema,
  weakSignalsSchema,
} from '@/lib/schemas/onboarding-interview';
import { monthlyDebriefCostSchema } from '@/lib/schemas/monthly-debrief';

// =============================================================================
// Constants — evolution narrative bounds (mirror monthly-debrief NARRATIVE_*).
// =============================================================================

/// The month-over-month evolution narrative for the admin (Eliott). Bounded
/// like the member-facing monthly progression narrative — long enough to be
/// useful, short enough to stay a synthesis, not a wall of text.
export const EVOLUTION_NARRATIVE_MIN_CHARS = 120;
export const EVOLUTION_NARRATIVE_MAX_CHARS = 1400;

const evolutionNarrativeSchema = z
  .string()
  .trim()
  .min(EVOLUTION_NARRATIVE_MIN_CHARS)
  .max(EVOLUTION_NARRATIVE_MAX_CHARS)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // Deterministic typography belt (F-J1) — em/en dashes out of Claude output.
  .transform(normalizeAiTypography);

// =============================================================================
// Output schema — what Claude must return (JSON strict, double-net)
// =============================================================================

/// The snake_case keys mirror the onboarding output contract
/// (`memberProfileOutputSchema`) so a single admin renderer + the same
/// `runSafetyGate` evidence validator apply to both surfaces. The 4 dims are
/// OPTIONAL (omitted when the month's signal is insufficient — never a
/// fabricated dim) but STRICT when present.
export const memberProfileMonthlySnapshotOutputSchema = z
  .object({
    /// ADMIN-ONLY month-over-month evolution synthesis (the J-E value-add:
    /// HOW the member's deep dimensions moved this month vs the onboarding
    /// baseline / the previous snapshot). Psycho/process only (posture §2).
    evolution_narrative: evolutionNarrativeSchema,
    // The 4 deep dimensions re-profiled this month. Reused verbatim from the
    // onboarding schema — same shape, same evidence-grounding contract.
    coaching_tone: coachingToneSchema.optional(),
    learning_stage: learningStageSchema.optional(),
    axes_structured: axesStructuredSchema.optional(),
    weak_signals: weakSignalsSchema.optional(),
  })
  .strict();

export type MemberProfileMonthlySnapshotOutput = z.infer<
  typeof memberProfileMonthlySnapshotOutputSchema
>;

// =============================================================================
// Cost-tracking schema — reused from monthly-debrief (generic batch-local
// Claude Max cost ⇒ 0€ marginal, kept for traceability/audit).
// =============================================================================

export const memberProfileMonthlySnapshotCostSchema = monthlyDebriefCostSchema;

export type MemberProfileMonthlySnapshotCost = z.infer<
  typeof memberProfileMonthlySnapshotCostSchema
>;

// =============================================================================
// Persisted schema — output + cost + civil-month dates (DB write, mirror
// monthly-debrief `monthlyDebriefPersistInputSchema`).
// =============================================================================

export const memberProfileMonthlySnapshotPersistInputSchema =
  memberProfileMonthlySnapshotOutputSchema.extend({
    // V1.10 canon: cuid (25) / nanoid (32) + margin, tightened from 128.
    userId: z.string().min(1).max(40),
    monthStart: z.date(),
    monthEnd: z.date(),
    cost: memberProfileMonthlySnapshotCostSchema,
  });

export type MemberProfileMonthlySnapshotPersistInput = z.infer<
  typeof memberProfileMonthlySnapshotPersistInputSchema
>;
