import { describe, expect, it } from 'vitest';

import {
  CRISIS_RESOURCES_FR,
  detectCrisis,
  getCrisisResources,
  type CrisisLevel,
} from './crisis-detection';

/**
 * V1.7 prep DORMANT — TDD coverage for FR crisis detection.
 *
 * Critical : every false-positive exclusion must have a test (anti-regression
 * against trading slang triggering safety routing).
 */

describe('detectCrisis', () => {
  describe('empty / no-signal inputs', () => {
    it('returns none for null', () => {
      expect(detectCrisis(null).level).toBe('none');
    });
    it('returns none for undefined', () => {
      expect(detectCrisis(undefined).level).toBe('none');
    });
    it('returns none for empty string', () => {
      expect(detectCrisis('').level).toBe('none');
    });
    it('returns none for pure whitespace', () => {
      expect(detectCrisis('   \n\t  ').level).toBe('none');
    });
    it('returns none for ordinary text', () => {
      expect(detectCrisis('Aujourd hui je vais bien, le marché est calme.').level).toBe('none');
    });
    it('returns none for journal note about a winning trade', () => {
      expect(
        detectCrisis('Bon trade, plan respecté, j ai pris mes profits comme prévu.').level,
      ).toBe('none');
    });
  });

  describe('HIGH severity — explicit suicidal ideation', () => {
    it('detects "suicide" verbatim', () => {
      const r = detectCrisis('Je pense au suicide ces derniers jours.');
      expect(r.level).toBe('high');
      expect(r.matches.map((m) => m.label)).toContain('suicide');
    });
    it('detects "me suicider"', () => {
      expect(detectCrisis('Je veux me suicider').level).toBe('high');
    });
    it('detects "en finir" without trading context', () => {
      expect(detectCrisis('Je veux en finir.').level).toBe('high');
    });
    it('detects "passer à l\'acte"', () => {
      expect(detectCrisis("J'ai peur de passer à l'acte.").level).toBe('high');
    });
    it('detects "sauter du pont"', () => {
      expect(detectCrisis('Je pense à sauter du pont.').level).toBe('high');
    });
    it('detects "me pendre"', () => {
      expect(detectCrisis('Envie de me pendre.').level).toBe('high');
    });
    it('is case-insensitive (uppercase)', () => {
      expect(detectCrisis('SUICIDE').level).toBe('high');
    });
    it('is case-insensitive (mixed)', () => {
      expect(detectCrisis('Je veux Me Suicider').level).toBe('high');
    });
  });

  describe('MEDIUM severity — distress signals', () => {
    it('detects "tout perdre" (no trading context)', () => {
      expect(detectCrisis('J ai peur de tout perdre.').level).toBe('medium');
    });
    it('detects "désespéré"', () => {
      expect(detectCrisis('Je suis désespéré.').level).toBe('medium');
    });
    it('detects "désespérée" (feminine accord)', () => {
      expect(detectCrisis('Je me sens désespérée.').level).toBe('medium');
    });
    it('detects "plus envie"', () => {
      expect(detectCrisis('Je n ai plus envie de continuer.').level).toBe('medium');
    });
    it('detects "à quoi bon"', () => {
      expect(detectCrisis('À quoi bon continuer ?').level).toBe('medium');
    });
    it('detects "abandonner ma vie"', () => {
      expect(detectCrisis('Je veux abandonner ma vie professionnelle.').level).toBe('medium');
    });
  });

  describe('LOW severity — emotional fatigue', () => {
    it('detects "dépression" (no market context)', () => {
      expect(detectCrisis('Je traverse une dépression depuis 3 mois.').level).toBe('low');
    });
    it('detects "déprimé"', () => {
      expect(detectCrisis('Je suis déprimé aujourd hui.').level).toBe('low');
    });
    it('detects "épuisé"', () => {
      expect(detectCrisis('Je suis épuisé.').level).toBe('low');
    });
  });

  describe('FALSE POSITIVE exclusions — trading slang', () => {
    it('does NOT trigger on "tout perdre sur ce trade"', () => {
      expect(detectCrisis('J ai failli tout perdre sur ce trade GBPUSD.').level).toBe('none');
    });
    it('does NOT trigger on "en finir avec ça" (often = arrêter de trader)', () => {
      expect(detectCrisis('Je veux en finir avec ça, le trading me coûte trop.').level).toBe(
        'none',
      );
    });
    it('does NOT trigger on "tuer ma position"', () => {
      expect(detectCrisis('Je vais tuer ma position si ça dépasse le stop.').level).toBe('none');
    });
    it('does NOT trigger on "tuer le setup"', () => {
      expect(detectCrisis('Le breakout va tuer le setup en cours.').level).toBe('none');
    });
    it('does NOT trigger on "dépression du marché"', () => {
      expect(detectCrisis('On entre dans une dépression du marché.').level).toBe('none');
    });
  });

  describe('priority — highest level wins on multi-match', () => {
    it('returns high when both high and medium match', () => {
      const r = detectCrisis('Je veux me suicider, je suis désespéré.');
      expect(r.level).toBe('high');
      expect(r.matches.length).toBeGreaterThanOrEqual(2);
    });
    it('returns medium when both medium and low match', () => {
      const r = detectCrisis('Je suis désespéré et déprimé.');
      expect(r.level).toBe('medium');
    });
  });

  describe('audit hygiene', () => {
    it('exposes canonical labels (NEVER raw text)', () => {
      const r = detectCrisis('Je veux me suicider sur le balcon.');
      for (const m of r.matches) {
        // Labels are snake_case canonical identifiers, never include the
        // user-supplied content (audit log is PII-free per RGPD §16).
        expect(m.label).toMatch(/^[a-z_]+$/);
      }
    });
  });
});

describe('getCrisisResources', () => {
  it('returns the 3 FR resources for high level', () => {
    const resources = getCrisisResources('high');
    expect(resources).toHaveLength(3);
    expect(resources.map((r) => r.name)).toEqual(['3114', 'SOS Amitié', 'Suicide Écoute']);
  });
  it('returns the 3 FR resources for medium level', () => {
    expect(getCrisisResources('medium')).toHaveLength(3);
  });
  it('returns empty array for low level (no banner surfaced)', () => {
    expect(getCrisisResources('low')).toEqual([]);
  });
  it('returns empty array for none level', () => {
    expect(getCrisisResources('none')).toEqual([]);
  });

  it('CRISIS_RESOURCES_FR is frozen (anti-mutation)', () => {
    expect(Object.isFrozen(CRISIS_RESOURCES_FR)).toBe(true);
  });

  it('all phone numbers are digits-only (tel: URI safe)', () => {
    for (const r of CRISIS_RESOURCES_FR) {
      expect(r.phone).toMatch(/^\d+$/);
    }
  });

  it('canary check — known FR crisis numbers (verified 2026-05-12)', () => {
    const phones = CRISIS_RESOURCES_FR.map((r) => r.phone);
    expect(phones).toContain('3114');
    expect(phones).toContain('0972394050'); // SOS Amitié
    expect(phones).toContain('0145394000'); // Suicide Écoute
  });
});

describe('TypeScript exports — type sanity', () => {
  it('CrisisLevel union covers 4 expected values', () => {
    const levels: CrisisLevel[] = ['high', 'medium', 'low', 'none'];
    expect(levels).toHaveLength(4);
  });
});
