import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { CaptureContext, HabitKind } from '@/generated/prisma/enums';
import { captureContextSchema } from '@/lib/tracking/schema';

import { habitKindSchema } from './habit-log';

/**
 * Tour 17 — Prisma ↔ Zod enum drift guard.
 *
 * Several `z.enum([...])` literals mirror a Prisma enum by HAND rather than
 * deriving from the generated client (e.g. `habitKindSchema` even documents the
 * informal contract: "mirrors `enum HabitKind` in schema.prisma"). Nothing
 * enforced it: adding a value to the Prisma enum (a new habit kind, a new
 * capture context) without updating the Zod literal makes the API silently
 * REJECT the new value at validation time — a class of bug invisible until a
 * member hits it in prod. This test pins the two reachable (exported) mirrors to
 * the generated Prisma const, in BOTH directions (a value added on either side
 * fails CI). The generated const is the single source of truth:
 *   `src/generated/prisma/enums.ts` — `export const HabitKind = { sleep: 'sleep', … }`.
 *
 * Scope note (honest): the inline, anonymous `z.enum([...])` schemas in
 * weekly-report.ts (session/direction/exitReason) are NOT exported, so they are
 * not guarded here — extracting them is a production refactor deliberately left
 * out of this audit branch. This guard covers the two named/exported mirrors and
 * establishes the pattern to extend.
 */

/** Runtime-read the accepted string values of a `z.enum` schema, tolerant of a
 *  `z.ZodType<…>` annotation that hides `.options` at the type level (the value
 *  is still a ZodEnum at runtime). Sorted for order-independent comparison. */
function zodEnumValues(schema: z.ZodTypeAny): string[] {
  const options = (schema as unknown as { options?: readonly unknown[] }).options;
  if (!Array.isArray(options)) {
    throw new Error('schema is not a z.enum (no runtime .options array)');
  }
  return options.filter((o): o is string => typeof o === 'string').sort();
}

/** Prisma generated enums export a `{ key: 'value' } as const` object. */
function prismaEnumValues(generated: Record<string, string>): string[] {
  return Object.values(generated).sort();
}

describe('Prisma ↔ Zod enum parity', () => {
  it('habitKindSchema stays in lockstep with Prisma HabitKind', () => {
    expect(zodEnumValues(habitKindSchema)).toEqual(prismaEnumValues(HabitKind));
  });

  it('captureContextSchema stays in lockstep with Prisma CaptureContext', () => {
    expect(zodEnumValues(captureContextSchema)).toEqual(prismaEnumValues(CaptureContext));
  });
});
