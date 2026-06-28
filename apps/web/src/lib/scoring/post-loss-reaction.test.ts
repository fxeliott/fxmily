import { describe, expect, it } from 'vitest';

import { computePostLossReaction, type ReactionTrade } from './post-loss-reaction';

/**
 * S25 — pure intraday post-loss reaction. Paris hours (CEST = UTC+2 in June):
 * 11:00Z = 13:00 Paris, 12:00Z = 14:00 Paris. "Same day" is the Europe/Paris
 * civil day; a re-entry must be strictly AFTER the loss closed, same Paris day.
 */

function trade(
  enteredAtISO: string,
  closedAtISO: string | null,
  outcome: ReactionTrade['outcome'],
): ReactionTrade {
  return {
    enteredAt: new Date(enteredAtISO),
    closedAt: closedAtISO === null ? null : new Date(closedAtISO),
    outcome,
  };
}

describe('computePostLossReaction', () => {
  it('flags !hasEnough below 3 closed losses', () => {
    const r = computePostLossReaction(
      [
        trade('2026-06-10T11:00:00Z', '2026-06-10T12:00:00Z', 'loss'),
        trade('2026-06-11T11:00:00Z', '2026-06-11T12:00:00Z', 'loss'),
      ],
      90,
    );
    expect(r.hasEnough).toBe(false);
    expect(r.losses).toBe(2);
  });

  it('counts a same-Paris-day re-entry after a loss, with its delay', () => {
    const r = computePostLossReaction(
      [
        // loss1 closed 14:00 Paris, re-entry 14:20 Paris → 20 min (fast)
        trade('2026-06-10T11:00:00Z', '2026-06-10T12:00:00Z', 'loss'),
        trade('2026-06-10T12:20:00Z', '2026-06-10T13:00:00Z', 'win'),
        // loss2 — no re-entry same day
        trade('2026-06-11T11:00:00Z', '2026-06-11T12:00:00Z', 'loss'),
        // loss3 closed 14:00 Paris, re-entry 15:00 Paris → 60 min (not fast)
        trade('2026-06-12T11:00:00Z', '2026-06-12T12:00:00Z', 'loss'),
        trade('2026-06-12T13:00:00Z', '2026-06-12T14:00:00Z', 'break_even'),
      ],
      90,
    );
    expect(r.hasEnough).toBe(true);
    expect(r.losses).toBe(3);
    expect(r.reentries).toBe(2);
    expect(r.fastReentries).toBe(1);
    expect(r.medianDelayMin).toBe(40); // median([20, 60])
  });

  it('does NOT count a re-entry on the NEXT Paris day', () => {
    const r = computePostLossReaction(
      [
        trade('2026-06-10T11:00:00Z', '2026-06-10T12:00:00Z', 'loss'),
        // entered the next civil day → not a same-day re-entry
        trade('2026-06-11T06:00:00Z', '2026-06-11T08:00:00Z', 'win'),
        trade('2026-06-13T11:00:00Z', '2026-06-13T12:00:00Z', 'loss'),
        trade('2026-06-15T11:00:00Z', '2026-06-15T12:00:00Z', 'loss'),
      ],
      90,
    );
    expect(r.losses).toBe(3);
    expect(r.reentries).toBe(0);
    expect(r.medianDelayMin).toBeNull();
  });

  it('ignores entries placed BEFORE the loss closed (same day)', () => {
    const r = computePostLossReaction(
      [
        // a trade opened at 10:00 same day but closed earlier — not "after the loss"
        trade('2026-06-10T08:00:00Z', '2026-06-10T09:00:00Z', 'win'),
        trade('2026-06-10T11:00:00Z', '2026-06-10T12:00:00Z', 'loss'),
        trade('2026-06-11T11:00:00Z', '2026-06-11T12:00:00Z', 'loss'),
        trade('2026-06-12T11:00:00Z', '2026-06-12T12:00:00Z', 'loss'),
      ],
      90,
    );
    expect(r.losses).toBe(3);
    expect(r.reentries).toBe(0);
  });

  it('de-dups a SINGLE re-entry shared by two same-day losses (no double count)', () => {
    // Two losses the SAME Paris day (closed 12:00Z=14:00 and 12:30Z=14:30) and
    // ONE subsequent entry at 13:00Z (15:00 Paris). The physical re-entry is
    // ONE trade → it must be attributed to ONE loss only, not counted twice.
    const r = computePostLossReaction(
      [
        trade('2026-06-10T11:00:00Z', '2026-06-10T12:00:00Z', 'loss'), // loss A, closes 14:00
        trade('2026-06-10T11:15:00Z', '2026-06-10T12:30:00Z', 'loss'), // loss B, closes 14:30
        trade('2026-06-10T13:00:00Z', '2026-06-10T14:00:00Z', 'win'), // single re-entry 15:00
        trade('2026-06-11T11:00:00Z', '2026-06-11T12:00:00Z', 'loss'), // 3rd loss → hasEnough
      ],
      90,
    );
    expect(r.losses).toBe(3);
    // The earliest loss (A, closed 14:00) claims the 15:00 re-entry (60 min);
    // loss B (closed 14:30) has NO unconsumed entry left that day → not counted.
    expect(r.reentries).toBe(1);
    expect(r.fastReentries).toBe(0);
    expect(r.medianDelayMin).toBe(60);
  });

  it('treats only realized (closed) losses as losses', () => {
    const r = computePostLossReaction(
      [
        trade('2026-06-10T11:00:00Z', null, 'loss'), // still open → not a realized loss
        trade('2026-06-11T11:00:00Z', '2026-06-11T12:00:00Z', 'win'),
        trade('2026-06-12T11:00:00Z', '2026-06-12T12:00:00Z', 'break_even'),
      ],
      90,
    );
    expect(r.losses).toBe(0);
    expect(r.hasEnough).toBe(false);
  });
});
