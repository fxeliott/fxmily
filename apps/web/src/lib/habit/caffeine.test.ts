import { describe, expect, it } from 'vitest';

import {
  CAFFEINE_ML_PER_CUP,
  caffeineCupsToMl,
  caffeineFromCheckin,
  caffeineFromHabitLog,
  caffeineMlToCups,
  resolveDailyCaffeine,
} from './caffeine';

/**
 * J10 correctif n°3 — LES tests qui auraient détecté le défaut.
 *
 * Avant ce module, `DailyCheckin.caffeineMl` (millilitres) et
 * `HabitLog.value.cups` (tasses) décrivaient la même journée sans qu'aucun
 * code ne sache qu'ils parlaient de la même chose. Rien n'empêchait de les
 * additionner ni de les comparer ; rien n'aurait cassé si on l'avait fait.
 */
describe('conversions', () => {
  it('round-trips a whole number of cups', () => {
    for (const cups of [0, 1, 2, 3, 5, 10, 20]) {
      expect(caffeineMlToCups(caffeineCupsToMl(cups))).toBe(cups);
    }
  });

  it('keeps zero as a real observation, never as absence', () => {
    // « zéro café aujourd'hui » est un signal comportemental, pas un trou.
    expect(caffeineCupsToMl(0)).toBe(0);
    expect(caffeineMlToCups(0)).toBe(0);
    expect(resolveDailyCaffeine({ checkinMl: 0 })?.ml).toBe(0);
    expect(resolveDailyCaffeine({ trackCups: 0 })?.cups).toBe(0);
  });

  it('does not fabricate precision beyond a tenth of a cup', () => {
    // 300 ml / 125 = 2,4 tasses. Un chiffre de plus serait une précision
    // que la convention ne porte pas.
    expect(caffeineMlToCups(300)).toBe(2.4);
    expect(String(caffeineMlToCups(333))).not.toMatch(/\.\d\d/);
  });
});

describe('observations carry their unit and their origin', () => {
  it('marks a check-in declaration as measured in ml, cups derived', () => {
    const obs = caffeineFromCheckin(250);
    expect(obs.ml).toBe(250);
    expect(obs.cups).toBe(2);
    expect(obs.source).toBe('checkin');
    expect(obs.declaredUnit).toBe('ml');
    expect(obs.approximate).toBe(true);
  });

  it('marks a habit-log declaration as counted in cups, ml derived', () => {
    const obs = caffeineFromHabitLog(3);
    expect(obs.cups).toBe(3);
    expect(obs.ml).toBe(3 * CAFFEINE_ML_PER_CUP);
    expect(obs.source).toBe('track');
    expect(obs.declaredUnit).toBe('cups');
    expect(obs.approximate).toBe(true);
  });

  it('never claims a converted value is exact', () => {
    // Aucune norme ne fixe le volume d'une tasse (ISO 3509 est terminologique).
    // Toute valeur dérivée doit se présenter comme un ordre de grandeur.
    expect(caffeineFromCheckin(250).approximate).toBe(true);
    expect(caffeineFromHabitLog(2).approximate).toBe(true);
  });
});

describe('resolveDailyCaffeine', () => {
  it('prefers the check-in measurement over the habit-log count', () => {
    const obs = resolveDailyCaffeine({ checkinMl: 400, trackCups: 1 });
    expect(obs?.source).toBe('checkin');
    expect(obs?.ml).toBe(400);
  });

  it('falls back to the habit log when the check-in has nothing', () => {
    expect(resolveDailyCaffeine({ checkinMl: null, trackCups: 2 })?.source).toBe('track');
    expect(resolveDailyCaffeine({ trackCups: 2 })?.source).toBe('track');
  });

  it('NEVER sums the two stores (regression J10-3)', () => {
    // Le défaut que ce module ferme : deux déclarations de la MÊME journée.
    // Les additionner doublerait la caféine d'un membre consciencieux.
    const obs = resolveDailyCaffeine({ checkinMl: 250, trackCups: 2 });
    expect(obs?.ml).toBe(250);
    expect(obs?.ml).not.toBe(250 + caffeineCupsToMl(2));
  });

  it('returns null when the member declared nothing', () => {
    expect(resolveDailyCaffeine({})).toBeNull();
    expect(resolveDailyCaffeine({ checkinMl: null, trackCups: null })).toBeNull();
  });

  it('rejects nonsense rather than propagating it', () => {
    expect(resolveDailyCaffeine({ checkinMl: Number.NaN })).toBeNull();
    expect(resolveDailyCaffeine({ checkinMl: -10 })).toBeNull();
    expect(resolveDailyCaffeine({ checkinMl: -10, trackCups: 2 })?.source).toBe('track');
  });
});
