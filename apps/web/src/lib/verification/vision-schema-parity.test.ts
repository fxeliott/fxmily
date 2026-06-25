import { describe, expect, it } from 'vitest';

import {
  VISION_MAX_POSITIONS_PER_PROOF,
  verificationVisionOutputSchema,
} from '@/lib/schemas/verification';

import { VERIFICATION_VISION_OUTPUT_JSON_SCHEMA } from './prompt';

/**
 * S3 §33.4 — anti-drift guard for the TWO parallel declarations of the vision
 * output shape (the comment at `prompt.ts` literally calls the JSON Schema a
 * "Mirror of `verificationVisionOutputSchema`") :
 *   - `VERIFICATION_VISION_OUTPUT_JSON_SCHEMA` (prompt.ts) travels on the wire
 *     to the local Claude orchestrator — it tells the model what to emit.
 *   - `verificationVisionOutputSchema` (schemas/verification.ts, Zod) validates
 *     what comes back (`batch.ts`), `.strict()` everywhere.
 *
 * Both carry `additionalProperties:false` / `.strict()`, so a field added to ONE
 * side only is a SILENT prod break: the model legitimately emits a field the
 * JSON Schema allows, then Zod's `.strict()` rejects the whole extraction — with
 * no compile error and no other test catching it. This locks the FIELD SETS
 * (names + required-ness + the positions cap) in lock-step.
 *
 * Deliberately NOT asserted: value constraints (`login` regex, `volume` max,
 * string lengths) — those diverge ON PURPOSE (Zod is the stricter server-side
 * hardening of the looser wire contract). Only shape parity is the invariant.
 */

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

const J = VERIFICATION_VISION_OUTPUT_JSON_SCHEMA;
// Zod array element typing isn't surfaced uniformly across versions — read the
// inner object's `shape` through a narrow cast (the runtime shape is stable).
const positionElementShape = (
  verificationVisionOutputSchema.shape.positions as unknown as {
    element: { shape: Record<string, unknown> };
  }
).element.shape;

describe('vision output schema — JSON Schema (wire) ↔ Zod (server) field parity', () => {
  it('top level: same property names, all required', () => {
    const jsonProps = sorted(Object.keys(J.properties));
    const zodKeys = sorted(Object.keys(verificationVisionOutputSchema.shape));
    expect(zodKeys).toEqual(jsonProps);
    // Every declared field is required on the wire (nullability ≠ optionality).
    expect(sorted(J.required)).toEqual(jsonProps);
  });

  it('account: same property names, all required', () => {
    const jsonProps = sorted(Object.keys(J.properties.account.properties));
    const zodKeys = sorted(Object.keys(verificationVisionOutputSchema.shape.account.shape));
    expect(zodKeys).toEqual(jsonProps);
    expect(sorted(J.properties.account.required)).toEqual(jsonProps);
  });

  it('positions[] item: same property names, all required', () => {
    const jsonProps = sorted(Object.keys(J.properties.positions.items.properties));
    const zodKeys = sorted(Object.keys(positionElementShape));
    expect(zodKeys).toEqual(jsonProps);
    expect(sorted(J.properties.positions.items.required)).toEqual(jsonProps);
  });

  it('positions cap is one number, declared the same on both sides', () => {
    expect(J.properties.positions.maxItems).toBe(VISION_MAX_POSITIONS_PER_PROOF);
  });

  it('strictness is declared at every level on the wire (the Zod `.strict()` mirror)', () => {
    expect(J.additionalProperties).toBe(false);
    expect(J.properties.account.additionalProperties).toBe(false);
    expect(J.properties.positions.items.additionalProperties).toBe(false);
  });
});
