import { describe, expect, it } from 'vitest';

import { FAILURE_REASON_COPY, describeFailureReason } from './failure-reason';

/**
 * J4.6 — unit tests for `describeFailureReason`, the calm member-facing copy
 * lookup behind the J4.2 « miroir, pas sanction » failure block on /verification.
 */
const REASONS = ['LOGIN_NOT_FOUND', 'NOT_MT5_SCREEN', 'ANALYSIS_UNREADABLE'] as const;

describe('describeFailureReason', () => {
  it.each(REASONS)('returns a non-empty label + instruction for %s', (reason) => {
    const copy = describeFailureReason(reason);

    expect(copy).not.toBeNull();
    expect(copy?.label.trim().length).toBeGreaterThan(0);
    expect(copy?.instruction.trim().length).toBeGreaterThan(0);
    // The lookup is a pure reference read (no clone), so callers get referential
    // stability against the source map.
    expect(copy).toBe(FAILURE_REASON_COPY[reason]);
  });

  it('returns null for a null reason (pending / done / pre-J4.1 rows)', () => {
    expect(describeFailureReason(null)).toBeNull();
  });

  it('returns null for an undefined reason', () => {
    expect(describeFailureReason(undefined)).toBeNull();
  });
});
