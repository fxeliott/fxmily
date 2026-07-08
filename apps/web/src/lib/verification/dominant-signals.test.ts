import { describe, expect, it } from 'vitest';

import type { ScoreEventView } from './constancy';
import { pickDominantSignals } from './dominant-signals';

let seq = 0;
function ev(reason: ScoreEventView['reason'], opts: { excused?: boolean } = {}): ScoreEventView {
  const excused = opts.excused ?? false;
  return {
    id: `e${seq++}`,
    delta: reason === 'filled' ? 1 : -1,
    reason,
    excused,
    // `pickDominantSignals` only reads `excused`; keep the reason consistent with it.
    excusedReason: excused ? 'member_reason' : null,
    slot: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
}

describe('pickDominantSignals', () => {
  it('returns nothing on an empty feed', () => {
    expect(pickDominantSignals([])).toEqual([]);
  });

  it('skips excused events (they did not move the score)', () => {
    const signals = pickDominantSignals([
      ev('reality_gap', { excused: true }),
      ev('reality_gap', { excused: true }),
    ]);
    expect(signals).toEqual([]);
  });

  it('ranks by severity × frequency, capped at max (default 3)', () => {
    const signals = pickDominantSignals([
      ev('filled'),
      ev('filled'),
      ev('filled'),
      ev('filled'), // filled ×4 → weight 1×4 = 4
      ev('forgot_no_reason'),
      ev('forgot_no_reason'), // ×2 → weight 2×2 = 4
      ev('reality_gap'), // ×1 → weight 3×1 = 3
      ev('false_declaration'), // ×1 → weight 4×1 = 4
    ]);
    // Four reasons, capped at 3. Three tie at weight 4 — tie-break by count desc
    // (filled 4 > forgot 2 > false 1), false_declaration drops on the cut but
    // reality_gap (weight 3) is below all three so it's the one excluded.
    expect(signals.map((s) => s.reason)).toEqual([
      'filled',
      'forgot_no_reason',
      'false_declaration',
    ]);
  });

  it('carries the right direction per reason', () => {
    const signals = pickDominantSignals([ev('filled'), ev('false_declaration')]);
    const byReason = Object.fromEntries(signals.map((s) => [s.reason, s.direction]));
    expect(byReason.filled).toBe('up');
    expect(byReason.false_declaration).toBe('down');
  });

  it('counts non-excused occurrences per reason', () => {
    const signals = pickDominantSignals([
      ev('reality_gap'),
      ev('reality_gap'),
      ev('reality_gap', { excused: true }), // not counted
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ reason: 'reality_gap', count: 2, direction: 'down' });
  });

  it('honours a custom max', () => {
    const signals = pickDominantSignals(
      [ev('false_declaration'), ev('reality_gap'), ev('forgot_no_reason')],
      2,
    );
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.reason)).toEqual(['false_declaration', 'reality_gap']);
  });
});
