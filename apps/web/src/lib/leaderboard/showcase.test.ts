import { describe, expect, it } from 'vitest';

import { LEADERBOARD_EXCLUDED_EMAILS } from './showcase';

describe('LEADERBOARD_EXCLUDED_EMAILS', () => {
  it('excludes the public demo account from the leaderboard', () => {
    // The demo (`demo@fxmily.local`) is a shared vitrine, not a real member —
    // it must never be gathered into a snapshot nor shown on the board.
    expect(LEADERBOARD_EXCLUDED_EMAILS).toContain('demo@fxmily.local');
  });

  it('is a non-empty list of lowercase, plausible emails', () => {
    // Matched case-sensitively against the seeded (lowercase) user email, so the
    // list must stay lowercase or the exclusion silently misses.
    expect(LEADERBOARD_EXCLUDED_EMAILS.length).toBeGreaterThan(0);
    for (const email of LEADERBOARD_EXCLUDED_EMAILS) {
      expect(email).toBe(email.toLowerCase());
      expect(email).toContain('@');
    }
  });

  it('holds no duplicates', () => {
    expect(new Set(LEADERBOARD_EXCLUDED_EMAILS).size).toBe(LEADERBOARD_EXCLUDED_EMAILS.length);
  });
});
