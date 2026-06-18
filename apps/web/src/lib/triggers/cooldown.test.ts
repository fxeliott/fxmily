import { describe, expect, it } from 'vitest';

import {
  isOnCooldown,
  isRoutineSaturated,
  pickBestMatch,
  ROUTINE_SATURATION_K,
  type DeliveryHistoryEntry,
  type RoutineEngagementEntry,
} from './cooldown';

const NOW = new Date('2026-05-07T12:00:00Z');
const ONE_DAY_MS = 24 * 3600 * 1000;

function entry(cardId: string, daysAgo: number): DeliveryHistoryEntry {
  return { cardId, createdAtMs: NOW.getTime() - daysAgo * ONE_DAY_MS };
}

/** Routine-engagement builder: a delivery N days ago, optionally seen + alert. */
function rEntry(
  daysAgo: number,
  opts: { seen?: boolean; alert?: boolean } = {},
): RoutineEngagementEntry {
  const createdAtMs = NOW.getTime() - daysAgo * ONE_DAY_MS;
  return {
    createdAtMs,
    seenAtMs: opts.seen ? createdAtMs + 3600 * 1000 : null,
    isRoutine: !opts.alert,
  };
}

describe('isOnCooldown', () => {
  it('white card → 7-day cooldown — within window blocks', () => {
    expect(isOnCooldown('c1', 'white', [entry('c1', 3)], NOW)).toBe(true);
  });

  it('white card → 7-day cooldown — exactly 7 days ago still blocks (>=)', () => {
    expect(isOnCooldown('c1', 'white', [entry('c1', 7)], NOW)).toBe(true);
  });

  it('white card → 7-day cooldown — 8 days ago is OK', () => {
    expect(isOnCooldown('c1', 'white', [entry('c1', 8)], NOW)).toBe(false);
  });

  it('black card → 14-day cooldown — 10 days ago still blocks', () => {
    expect(isOnCooldown('c1', 'black', [entry('c1', 10)], NOW)).toBe(true);
  });

  it('black card → 14-day cooldown — 15 days ago is OK', () => {
    expect(isOnCooldown('c1', 'black', [entry('c1', 15)], NOW)).toBe(false);
  });

  it('different cardId in history does not block', () => {
    expect(isOnCooldown('c1', 'white', [entry('c2', 1)], NOW)).toBe(false);
  });

  it('empty history → never on cooldown', () => {
    expect(isOnCooldown('c1', 'white', [], NOW)).toBe(false);
  });
});

describe('pickBestMatch', () => {
  it('returns null when no matches', () => {
    expect(pickBestMatch({ matched: [], history: [], now: NOW })).toBe(null);
  });

  it('returns the highest priority eligible card', () => {
    const r = pickBestMatch({
      matched: [
        { id: 'a', priority: 3, hatClass: 'white' },
        { id: 'b', priority: 8, hatClass: 'white' },
        { id: 'c', priority: 5, hatClass: 'white' },
      ],
      history: [],
      now: NOW,
    });
    expect(r?.cardId).toBe('b');
  });

  it('skips a card on cooldown even if it has the highest priority', () => {
    const r = pickBestMatch({
      matched: [
        { id: 'a', priority: 3, hatClass: 'white' },
        { id: 'b', priority: 8, hatClass: 'white' },
      ],
      history: [entry('b', 2)], // b on cooldown
      now: NOW,
    });
    expect(r?.cardId).toBe('a');
  });

  it('returns null if all matches are on cooldown', () => {
    const r = pickBestMatch({
      matched: [
        { id: 'a', priority: 3, hatClass: 'white' },
        { id: 'b', priority: 8, hatClass: 'black' },
      ],
      history: [entry('a', 1), entry('b', 5)],
      now: NOW,
    });
    expect(r).toBe(null);
  });

  it('breaks ties deterministically by id ASC', () => {
    const r = pickBestMatch({
      matched: [
        { id: 'zeta', priority: 5, hatClass: 'white' },
        { id: 'alpha', priority: 5, hatClass: 'white' },
        { id: 'mike', priority: 5, hatClass: 'white' },
      ],
      history: [],
      now: NOW,
    });
    expect(r?.cardId).toBe('alpha');
  });
});

describe('isRoutineSaturated (TASK C — adaptive routine cadence)', () => {
  it('default K is the conservative 3', () => {
    expect(ROUTINE_SATURATION_K).toBe(3);
  });

  // (c) NEW MEMBER / insufficient history → OFF-equivalent (current behaviour).
  it('empty history → not saturated (OFF-equivalent)', () => {
    expect(isRoutineSaturated([])).toBe(false);
  });

  it('fewer than K routine deliveries (even all unseen) → not saturated', () => {
    expect(isRoutineSaturated([rEntry(1), rEntry(2)])).toBe(false);
  });

  // (b) SATURATED MEMBER → spacing engages.
  it('K most-recent routine deliveries all unseen → saturated', () => {
    expect(isRoutineSaturated([rEntry(1), rEntry(2), rEntry(3)])).toBe(true);
  });

  it('more than K, the K most-recent all unseen → saturated', () => {
    // 4 routine deliveries, the 3 newest unseen (oldest seen, irrelevant).
    expect(isRoutineSaturated([rEntry(1), rEntry(2), rEntry(3), rEntry(10, { seen: true })])).toBe(
      true,
    );
  });

  // (a) ENGAGED MEMBER → cadence unchanged.
  it('one of the K most-recent routine deliveries was seen → not saturated', () => {
    expect(isRoutineSaturated([rEntry(1, { seen: true }), rEntry(2), rEntry(3)])).toBe(false);
  });

  it('most-recent ordering is by createdAt, not array order', () => {
    // Newest (1d) seen but passed last in the array → still must count as recent.
    expect(isRoutineSaturated([rEntry(3), rEntry(2), rEntry(1, { seen: true })])).toBe(false);
  });

  it('ALERTE deliveries (sourceAlertId !== null) never count toward saturation', () => {
    // 3 unseen ALERTE + only 2 unseen ROUTINE → < K routine → not saturated.
    expect(
      isRoutineSaturated([
        rEntry(1, { alert: true }),
        rEntry(2, { alert: true }),
        rEntry(3, { alert: true }),
        rEntry(4),
        rEntry(5),
      ]),
    ).toBe(false);
  });

  it('unseen ALERTE between routine ones is skipped, not counted as a recent slot', () => {
    // 3 unseen routine exist but a newer unseen alert sits "in front" — the
    // alert is filtered out, so the 3 routine are still the K most-recent.
    expect(isRoutineSaturated([rEntry(1, { alert: true }), rEntry(2), rEntry(3), rEntry(4)])).toBe(
      true,
    );
  });

  it('k <= 0 → never saturated (guard)', () => {
    expect(isRoutineSaturated([rEntry(1), rEntry(2), rEntry(3)], 0)).toBe(false);
  });
});
