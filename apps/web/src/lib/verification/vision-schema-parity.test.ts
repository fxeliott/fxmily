import { describe, expect, it } from 'vitest';

import {
  VISION_MAX_POSITIONS_PER_PROOF,
  verificationBatchResultEntrySchema,
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
  it('top level: same property names, required-ness consistent (wire required ⟺ Zod non-optional)', () => {
    const jsonProps = sorted(Object.keys(J.properties));
    const shape = verificationVisionOutputSchema.shape as Record<
      string,
      { isOptional: () => boolean }
    >;
    const zodKeys = sorted(Object.keys(shape));
    // Field SETS match (names): a field on ONE side only is a silent prod break.
    expect(zodKeys).toEqual(jsonProps);
    // Required-ness is CONSISTENT across the two declarations. Tour 18 introduced
    // the FIRST legitimately-optional field (`screenObservation`): a missing note
    // must never fail an otherwise-clean extraction, so it is Zod-optional AND
    // kept out of the wire `required` list. The invariant is therefore no longer
    // "everything is required" but "wire-required ⟺ Zod-non-optional", which still
    // catches the real drift (an optional field on one side, required on the other).
    const zodRequired = sorted(zodKeys.filter((k) => !shape[k]!.isOptional()));
    expect(sorted(J.required)).toEqual(zodRequired);
    // Pin the intent explicitly so a future edit can't silently flip it.
    expect(shape.screenObservation!.isOptional()).toBe(true);
    expect(J.required).not.toContain('screenObservation');
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

/**
 * Tour 18 — "le voir et le dire" : the model must state the screen it saw.
 * `screenObservation` on the success shape + `observed` on the non-MT5 refusal.
 * Both OPTIONAL so the field can never fail an otherwise-valid entry.
 */
describe('vision output — Tour 18 screen-observation fields', () => {
  const validAccount = {
    login: '520012345',
    broker: null,
    currency: null,
    label: null,
    accountTypeGuess: null,
  };

  it('accepts a success output WITH screenObservation', () => {
    const parsed = verificationVisionOutputSchema.safeParse({
      account: validAccount,
      positions: [],
      confidence: 0.9,
      screenObservation: 'Historique de positions MT5, terminal desktop, compte 520012345.',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.screenObservation).toContain('MT5');
  });

  it('still accepts a success output WITHOUT screenObservation (backward-compatible)', () => {
    const parsed = verificationVisionOutputSchema.safeParse({
      account: validAccount,
      positions: [],
      confidence: 0.9,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.screenObservation).toBeUndefined();
  });

  it('rejects a screenObservation over 300 chars (bounded free text)', () => {
    const parsed = verificationVisionOutputSchema.safeParse({
      account: validAccount,
      positions: [],
      confidence: 0.9,
      screenObservation: 'x'.repeat(301),
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a not_mt5_history entry carrying an `observed` note', () => {
    const parsed = verificationBatchResultEntrySchema.safeParse({
      proofId: 'abcd1234',
      userId: 'user_1',
      error: 'not_mt5_history',
      observed: 'Graphique TradingView EUR/USD, pas un historique de positions.',
    });
    expect(parsed.success).toBe(true);
  });

  it('still accepts a bare error entry without `observed` (backward-compatible)', () => {
    const parsed = verificationBatchResultEntrySchema.safeParse({
      proofId: 'abcd1234',
      userId: 'user_1',
      error: 'not_mt5_history',
    });
    expect(parsed.success).toBe(true);
  });
});
