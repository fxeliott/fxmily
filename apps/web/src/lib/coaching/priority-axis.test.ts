import { describe, expect, it } from 'vitest';

import { classifyPriorityAxes } from './priority-axis';

/**
 * S5 §32-C — le moteur doit exploiter le profil S2 (axes prioritaires d'onboarding,
 * texte libre). Ce seam mappe ce texte vers l'enum mental, en PRÉCISION (mieux vaut
 * ne pas mapper qu'avec une erreur). On vérifie le mapping, la robustesse aux
 * accents, le tie-break, la déduplication et l'abandon des libellés ambigus.
 */
describe('classifyPriorityAxes — pont profil S2 → axe mental (§32-C)', () => {
  it('mappe les mots-clés à forte confiance vers le bon axe', () => {
    expect(classifyPriorityAxes(['Être honnête avec mes résultats'])).toEqual(['honesty']);
    expect(classifyPriorityAxes(['Tenir mon plan'])).toEqual(['discipline']);
    expect(classifyPriorityAxes(['Plus de régularité dans mon suivi'])).toEqual(['consistency']);
    expect(classifyPriorityAxes(['Réduire le FOMO'])).toEqual(['ego']);
  });

  it('est insensible aux accents et à la casse', () => {
    expect(classifyPriorityAxes(['HONNÊTETÉ RADICALE'])).toEqual(['honesty']);
    expect(classifyPriorityAxes(['Régularité'])).toEqual(['consistency']);
  });

  it('tie-break : l’axe le plus grave gagne quand un libellé touche plusieurs groupes', () => {
    // « honnête » (honesty) ET « discipliné » (discipline) → honesty prime (1er groupe).
    expect(classifyPriorityAxes(['Être honnête et discipliné'])).toEqual(['honesty']);
  });

  it('déduplique en conservant l’ordre de première apparition', () => {
    expect(classifyPriorityAxes(['Tenir mon plan', 'Suivre mon plan avec rigueur'])).toEqual([
      'discipline',
    ]);
    expect(classifyPriorityAxes(['Routine quotidienne', 'Honnêteté'])).toEqual([
      'consistency',
      'honesty',
    ]);
  });

  it('abandonne les libellés ambigus / non reconnus (0 fabrication)', () => {
    expect(classifyPriorityAxes(['Gagner plus', 'Trader le réel'])).toEqual([]);
    expect(classifyPriorityAxes([])).toEqual([]);
  });

  it('combine plusieurs axes distincts d’une liste réelle', () => {
    expect(
      classifyPriorityAxes(['Tenir mon plan', 'Plus de sincérité', 'Garder mon sang-froid (ego)']),
    ).toEqual(['discipline', 'honesty', 'ego']);
  });
});
