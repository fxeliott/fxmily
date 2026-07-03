import { describe, expect, it } from 'vitest';

import { normalizeAiTypography } from './normalize-typography';

/**
 * Deterministic typography belt for AI output (F-J1). These assertions pin the
 * real defects observed at runtime (/admin/reports « ...cette semaine — pas de
 * trades... », /admin/seances « Analyse de séance — un dollar qui souffle ») so
 * a regression that lets an em/en dash through a member-facing generation fails
 * CI, not production.
 */

describe('normalizeAiTypography', () => {
  describe('spaced dash → " : "', () => {
    it('rewrites the observed weekly-report defect', () => {
      expect(
        normalizeAiTypography('Aucune activité cette semaine — pas de trades cette semaine.'),
      ).toBe('Aucune activité cette semaine : pas de trades cette semaine.');
    });

    it('rewrites the observed séance title defect', () => {
      expect(normalizeAiTypography('Analyse de séance — un dollar qui souffle')).toBe(
        'Analyse de séance : un dollar qui souffle',
      );
    });

    it('uses " : " even when the following word starts with an uppercase', () => {
      expect(normalizeAiTypography('Point clé — Le dollar reflue.')).toBe(
        'Point clé : Le dollar reflue.',
      );
    });

    it('handles the en dash (U+2013) spaced form', () => {
      expect(normalizeAiTypography('Discipline – à surveiller')).toBe('Discipline : à surveiller');
    });

    it('rewrites multiple spaced dashes in one string', () => {
      expect(normalizeAiTypography('a — b — c')).toBe('a : b : c');
    });

    it('normalises a spaced dash mid-sentence', () => {
      expect(normalizeAiTypography('mot — suite')).toBe('mot : suite');
    });
  });

  describe('collapsed dash ("mot—mot") → ", "', () => {
    it('rewrites a glued em dash', () => {
      expect(normalizeAiTypography('nord—sud')).toBe('nord, sud');
    });

    it('rewrites a glued en dash', () => {
      expect(normalizeAiTypography('nord–sud')).toBe('nord, sud');
    });

    it('rewrites a glued dash between words with accents preserved', () => {
      expect(normalizeAiTypography('discipline—exécution')).toBe('discipline, exécution');
    });
  });

  describe('numeric range → " à "', () => {
    it('collapsed digit range (en dash)', () => {
      expect(normalizeAiTypography('3–5')).toBe('3 à 5');
    });

    it('collapsed digit range (em dash)', () => {
      expect(normalizeAiTypography('10—20')).toBe('10 à 20');
    });

    it('spaced digit range prefers " à " over " : "', () => {
      expect(normalizeAiTypography('10 — 20')).toBe('10 à 20');
    });

    it('range inside a sentence', () => {
      expect(normalizeAiTypography('Un gain de 2–3R en moyenne.')).toBe(
        'Un gain de 2 à 3R en moyenne.',
      );
    });

    it('bare digit range with an R suffix', () => {
      expect(normalizeAiTypography('3–4R')).toBe('3 à 4R');
    });

    it('a non-digit char between numbers is a collapsed dash, not a range', () => {
      // "12h—14h" — the char before the dash is "h", not a digit, so this is a
      // collapsed dash (", "), NOT a numeric range (" à ").
      expect(normalizeAiTypography('Session 12h—14h')).toBe('Session 12h, 14h');
    });

    it('multi-digit chained range 1–2–3', () => {
      // Adjacent ranges share a digit; the loop resolves every dash.
      expect(normalizeAiTypography('1–2–3')).toBe('1 à 2 à 3');
    });

    it('does NOT turn a word—digit collapse into a range', () => {
      // Only DIGIT–DIGIT is a range; word—digit is a collapsed dash → ", ".
      expect(normalizeAiTypography('niveau—3')).toBe('niveau, 3');
    });
  });

  describe('preservation (no dash / other glyphs untouched)', () => {
    it('returns plain text unchanged (identity)', () => {
      const input = 'Une semaine calme, discipline tenue.';
      expect(normalizeAiTypography(input)).toBe(input);
    });

    it('preserves the typographic apostrophe U+2019', () => {
      const input = "L'analyse d'aujourd'hui n'a rien d'inquiétant.";
      expect(normalizeAiTypography(input)).toBe(input);
    });

    it('preserves the ASCII hyphen-minus U+002D', () => {
      const input = 'Le plan mid-week est bien suivi, sang-froid intact.';
      expect(normalizeAiTypography(input)).toBe(input);
    });

    it('preserves French accents and markdown', () => {
      const input = '**Résumé** : la _trajectoire_ émotionnelle est stable.';
      expect(normalizeAiTypography(input)).toBe(input);
    });

    it('preserves newlines and does not collapse them into spaces', () => {
      const input = 'Ligne un.\nLigne deux — suite.\nLigne trois.';
      expect(normalizeAiTypography(input)).toBe('Ligne un.\nLigne deux : suite.\nLigne trois.');
    });

    it('returns the exact same reference when there is no em/en dash', () => {
      const input = 'rien à normaliser';
      // Fast path returns the original string.
      expect(normalizeAiTypography(input)).toBe(input);
    });
  });

  describe('edge / residual dashes', () => {
    it('a leading dash with a trailing space collapses to no stray double space', () => {
      expect(normalizeAiTypography('— suite')).toBe('suite');
    });

    it('a trailing dash collapses cleanly', () => {
      expect(normalizeAiTypography('fin —')).toBe('fin');
    });

    it('asymmetric spacing (space then dash-glued) never leaves a dash', () => {
      const out = normalizeAiTypography('mot —suite');
      expect(out).not.toMatch(/[–—]/);
      expect(out).toBe('mot suite');
    });

    it('never leaves any em/en dash for a dense mixed string', () => {
      const out = normalizeAiTypography('a—b — c – d 3–4 —');
      expect(out).not.toMatch(/[–—]/);
    });
  });

  describe('idempotence', () => {
    const cases = [
      'cette semaine — pas de trades',
      'Analyse de séance — un dollar qui souffle',
      'nord—sud',
      '3–5',
      '10 — 20',
      '1–2–3',
      'a—b — c – d 3–4 —',
      'texte sans tiret',
      "L'apostrophe U+2019 reste",
    ];
    for (const input of cases) {
      it(`f(f(x)) === f(x) for ${JSON.stringify(input)}`, () => {
        const once = normalizeAiTypography(input);
        const twice = normalizeAiTypography(once);
        expect(twice).toBe(once);
      });
    }
  });

  describe('no double spaces are ever produced', () => {
    const cases = ['a — b', 'mot —suite', 'fin —', '— début', 'x — y — z', '10 — 20'];
    for (const input of cases) {
      it(`no run of 2+ spaces for ${JSON.stringify(input)}`, () => {
        expect(normalizeAiTypography(input)).not.toMatch(/ {2,}/);
      });
    }
  });
});
