import { describe, expect, it } from 'vitest';

import type { AuditAction } from './audit';

/**
 * V1.8 PR3 — audit slug forward-compatibility sanity.
 *
 * The `AuditAction` union is the canonical taxonomy for audit rows
 * (`audit_logs.action` TEXT, validated at the Zod boundary in
 * `logAudit`). When a V1.8+ Server Action references a slug that
 * never lands in the union, TypeScript fails — but ONLY if that exact
 * call site stays compiled. This test pins the V1.8 slugs as a
 * compile-time anchor: removing one of them from the union breaks
 * this file's type-check, surfacing the regression before runtime.
 *
 * The 4 slugs were acted in `docs/jalon-V1.8-decisions.md` (Q4=A
 * dup of V1.7.1 batch wire + parity for ReflectionEntry submit /
 * crisis). Adding more slugs is fine; removing any of these requires
 * editing this file deliberately.
 */

const V1_8_REQUIRED_SLUGS = [
  'weekly_review.submitted',
  'weekly_review.crisis_detected',
  'reflection.submitted',
  'reflection.crisis_detected',
] as const satisfies ReadonlyArray<AuditAction>;

describe('V1.8 audit slug union membership', () => {
  it('every required V1.8 slug is structurally assignable to AuditAction', () => {
    // The `satisfies` clause above is the actual proof. The runtime
    // assertion below is a smoke check + a stable test count anchor.
    for (const slug of V1_8_REQUIRED_SLUGS) {
      expect(typeof slug).toBe('string');
      expect(slug).toMatch(/^[a-z_]+\.[a-z_]+(?:\.[a-z_]+)?$/);
    }
    expect(V1_8_REQUIRED_SLUGS).toHaveLength(4);
  });
});
