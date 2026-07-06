import { describe, expect, it } from 'vitest';

import {
  addDaysIso,
  dayOffset,
  MASTERY_TARGET,
  MAX_PROJECTION_WEEKS,
  projectTrajectory,
  tierForCap,
  type TrajectoryHistoryPoint,
} from './projection';

/** Construit un historique `YYYY-MM-DD` à partir d'une liste de valeurs (1/jour). */
function makeHistory(values: number[], base = '2026-01-01'): TrajectoryHistoryPoint[] {
  const [y, mo, d] = base.split('-').map(Number);
  return values.map((value, i) => ({
    date: new Date(Date.UTC(y!, mo! - 1, d! + i)).toISOString().slice(0, 10),
    value,
  }));
}

describe('tierForCap', () => {
  it('mappe le cap composite sur le bon palier (bornes 50/70/85)', () => {
    expect(tierForCap(null).key).toBe('discovery');
    expect(tierForCap(0).key).toBe('discovery');
    expect(tierForCap(49).key).toBe('discovery');
    expect(tierForCap(50).key).toBe('regularity');
    expect(tierForCap(69).key).toBe('regularity');
    expect(tierForCap(70).key).toBe('consistency');
    expect(tierForCap(84).key).toBe('consistency');
    expect(tierForCap(85).key).toBe('mastery');
    expect(tierForCap(100).key).toBe('mastery');
  });
});

describe('dayOffset / addDaysIso', () => {
  it('dayOffset compte les jours civils (UTC, anti-drift TZ)', () => {
    expect(dayOffset('2026-01-01', '2026-01-01')).toBe(0);
    expect(dayOffset('2026-01-01', '2026-01-08')).toBe(7);
    expect(dayOffset('2026-02-28', '2026-03-01')).toBe(1); // 2026 non bissextile
    expect(dayOffset('2025-12-31', '2026-01-01')).toBe(1); // passage d'année
  });

  it('addDaysIso ajoute des jours et reformate', () => {
    expect(addDaysIso('2026-01-01', 7)).toBe('2026-01-08');
    expect(addDaysIso('2026-01-01', 0)).toBe('2026-01-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01'); // allow-absolute-date injected-clock-anchor
  });
});

describe('projectTrajectory', () => {
  it('historique trop court (< 6) → insufficient, aucune projection', () => {
    const r = projectTrajectory(makeHistory([60, 70, 80]), MASTERY_TARGET);
    expect(r.insufficient).toBe(true);
    expect(r.projected).toEqual([]);
    expect(r.etaLabel).toBeNull();
    expect(r.trend).toBe('flat');
  });

  it('tendance montante sous la cible → projection + ETA chiffré + bornes valides', () => {
    const r = projectTrajectory(makeHistory([60, 63, 66, 69, 72, 75]), MASTERY_TARGET);
    expect(r.insufficient).toBe(false);
    expect(r.trend).toBe('up');
    expect(r.projected.length).toBeGreaterThan(0);
    expect(r.projected.length).toBeLessThanOrEqual(MAX_PROJECTION_WEEKS);
    expect(r.etaLabel).toMatch(/semaine/);
    for (const p of r.projected) {
      expect(p.lo).toBeGreaterThanOrEqual(0);
      expect(p.hi).toBeLessThanOrEqual(100);
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
      expect(p.lo).toBeLessThanOrEqual(p.hi);
    }
  });

  it('dernier point déjà au palier (>= cible) → célèbre, pas de projection', () => {
    const r = projectTrajectory(makeHistory([80, 82, 84, 86, 88, 90]), MASTERY_TARGET);
    expect(r.etaLabel).toBe('Objectif déjà atteint');
    expect(r.projected).toEqual([]);
    expect(r.insufficient).toBe(false);
  });

  it('pente négative (déclin) → aucune extrapolation, pas d’ETA', () => {
    const r = projectTrajectory(makeHistory([80, 78, 76, 74, 72, 70]), MASTERY_TARGET);
    expect(r.projected).toEqual([]);
    expect(r.etaLabel).toBeNull();
    expect(r.trend).toBe('down');
  });

  it('plat sous la cible (pente nulle) → pas de projection', () => {
    const r = projectTrajectory(makeHistory([70, 70, 70, 70, 70, 70]), MASTERY_TARGET);
    expect(r.projected).toEqual([]);
    expect(r.etaLabel).toBeNull();
    expect(r.trend).toBe('flat');
  });

  it('droite déjà au-delà de la cible mais dernier point en repli (daysToTarget <= 0) → pas d’ETA sur-promettant', () => {
    // Régression croise 85 avant le dernier point, mais le dernier point redescend à 84.
    const r = projectTrajectory(makeHistory([70, 74, 78, 82, 86, 84]), MASTERY_TARGET);
    expect(r.projected).toEqual([]);
    expect(r.etaLabel).toBeNull();
    expect(r.insufficient).toBe(false);
  });

  it('progression très lente → horizon capé à 12 semaines avec label "Au-delà"', () => {
    const r = projectTrajectory(makeHistory([50, 50.2, 50.4, 50.6, 50.8, 51]), MASTERY_TARGET);
    expect(r.projected.length).toBe(MAX_PROJECTION_WEEKS);
    expect(r.etaLabel).toMatch(/Au-delà de 12 semaines/);
  });
});
