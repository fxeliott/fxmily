import { describe, expect, it } from 'vitest';

import { isOnCooldown, pickBestMatch, type DeliveryHistoryEntry } from './cooldown';

const NOW = new Date('2026-05-07T12:00:00Z');
const ONE_DAY_MS = 24 * 3600 * 1000;

function entry(cardId: string, daysAgo: number): DeliveryHistoryEntry {
  return { cardId, createdAtMs: NOW.getTime() - daysAgo * ONE_DAY_MS };
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
