/**
 * J-E — ADMIN-ONLY monthly re-profiling safety gate.
 *
 * The onboarding `runSafetyGate` cannot be reused verbatim: it composes its
 * AMF/anti-clinical scan corpus from `output.summary` / `output.highlights` /
 * `output.axes_prioritaires`, none of which the monthly output carries
 * (evolution_narrative + the 4 deep dimensions). So this module mirrors the
 * onboarding gate for the monthly output shape while REUSING the two hard,
 * FP-tuned detectors verbatim (single source of truth for AMF + anti-clinical)
 * and re-implementing only the trivial evidence-substring loop.
 *
 * The evidence source of truth is the month's REFLECTION corpus
 * (`concatReflectionCorpus`, `snapshot.ts`) — the member's own free-text words.
 * The onboarding baseline / previous-month narrative are reference context and
 * are NEVER a citable source, so an evidence[] that quotes them is (correctly)
 * rejected: a re-profiled dimension must be grounded in THIS month's material.
 *
 * 🚨 The evolution narrative carries NO evidence[] (free prose), but it IS
 * scanned for AMF / clinical wording — any new output text field MUST be added
 * to {@link composeMonthlyOutputCorpus}, else a violation there would go unseen.
 */

import type { MemberProfileMonthlySnapshotOutput } from '@/lib/schemas/member-profile-monthly-snapshot';
// SINGLE source of truth for the two FP-tuned detectors (AMF re-exported from
// `@/lib/safety/amf-detection`, anti-clinical patterns). Reused verbatim.
import { detectAMFViolation, detectClinicalLanguage } from '@/lib/onboarding-interview/safety';

/**
 * Compose the full text corpus from a monthly output for AMF + anti-clinical
 * scanning: the narrative + every dim's rationale/axis/signal + all evidence.
 * Mirror onboarding `composeOutputCorpus`. Joined by newline. EXPORTED as the
 * single "every text the model produced" source — any new field goes here.
 */
export function composeMonthlyOutputCorpus(output: MemberProfileMonthlySnapshotOutput): string {
  const parts: string[] = [output.evolution_narrative];
  if (output.coaching_tone) {
    parts.push(output.coaching_tone.rationale, ...output.coaching_tone.evidence);
  }
  if (output.learning_stage) {
    parts.push(output.learning_stage.rationale, ...output.learning_stage.evidence);
  }
  if (output.axes_structured) {
    for (const a of output.axes_structured) {
      parts.push(a.axis, ...a.evidence);
    }
  }
  if (output.weak_signals) {
    for (const s of output.weak_signals) {
      parts.push(s.signal, ...s.evidence);
    }
  }
  return parts.join('\n');
}

export interface MonthlyDimensionEvidenceResult {
  readonly allValid: boolean;
  /// Paths of dims whose evidence is fabricated (e.g. `axes_structured[2]`).
  readonly invalidPaths: readonly string[];
}

/**
 * Validate that EVERY re-profiled dimension `evidence[i]` is a verbatim NFC
 * substring of the month's reflection corpus (mirror onboarding
 * `validateDimensionEvidence`, but against the monthly source corpus rather
 * than a snapshot's answerTexts). A fabricated citation in ANY dim rejects the
 * whole snapshot at persist.
 */
export function validateMonthlyDimensionEvidence(
  output: MemberProfileMonthlySnapshotOutput,
  sourceCorpus: string,
): MonthlyDimensionEvidenceResult {
  const corpus = sourceCorpus.normalize('NFC');
  const invalidPaths: string[] = [];
  const check = (evidence: readonly string[], path: string): void => {
    const hasInvalid = evidence.some((e) => !corpus.includes(e.normalize('NFC')));
    if (hasInvalid) invalidPaths.push(path);
  };

  if (output.coaching_tone) check(output.coaching_tone.evidence, 'coaching_tone');
  if (output.learning_stage) check(output.learning_stage.evidence, 'learning_stage');
  if (output.axes_structured) {
    output.axes_structured.forEach((a, i) => check(a.evidence, `axes_structured[${i}]`));
  }
  if (output.weak_signals) {
    output.weak_signals.forEach((s, i) => check(s.evidence, `weak_signals[${i}]`));
  }

  return { allValid: invalidPaths.length === 0, invalidPaths };
}

export interface MonthlySafetyGateInput {
  readonly output: MemberProfileMonthlySnapshotOutput;
  /// The month's reflection corpus (`concatReflectionCorpus`) — the ONLY
  /// citable evidence source.
  readonly sourceCorpus: string;
}

export type MonthlySafetyGateResult =
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
      readonly invalidDimensionPaths: readonly string[];
    };

/**
 * Composite monthly safety gate — AMF, then anti-clinical, then evidence
 * grounding, fail-fast (short-circuit on first failure). Used by the persist
 * path BEFORE the Prisma upsert. On `reject` the batch increments `skipped`
 * (content-policy reject, not a technical error), emits the matching audit
 * slug, and (for `amf_violation`) a security warning.
 */
export function runMonthlyReprofileSafetyGate(
  input: MonthlySafetyGateInput,
): MonthlySafetyGateResult {
  const corpus = composeMonthlyOutputCorpus(input.output);

  const amf = detectAMFViolation(corpus);
  if (amf.suspected) {
    return { status: 'reject', reason: 'amf_violation', matchedLabels: amf.matchedLabels };
  }

  const clinical = detectClinicalLanguage(corpus);
  if (clinical.suspected) {
    return {
      status: 'reject',
      reason: 'clinical_language',
      matchedLabels: clinical.matchedLabels,
    };
  }

  const dimEvidence = validateMonthlyDimensionEvidence(input.output, input.sourceCorpus);
  if (!dimEvidence.allValid) {
    return {
      status: 'reject',
      reason: 'evidence_invalid',
      invalidDimensionPaths: dimEvidence.invalidPaths,
    };
  }

  return { status: 'pass' };
}
