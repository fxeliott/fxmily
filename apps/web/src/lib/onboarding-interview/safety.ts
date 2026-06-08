/**
 * V2.5 — Onboarding interview safety filters (Session β Phase A.2 — 3 couches
 * anti-hallucination Claude §J Anthropic profilage).
 *
 * Pure module — no DB, no env, no `server-only` — consumed by both the batch
 * persist gate (`batch.ts`) and unit tests. Pattern carbone V1.7.1
 * `lib/safety/crisis-detection.ts` regex unicode-aware + V1.8 REFLECT
 * `lib/ai/injection-detector.ts` pure-detection-helpers.
 *
 * 3 couches anti-hallucination Phase A.2 :
 *   1. **SDK structured-output JSON Schema** (`additionalProperties: false`
 *      via `prompt.ts` `MEMBER_PROFILE_OUTPUT_JSON_SCHEMA`)
 *   2. **Zod `.strict()` post-parse** (`schemas/onboarding-interview.ts`
 *      `memberProfileOutputSchema.parse` in `claude-client.ts`)
 *   3. **This file's runtime validators** (AMF regex + evidence substring
 *      NFC + anti-clinical wording detection)
 *
 * Posture invariants (SPEC §2 + §J) :
 *   - AMF / CIF — pas de recommandation marché individualisée
 *     (`LONG/SHORT/BUY/SELL/achetez/vendez/strike/TP/stop-loss à X`)
 *   - Anti-clinical — pas de diagnostic clinique
 *     (`dépression/anxiété généralisée/trouble/pathologie/diagnostic`)
 *   - Evidence-grounded — chaque `highlight.evidence[i]` est verbatim
 *     substring NFC-normalisé du corpus answerTexts
 *
 * AMF DETECTION — single source of truth:
 *   `detectAMFViolation` and `AMF_VIOLATION_PATTERNS` are re-exported from
 *   `@/lib/safety/amf-detection` (the context-anchored, FP-hardened canonical
 *   detector, Session 4). The naive duplicate patterns that lived here until
 *   v2.4 have been removed to prevent false positives on legitimate coaching
 *   text such as "raisonne sur le long terme" or "a vendu trop tôt".
 */

import type {
  MemberProfileOutput,
  OnboardingInterviewSnapshot,
} from '@/lib/schemas/onboarding-interview';
import { detectAMFViolation, AMF_VIOLATION_PATTERNS } from '@/lib/safety/amf-detection';

// =============================================================================
// AMF regex post-gen filter (couche 2 anti-hallu §J)
// Single source of truth — canonical, context-anchored, FP-hardened detector.
// =============================================================================

export { detectAMFViolation, AMF_VIOLATION_PATTERNS };
export type { AMFViolationResult } from '@/lib/safety/amf-detection';

// =============================================================================
// Anti-clinical wording detection (posture §J Anthropic)
// =============================================================================

/**
 * Anti-clinical patterns — Claude doit JAMAIS générer de diagnostic
 * psychiatrique dans summary/highlights/axes. Le profile est
 * descriptif-comportemental, pas clinique (posture §J).
 *
 * Mots bannis canoniques (unicode-aware) :
 *   - `dépression` (mais autoriser "dépression du marché" = financial slang)
 *   - `anxiété généralisée` (mais autoriser "anxiété" simple en contexte
 *     athlétique — paraphraser en "périodes de doute")
 *   - `trouble` (ex `trouble psychotique`, `trouble bipolaire`)
 *   - `pathologie`
 *   - `diagnostic`
 *
 * Carbone exclusions style V1.7.1 `crisis-detection.ts:78-136` : exclure les
 * patterns trading slang où le mot apparaît légitimement (`dépression du
 * marché`).
 */
