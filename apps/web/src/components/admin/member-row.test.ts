import { describe, expect, it } from 'vitest';

import { presenceFrom } from './member-row';

/**
 * Thresholds for the admin member-presence dot (login-freshness ramp).
 * `now` is injected so the boundaries are deterministic (no Date.now()).
 */
describe('presenceFrom', () => {
  const NOW = Date.parse('2026-06-21T12:00:00.000Z');
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  it('null lastSeenAt → "Jamais connecté", neutral grey (never a fabricated date)', () => {
    const r = presenceFrom(null, NOW);
    expect(r.label).toBe('Jamais connecté');
    expect(r.color).toBe('var(--t-4)');
  });

  it('< 7 days → green "Connexion récente"', () => {
    const r = presenceFrom(daysAgo(2), NOW);
    expect(r.color).toBe('var(--ok)');
    expect(r.label).toMatch(/^Connexion récente · /);
  });

  it('[7, 14) days → amber "1-2 semaines"', () => {
    const r = presenceFrom(daysAgo(10), NOW);
    expect(r.color).toBe('var(--warn)');
    expect(r.label).toMatch(/^Connexion il y a 1-2 semaines · /);
  });

  it('>= 14 days → grey "+2 semaines" (stale is grey, never red — §2)', () => {
    const r = presenceFrom(daysAgo(30), NOW);
    expect(r.color).toBe('var(--t-3)');
    expect(r.label).toMatch(/^Connexion il y a \+2 semaines · /);
    // Posture: a long-absent member is out of sight, not "failing" → never --bad.
    expect(r.color).not.toBe('var(--bad)');
  });

  it('exact 7-day boundary lands in the amber band (inclusive lower edge)', () => {
    const r = presenceFrom(daysAgo(7), NOW);
    expect(r.color).toBe('var(--warn)');
  });

  it('honesty: copy says "Connexion" (login), never "Vu"/"actif" — lastSeenAt is login-only', () => {
    for (const sample of [null, daysAgo(1), daysAgo(10), daysAgo(40)]) {
      const { label } = presenceFrom(sample, NOW);
      expect(label).not.toMatch(/\bVu\b|\bactif\b/i);
    }
  });
});
