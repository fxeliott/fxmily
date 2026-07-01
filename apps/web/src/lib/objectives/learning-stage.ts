import { learningStageSchema } from '@/lib/schemas/onboarding-interview';

/**
 * D4 — deterministic derivation of the member's LEARNING STAGE surfaced on
 * `/objectifs`. The stage comes from the onboarding interview deep analysis
 * (`MemberProfile.learningStage`, a Prisma `Json?`), one of the 4 J-A dimensions.
 *
 * Pure (no `server-only`, no DB) so it is unit-testable in isolation — sibling of
 * `coaching-axis.ts`. The DB read (`getProfileForUser`) stays in the server-only
 * `service.ts`.
 *
 * DETERMINISTIC, ZERO AI CALL: we render ONLY the enum-derived French `label` and
 * a FIXED `hint` per stage. We never surface `learningStage.rationale` (raw AI
 * text) to the member, so AI Act §50 needs NO `AIGeneratedBanner` here.
 *
 * FIREWALL §21.5: the stage is DISPLAY-ONLY. It is never fed back into the
 * behavioral score. We read `learningStage` and NOTHING else from the profile —
 * `weakSignals` is admin-only and never crosses the member boundary.
 *
 * POSTURE §2 / Mark Douglas: the stage frames WHERE to anchor the member's
 * process work. Descriptive only, never clinical, never anthropomorphized
 * ("l'IA pense/recommande/decide" banned). French copy, simple punctuation,
 * no em-dash.
 */

/** The three stages, mirrored EXACTLY from `learningStageSchema` enum. */
export type LearningStage = 'mechanical' | 'subjective' | 'intuitive';

export interface DerivedLearningStage {
  stage: LearningStage;
  /** French label (Mécanique / Subjectif / Intuitif), aligned with the admin viewer. */
  label: string;
  /** Fixed, deterministic French action-oriented sentence for this stage. */
  hint: string;
}

/**
 * Enum -> French label. Mirrors `STAGE_LABEL` in the admin viewer so the member
 * and admin surfaces name the stage identically. No em-dash (Eliott's copy rule).
 */
const STAGE_LABEL: Record<LearningStage, string> = {
  mechanical: 'Mécanique',
  subjective: 'Subjectif',
  intuitive: 'Intuitif',
};

/**
 * Enum -> fixed member-facing hint. Deterministic (no AI, no template of raw AI
 * text). Each line orients the member's PROCESS work for that stage, in the Mark
 * Douglas spirit: build the discipline first, then the reading, then the trust in
 * a repeatable process. Descriptive, encouraging, never clinical, never a market
 * call. French, simple punctuation, no em-dash.
 */
const STAGE_HINT: Record<LearningStage, string> = {
  mechanical: 'Ancre tes objectifs sur le respect strict de tes règles.',
  subjective: 'Travaille ta lecture du marché en gardant ton cadre comme garde-fou.',
  intuitive: 'Consolide ta constance pour que ton process reste fiable dans la durée.',
};

/**
 * Coerce the Prisma JSON `learningStage` blob (`unknown`) into a clean, member-
 * safe view. Validates with the SAME `learningStageSchema` used at write time
 * (safeParse never throws on null/garbage) then keeps ONLY the enum-derived
 * `stage`/`label`/`hint` — never `rationale`/`evidence` (raw AI text).
 *
 * Returns `null` when the field is absent or malformed (legacy/partial rows), so
 * the surface degrades to nothing rather than fabricating a stage.
 */
export function deriveLearningStage(raw: unknown): DerivedLearningStage | null {
  const parsed = learningStageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { stage } = parsed.data;
  return {
    stage,
    label: STAGE_LABEL[stage],
    hint: STAGE_HINT[stage],
  };
}
