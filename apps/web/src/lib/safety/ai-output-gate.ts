/**
 * Shared AI-output safety gate (SPEC §2 posture invariant + crisis backstop).
 *
 * SINGLE SOURCE OF TRUTH for "is this AI-generated text safe to persist /
 * surface to a member ?". Every path that turns Claude output into a stored,
 * member- or admin-facing artifact (weekly report, monthly debrief, calendar,
 * onboarding, verification) MUST screen its free-text through this helper
 * BEFORE persisting — that is the contract PROJECT_STATE §9 #1
 * ("Tout output IA passe le gate detectAMFViolation").
 *
 * Why this module exists (S5 10e challenge — D4-01) : the gate used to be
 * inlined per-pipeline. The live weekly-report cron path (`service.ts`) had no
 * gate at all — a contract violation that would leak ungated Claude text the
 * moment `ANTHROPIC_API_KEY` activates the live client. Centralising the screen
 * here makes the gate impossible to forget and impossible to drift between
 * paths.
 *
 * Pure, side-effect free, no server-only / DB / env deps — mirrors
 * `amf-detection.ts` and `crisis-detection.ts`. Callers own their audit/report
 * semantics (they differ per pipeline) ; this module only decides.
 */

import { detectAMFViolation, type AMFViolationResult } from './amf-detection';
import { detectCrisis, type CrisisDetection } from './crisis-detection';

/** Canonical reason an AI output was blocked, or `null` when it passed. */
export type AiOutputBlockReason = 'crisis_high' | 'crisis_medium' | 'amf' | null;

export interface AiOutputScreen {
  /** Raw AMF detector result (for the caller's audit / labels). */
  amf: AMFViolationResult;
  /** Raw crisis detector result (for the caller's audit / labels). */
  crisis: CrisisDetection;
  /** True iff the output MUST NOT be persisted. */
  blocked: boolean;
  /** Canonical block reason, or `null` when `blocked === false`. */
  reason: AiOutputBlockReason;
}

/**
 * Screen a concatenated AI free-text corpus against the crisis + AMF gates.
 *
 * Precedence (mirrors the original inline batch order) : a crisis signal
 * (high or medium) takes priority over an AMF violation, because a crisis
 * block escalates to a page-out / human review while an AMF block is a
 * content-policy skip. `low` crisis does NOT block (matches batch behaviour).
 *
 * The caller is responsible for:
 *   - Concatenating EVERY free-text channel the AI can write before calling.
 *   - Never logging the raw text alongside `matchedLabels` (RGPD §16).
 *   - Mapping `reason` to the right audit action + Sentry severity.
 */
export function screenAiOutputText(corpus: string | null | undefined): AiOutputScreen {
  const crisis = detectCrisis(corpus);
  const amf = detectAMFViolation(corpus);

  let reason: AiOutputBlockReason = null;
  if (crisis.level === 'high') {
    reason = 'crisis_high';
  } else if (crisis.level === 'medium') {
    reason = 'crisis_medium';
  } else if (amf.suspected) {
    reason = 'amf';
  }

  return { amf, crisis, blocked: reason !== null, reason };
}
