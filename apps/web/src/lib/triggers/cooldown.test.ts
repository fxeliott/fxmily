import { describe, expect, it } from 'vitest';

import {
  axisForCategory,
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

describe('axisForCategory (Tour 12 — Douglas category → mental axis)', () => {
  it('maps discipline-family categories to the discipline axis', () => {
    expect(axisForCategory('discipline')).toBe('discipline');
    expect(axisForCategory('process')).toBe('discipline');
    expect(axisForCategory('patience')).toBe('discipline');
  });

  it('maps ego-family categories to the ego axis', () => {
    expect(axisForCategory('ego')).toBe('ego');
    expect(axisForCategory('acceptance')).toBe('ego');
    expect(axisForCategory('tilt')).toBe('ego');
  });

  it('maps consistency → consistency and confidence → honesty', () => {
    expect(axisForCategory('consistency')).toBe('consistency');
    expect(axisForCategory('confidence')).toBe('honesty');
  });

  it('leaves ambiguous categories unmapped (never fabricates an axis)', () => {
    expect(axisForCategory('probabilities')).toBeNull();
    expect(axisForCategory('fear')).toBeNull();
    expect(axisForCategory('loss')).toBeNull();
    expect(axisForCategory(null)).toBeNull();
    expect(axisForCategory(undefined)).toBeNull();
  });
});

describe('pickBestMatch — profile-aware tie-break (Tour 12, action 3)', () => {
  it('same priority + both eligible → the card aligned on the dominant axis wins', () => {
    // Two white cards of EQUAL priority. `id` ASC would pick 'a-discipline';
    // the dominant axis is `ego`, so the ego-aligned card 'z-ego' wins instead.
    const r = pickBestMatch({
      matched: [
        { id: 'a-discipline', priority: 5, hatClass: 'white', category: 'discipline' },
        { id: 'z-ego', priority: 5, hatClass: 'white', category: 'tilt' },
      ],
      history: [],
      now: NOW,
      dominantAxis: 'ego',
    });
    expect(r?.cardId).toBe('z-ego');
  });

  it('without a dominant axis → identical to historical order (id ASC on ties)', () => {
    const matched = [
      {
        id: 'a-discipline',
        priority: 5,
        hatClass: 'white' as const,
        category: 'discipline' as const,
      },
      { id: 'z-ego', priority: 5, hatClass: 'white' as const, category: 'tilt' as const },
    ];
    expect(pickBestMatch({ matched, history: [], now: NOW })?.cardId).toBe('a-discipline');
    expect(pickBestMatch({ matched, history: [], now: NOW, dominantAxis: null })?.cardId).toBe(
      'a-discipline',
    );
  });

  it('never overrides a higher-priority card (tie-break is AFTER priority)', () => {
    // The higher-priority card is NOT aligned; the aligned card is lower priority.
    // Priority must still win — the axis only reorders EQUAL-priority ties.
    const r = pickBestMatch({
      matched: [
        { id: 'high', priority: 9, hatClass: 'white', category: 'discipline' },
        { id: 'low-aligned', priority: 3, hatClass: 'white', category: 'tilt' },
      ],
      history: [],
      now: NOW,
      dominantAxis: 'ego',
    });
    expect(r?.cardId).toBe('high');
  });

  it('never resurrects a card on cooldown (tie-break is AFTER the cooldown filter)', () => {
    // The aligned card is on cooldown → dropped before the tie-break even runs.
    const r = pickBestMatch({
      matched: [
        { id: 'a-clean', priority: 5, hatClass: 'white', category: 'discipline' },
        { id: 'z-aligned', priority: 5, hatClass: 'white', category: 'tilt' },
      ],
      history: [entry('z-aligned', 2)], // z-aligned on cooldown
      now: NOW,
      dominantAxis: 'ego',
    });
    expect(r?.cardId).toBe('a-clean');
  });

  it('dominant axis with no aligned card among matches → falls back to id ASC', () => {
    const r = pickBestMatch({
      matched: [
        { id: 'b-consistency', priority: 5, hatClass: 'white', category: 'consistency' },
        { id: 'a-discipline', priority: 5, hatClass: 'white', category: 'discipline' },
      ],
      history: [],
      now: NOW,
      dominantAxis: 'honesty', // neither card maps to honesty
    });
    expect(r?.cardId).toBe('a-discipline');
  });

  it('unmapped category is treated as un-aligned even with a dominant axis', () => {
    // 'fear' is intentionally unmapped → the aligned discipline card wins.
    const r = pickBestMatch({
      matched: [
        { id: 'a-fear', priority: 5, hatClass: 'white', category: 'fear' },
        { id: 'z-discipline', priority: 5, hatClass: 'white', category: 'process' },
      ],
      history: [],
      now: NOW,
      dominantAxis: 'discipline',
    });
    expect(r?.cardId).toBe('z-discipline');
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