export const ANTI_CLINICAL_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly regex: RegExp;
  readonly excludeContexts?: readonly RegExp[];
}> = [
  {
    label: 'depression_psychiatric',
    regex: /\bdépression\b/i,
    excludeContexts: [/dépression\s+du\s+marché/i],
  },
  {
    label: 'anxiety_clinical',
    regex: /\banxiété\s+généralisée\b/i,
  },
  {
    label: 'trouble_clinical',
    regex:
      /\b(?:trouble|troubles)\s+(?:psychotique|bipolaire|anxieux|dépressif|de\s+la\s+personnalité|obsessionnel|compulsif|TOC|TDAH|panique)\b/i,
  },
  {
    label: 'pathology',
    regex: /\bpathologie\b/i,
  },
  {
    label: 'diagnosis',
    regex: /\bdiagnostic\b/i,
  },
];

export interface AntiClinicalResult {
  readonly suspected: boolean;
  readonly matchedLabels: readonly string[];
}

/**
 * Scan a corpus for anti-clinical wording violations. Carbone exclusions
 * style V1.7.1 — exclure les patterns trading slang où le mot apparaît
 * légitimement (ex `dépression du marché` ≠ diagnostic psychiatrique).
 */
export function detectClinicalLanguage(text: string): AntiClinicalResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { suspected: false, matchedLabels: [] };
  }
  const normalized = text.normalize('NFC');
  const matchedLabels: string[] = [];
  for (const { label, regex, excludeContexts } of ANTI_CLINICAL_PATTERNS) {
    if (regex.test(normalized)) {
      // Check exclusion contexts (e.g. "dépression du marché" = financial slang)
      const isExcluded = excludeContexts?.some((excl) => excl.test(normalized)) ?? false;
      if (!isExcluded) {
        matchedLabels.push(label);
      }
    }
  }
  return {
    suspected: matchedLabels.length > 0,
    matchedLabels,
  };
}

// =============================================================================
// Evidence substring NFC validation (couche 3 anti-hallu §J)
// =============================================================================

/**
 * Concatenate all answerTexts of a snapshot into a single corpus for
 * evidence substring validation. NFC-normalized, separated by newlines
 * (preserves question boundaries for human inspection if needed but doesn't
 * affect substring match since evidence won't contain newlines typically).
 */
export function concatAnswerTextsForValidation(snapshot: OnboardingInterviewSnapshot): string {
  return snapshot.answers
    .map((a) => a.answerText)
    .join('\n')
    .normalize('NFC');
}

export interface EvidenceValidationResult {
  readonly allValid: boolean;
  /** Indexes of invalid highlights (0-based in MemberProfileOutput.highlights array). */
  readonly invalidHighlightIndexes: readonly number[];
}

/**
 * Validate that EVERY `highlight.evidence[i]` is a verbatim substring of the
 * concatenated answer corpus (NFC-normalized). The 3rd couche anti-hallu
 * §J : Anthropic structured-output garantit la structure, Zod garantit le
 * shape, mais SEULE cette validation garantit que Claude n'a pas inventé
 * une citation plausible mais fausse (paper 2026 : "the retrieved chunks
 * contained the correct, citable source, but the model ignored it and
 * fabricated a more impressive-sounding alternative").
 *
 * Returns the indexes of failing highlights (for audit + retry decision).
 * If ANY highlight has an invalid evidence, the batch REJECTS the profile +
 * audit `onboarding.batch.evidence_invalid` + Sentry warning.
 */
export function validateEvidenceSubstrings(
  output: MemberProfileOutput,
  snapshot: OnboardingInterviewSnapshot,
): EvidenceValidationResult {
  const corpus = concatAnswerTextsForValidation(snapshot);
  const invalidHighlightIndexes: number[] = [];

  output.highlights.forEach((highlight, highlightIdx) => {
    const hasInvalidEvidence = highlight.evidence.some((evidence) => {
      const normalized = evidence.normalize('NFC');
      return !corpus.includes(normalized);
    });
    if (hasInvalidEvidence) {
      invalidHighlightIndexes.push(highlightIdx);
    }
  });

  return {
    allValid: invalidHighlightIndexes.length === 0,
    invalidHighlightIndexes,
  };
}

