/**
 * Backtest review status — S8 V2 enrichment §33-3 (« statut de revue »).
 *
 * Pure derivation: a backtest's review state is computed at render from its
 * corrections, NEVER persisted (no migration, no drift — the corrections + the
 * member's `seenByMemberAt` stamps are the single source of truth). Mirrors the
 * existing real-trade "review status" reasoning but stays on the training
 * surface (STATISTICAL ISOLATION §21.5: derived only from `TrainingAnnotation`
 * rows, no P&L, no real edge).
 *
 *   pending   — no correction yet (the member is awaiting Eliott's review).
 *   corrected — at least one correction, NOT all seen by the member (something
 *               new to read).
 *   seen      — at least one correction and every one has a `seenByMemberAt`.
 *
 * The status moves `pending → corrected` when Eliott adds a correction, then
 * `corrected → seen` once the member opens the backtest (which stamps
 * `seenByMemberAt` on every unread correction, see
 * `markTrainingAnnotationsSeenForTrainingTrade`).
 *
 * No framework / `server-only` import on purpose: the helper runs in Server
 * Components, the member list, and the unit + guardrail tests alike. Every
 * member-visible `label` / `description` here is fed through `detectAMFViolation`
 * by `review-status.test.ts` to prove the copy stays in the psychology/process
 * register (garde-fou §2) — never a market judgement.
 */

export type TrainingReviewStatus = 'pending' | 'corrected' | 'seen';

/** The minimal annotation shape the derivation needs (decoupled from the full
 * `SerializedTrainingAnnotation` so the helper stays trivially testable). */
export interface ReviewStatusAnnotationLike {
  seenByMemberAt: string | null;
}

/**
 * Derive a backtest's review status from its corrections. Order-independent and
 * total: an empty list is `pending`, otherwise `seen` iff every correction has
 * been seen, else `corrected`.
 */
export function deriveTrainingReviewStatus(
  annotations: ReadonlyArray<ReviewStatusAnnotationLike>,
): TrainingReviewStatus {
  if (annotations.length === 0) return 'pending';
  const allSeen = annotations.every((a) => a.seenByMemberAt !== null);
  return allSeen ? 'seen' : 'corrected';
}

/** Pill tone hint (maps 1:1 to `<Pill tone>` in the DS-v3 component). `cy` is
 * the training identity colour, `ok` confirms a closed loop, `mute` is the
 * neutral waiting state — never `warn`/`bad` (a pending review is not a fault). */
export type TrainingReviewTone = 'mute' | 'cy' | 'ok';

export interface TrainingReviewStatusMeta {
  label: string;
  /** One-line member-facing explanation (AMF-safe, process register). */
  description: string;
  tone: TrainingReviewTone;
}

/** Single source of truth for the member-facing presentation of each status. */
export const TRAINING_REVIEW_STATUS_META: Record<TrainingReviewStatus, TrainingReviewStatusMeta> = {
  pending: {
    label: 'En attente de correction',
    description: 'Eliott n’a pas encore laissé de correction sur ce backtest.',
    tone: 'mute',
  },
  corrected: {
    label: 'Correction à lire',
    description: 'Une correction t’attend — ouvre le backtest pour la découvrir.',
    tone: 'cy',
  },
  seen: {
    label: 'Correction vue',
    description: 'Tu as pris connaissance de la correction.',
    tone: 'ok',
  },
};
