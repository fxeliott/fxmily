import { z } from 'zod';

/**
 * S5 §32-E3 — Zod boundary for the mental micro-objective engagement loop.
 *
 * The member closes one open loop with a single outcome ("l'as-tu tenu ?"). The
 * outcome set MIRRORS `MentalObjectiveStatus` minus `open` (a close transitions
 * AWAY from open). Kept deliberately tiny + `.strict()` — no free text reaches
 * this surface (the copy is curated server-side, posture §2/§33.2), so there is
 * nothing to sanitize here.
 *
 * Lives in a server-only-FREE module so the client island
 * (`close-micro-objective.tsx`) can import the outcome list + type without
 * pulling the `server-only` guard of `lib/coaching/micro-objective.ts`.
 */

/** How the member closes a mental micro-objective loop (suivi au prochain passage). */
export const MICRO_OBJECTIVE_OUTCOMES = ['kept', 'missed', 'dismissed'] as const;
export type MicroObjectiveOutcomeInput = (typeof MICRO_OBJECTIVE_OUTCOMES)[number];

/** cuid()-shaped id + a closed-outcome enum. `.strict()` rejects any extra field. */
export const closeMicroObjectiveSchema = z
  .object({
    microObjectiveId: z.string().regex(/^[a-z0-9]{8,40}$/),
    outcome: z.enum(MICRO_OBJECTIVE_OUTCOMES),
  })
  .strict();

export type CloseMicroObjectiveInput = z.infer<typeof closeMicroObjectiveSchema>;
