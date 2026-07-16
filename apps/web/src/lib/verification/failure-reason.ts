// J4.1 — shared, testable copy for the MT5 proof failure reason.
//
// Intentionally NO `import 'server-only'`: this module is imported by the
// Vitest suite AND by the client-facing /verification UI. It carries only pure
// data + a defensive lookup (the `ProofFailureReason` import is type-only, so it
// erases at compile time and never drags Prisma into a client bundle).

import type { ProofFailureReason } from '@/generated/prisma/enums';

/** Member-facing copy for one refusal reason — calm, « miroir, pas sanction ». */
export interface FailureReasonCopy {
  /** Short headline stating what went wrong, from the member's point of view. */
  readonly label: string;
  /** One concrete next step to reshoot a usable capture. */
  readonly instruction: string;
}

/**
 * Exhaustive map reason → copy. Typed as `Record<ProofFailureReason, …>` so that
 * adding a new enum value fails the build here until its copy is written — the
 * member can never hit an unlabelled refusal.
 */
export const FAILURE_REASON_COPY: Record<ProofFailureReason, FailureReasonCopy> = {
  LOGIN_NOT_FOUND: {
    label: "Ton numéro de compte n'était pas visible",
    instruction: "Reprends la capture en t'assurant que le numéro de compte MT5 est bien visible.",
  },
  NOT_MT5_SCREEN: {
    label: "Ce n'était pas un historique MT5",
    instruction: "Envoie une capture de l'onglet Historique de ton compte MT5.",
  },
  ANALYSIS_UNREADABLE: {
    label: 'La capture était illisible',
    instruction: 'Reprends une capture nette et bien cadrée de ton historique MT5.',
  },
};

/**
 * Resolve the calm member-facing copy for a stored failure reason.
 *
 * Returns `null` when the reason is absent (pending/done proofs, and pre-J4.1
 * rows whose `failureReason` column is NULL) — the caller then falls back to the
 * existing generic label. Defensive read of the older rows by design.
 */
export function describeFailureReason(
  reason: ProofFailureReason | null | undefined,
): FailureReasonCopy | null {
  if (reason == null) return null;
  return FAILURE_REASON_COPY[reason];
}
