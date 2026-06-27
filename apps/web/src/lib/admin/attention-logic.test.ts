import { describe, expect, it } from 'vitest';

import { CONSTANCY_DECLINE_MIN_DROP, isConstancyDip } from './attention-logic';

/**
 * S7 §33-#2 — threshold semantics for the "constance en baisse" triage signal.
 * A dip is flagged ONLY when the latest constancy snapshot dropped by at least
 * `CONSTANCY_DECLINE_MIN_DROP` vs the previous one — a calm "worth a glance"
 * hint, never a float-wobble false alarm (SPEC §2).
 */
describe('isConstancyDip', () => {
  it('pins the minimum drop at 1 point', () => {
    expect(CONSTANCY_DECLINE_MIN_DROP).toBe(1);
  });

  it('flags a dip when the drop meets the threshold exactly', () => {
    expect(isConstancyDip(71, 72)).toBe(true);
  });

  it('flags a dip for a clear decline', () => {
    expect(isConstancyDip(60, 80)).toBe(true);
  });

  it('does NOT flag a sub-threshold wobble', () => {
    expect(isConstancyDip(71.5, 72)).toBe(false);
  });

  it('does NOT flag a flat score', () => {
    expect(isConstancyDip(72, 72)).toBe(false);
  });

  it('does NOT flag a rising score', () => {
    expect(isConstancyDip(80, 72)).toBe(false);
  });

  it('treats the boundaries 0 and 100 without surprise', () => {
    expect(isConstancyDip(0, 100)).toBe(true);
    expect(isConstancyDip(100, 100)).toBe(false);
  });
});