/**
 * Validate a single evidence string against a snapshot's answer corpus.
 * Unit-test friendly wrapper (the array validator above is the prod path).
 */
export function isEvidenceVerbatimSubstring(
  evidence: string,
  snapshot: OnboardingInterviewSnapshot,
): boolean {
  if (typeof evidence !== 'string' || evidence.length === 0) return false;
  const corpus = concatAnswerTextsForValidation(snapshot);
  return corpus.includes(evidence.normalize('NFC'));
}

// =============================================================================
// Composite gate — combines all 3 couches for batch persist decision
// =============================================================================

export interface SafetyGateInput {
  readonly output: MemberProfileOutput;
  readonly snapshot: OnboardingInterviewSnapshot;
}

export type SafetyGateResult =
  | { readonly status: 'pass' }
  | {
      readonly status: 'reject';
      readonly reason: 'amf_violation';
      readonly matchedLabels: readonly string[];
    }
  | {
      readonly status: 'reject';
      readonly reason: 'clinical_language';
      readonly matchedLabels: readonly string[];
    }
  | {
      readonly status: 'reject';
      readonly reason: 'evidence_invalid';
      readonly invalidHighlightIndexes: readonly number[];
    };

/**
 * Composite safety gate — runs all 3 anti-hallu layers + anti-clinical
 * detection in order. Short-circuits on first failure (fail-fast).
 *
 * Used by `batch.ts:persistGeneratedProfiles` BEFORE the Prisma upsert.
 * If `status === 'reject'`, the batch :
 *   - increments `skipped` (NOT `errors` — it's a content-policy reject,
 *     not a technical failure)
 *   - emits the appropriate audit slug (`amf_violation` / `evidence_invalid`)
 *   - Sentry `reportWarning` for `amf_violation` (security signal)
 *   - logs the matched labels (PII-free, audit-safe)
 *
 * NOTE : Crisis detection is NOT in this gate — it lives separately in
 * `batch.ts` via `detectCrisis(corpus)` mirror V1.7.1 (which can also fire
 * MEDIUM-level which is informational not rejection). Anti-clinical is a
 * hard reject because it violates posture §J.
 */
export function runSafetyGate(input: SafetyGateInput): SafetyGateResult {
  const corpus = composeOutputCorpus(input.output);

  // Layer 1 — AMF / CIF directional recommendation reject
  const amf = detectAMFViolation(corpus);
  if (amf.suspected) {
    return {
      status: 'reject',
      reason: 'amf_violation',
      matchedLabels: amf.matchedLabels,
    };
  }

  // Layer 2 — Anti-clinical wording reject
  const clinical = detectClinicalLanguage(corpus);
  if (clinical.suspected) {
    return {
      status: 'reject',
      reason: 'clinical_language',
      matchedLabels: clinical.matchedLabels,
    };
  }

  // Layer 3 — Evidence substring NFC validation
  const evidence = validateEvidenceSubstrings(input.output, input.snapshot);
  if (!evidence.allValid) {
    return {
      status: 'reject',
      reason: 'evidence_invalid',
      invalidHighlightIndexes: evidence.invalidHighlightIndexes,
    };
  }

  return { status: 'pass' };
}

/**
 * Compose the full text corpus from a MemberProfileOutput for AMF +
 * anti-clinical scanning. Concatenates summary + ALL highlights (labels +
 * evidence) + ALL axes. Joined by newline.
 */
function composeOutputCorpus(output: MemberProfileOutput): string {
  const parts: string[] = [output.summary];
  for (const highlight of output.highlights) {
    parts.push(highlight.label);
    for (const evidence of highlight.evidence) {
      parts.push(evidence);
    }
  }
  for (const axis of output.axes_prioritaires) {
    parts.push(axis);
  }
  return parts.join('\n');
}
