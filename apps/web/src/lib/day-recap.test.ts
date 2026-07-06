import { describe, expect, it } from 'vitest';

import { buildDayRecap, type DayRecapInput, type DayRecapTrade } from './day-recap';

/**
 * Le module est PUR (aucune I/O) : chaque cas construit un `DayRecapInput`
 * complet et vérifie la structure retournée. Trois familles couvertes (mission) :
 * jour à 0 trade, jour off, jour à N trades avec écarts — plus les invariants de
 * posture (le rouge réservé aux pertes, null passthrough).
 */

function baseInput(overrides: Partial<DayRecapInput> = {}): DayRecapInput {
  return {
    trades: [],
    isOffDay: false,
    planRespectedToday: null,
    intentionKept: null,
    formationFollowed: null,
    openMicroObjectiveTitle: null,
    ...overrides,
  };
}

function trade(overrides: Partial<DayRecapTrade> = {}): DayRecapTrade {
  return { outcome: null, exitReason: null, ...overrides };
}

describe('buildDayRecap', () => {
  describe('jour à 0 trade', () => {
    it('ne montre aucun compteur ni aucun fait quand rien n’est déclaré', () => {
      const recap = buildDayRecap(baseInput());
      expect(recap.title).toBe('Ta journée, bouclée');
      expect(recap.counters).toHaveLength(0);
      expect(recap.facts).toHaveLength(0);
      expect(recap.microObjectiveTitle).toBeNull();
      expect(recap.closer).toContain('On repart à zéro demain matin.');
    });

    it('affiche les self-reports tenus sans aucun trade', () => {
      const recap = buildDayRecap(
        baseInput({ planRespectedToday: true, intentionKept: true, formationFollowed: true }),
      );
      expect(recap.counters).toHaveLength(0);
      const texts = recap.facts.map((f) => f.text);
      expect(texts).toContain('Plan de trading respecté.');
      expect(texts).toContain('Intention du matin tenue.');
      expect(texts).toContain('Formation suivie aujourd’hui.');
      // Plan ET intention tenus = journée de process.
      expect(recap.closer).toBe('Une journée de process. On repart demain matin.');
      // Un fait tenu porte le ton vert calme, jamais rouge.
      for (const fact of recap.facts) expect(fact.tone).not.toBe('loss');
    });
  });

  describe('jour off', () => {
    it('titre et clôture de repos quand off et sans trade', () => {
      const recap = buildDayRecap(baseInput({ isOffDay: true }));
      expect(recap.title).toBe('Jour off, bouclé');
      expect(recap.counters).toHaveLength(0);
      expect(recap.closer).toBe('Journée de repos. Se poser fait aussi partie du process.');
    });

    it('compte quand même les trades d’un jour off', () => {
      const recap = buildDayRecap(
        baseInput({
          isOffDay: true,
          trades: [trade({ outcome: 'win', exitReason: 'tp_hit' })],
        }),
      );
      expect(recap.title).toBe('Jour off, bouclé');
      expect(recap.counters[0]).toEqual({ value: 1, label: 'trade journalisé' });
      expect(recap.counters[1]).toEqual({ value: 1, label: 'gagnant' });
      // Un trade a été fait : ce n'est plus la clôture « repos ».
      expect(recap.closer).not.toContain('Journée de repos');
    });
  });

  describe('jour à N trades avec écarts', () => {
    it('compte les trades et les gagnants, nomme la perte et l’écart de plan', () => {
      const trades: DayRecapTrade[] = [
        trade({ outcome: 'win', exitReason: 'tp_hit' }),
        trade({ outcome: 'loss', exitReason: 'sl_hit' }),
        trade({ outcome: 'win', exitReason: 'be_exit' }),
      ];
      const recap = buildDayRecap(
        baseInput({ trades, planRespectedToday: false, intentionKept: false }),
      );

      expect(recap.counters[0]).toEqual({ value: 3, label: 'trade journalisé' });
      expect(recap.counters[1]).toEqual({ value: 2, label: 'gagnant' });

      const texts = recap.facts.map((f) => f.text);
      expect(texts).toContain('Plan à retravailler, tu l’as noté.');
      expect(texts).toContain('Intention du matin à revoir, sans te juger.');

      // La perte est nommée avec sa nature de sortie (libellé partagé
      // EXIT_REASON_LABELS, sl_hit → « SL touché »), et c'est le SEUL rouge.
      const lossFact = recap.facts.find((f) => f.tone === 'loss');
      expect(lossFact).toBeDefined();
      expect(lossFact?.text).toContain('SL touché');
      const reds = recap.facts.filter((f) => f.tone === 'loss');
      expect(reds).toHaveLength(1);

      // Un écart de plan/intention reste 'watch' (accent), jamais 'loss'.
      const planFact = recap.facts.find((f) => f.text.startsWith('Plan à retravailler'));
      expect(planFact?.tone).toBe('watch');

      expect(recap.closer).toContain('Une perte est une donnée');
    });

    it('sans perte, met en avant une sortie manuelle avant la cible (écart de process)', () => {
      const trades: DayRecapTrade[] = [
        trade({ outcome: 'win', exitReason: 'tp_hit' }),
        trade({ outcome: 'break_even', exitReason: 'manual_before_target' }),
      ];
      const recap = buildDayRecap(baseInput({ trades }));
      const notable = recap.facts.find((f) => f.text.includes('sortie manuelle avant la cible'));
      expect(notable).toBeDefined();
      expect(notable?.tone).toBe('watch');
      // Aucun rouge : aucune perte.
      expect(recap.facts.some((f) => f.tone === 'loss')).toBe(false);
    });

    it('n’affiche pas le compteur de gagnants quand tous les trades sont ouverts', () => {
      const trades: DayRecapTrade[] = [trade(), trade()];
      const recap = buildDayRecap(baseInput({ trades }));
      expect(recap.counters).toHaveLength(1);
      expect(recap.counters[0]).toEqual({ value: 2, label: 'trade journalisé' });
    });

    it('nomme la perte sans nature de sortie quand exitReason est null', () => {
      const trades: DayRecapTrade[] = [trade({ outcome: 'loss', exitReason: null })];
      const recap = buildDayRecap(baseInput({ trades }));
      const lossFact = recap.facts.find((f) => f.tone === 'loss');
      expect(lossFact?.text).toBe('Une perte encaissée, elle fait partie du jeu.');
    });
  });

  describe('micro-objectif ouvert', () => {
    it('remonte le titre du micro-objectif ouvert tel quel', () => {
      const recap = buildDayRecap(
        baseInput({ openMicroObjectiveTitle: 'Tenir ta routine, un jour à la fois' }),
      );
      expect(recap.microObjectiveTitle).toBe('Tenir ta routine, un jour à la fois');
    });
  });

  describe('corrections admin non lues du jour', () => {
    it('n’affiche aucune ligne correction quand le compte est 0 ou absent', () => {
      expect(buildDayRecap(baseInput()).facts).toHaveLength(0);
      expect(buildDayRecap(baseInput({ unseenCorrectionsToday: 0 })).facts).toHaveLength(0);
    });

    it('affiche une ligne singulier accentuée pour une correction', () => {
      const recap = buildDayRecap(baseInput({ unseenCorrectionsToday: 1 }));
      const fact = recap.facts.find((f) => f.text.includes('correction'));
      expect(fact?.text).toBe('Une correction de ton coach à relire dans ton journal.');
      expect(fact?.tone).toBe('watch');
    });

    it('accorde au pluriel et reste en ton accent (jamais rouge)', () => {
      const recap = buildDayRecap(baseInput({ unseenCorrectionsToday: 3 }));
      const fact = recap.facts.find((f) => f.text.includes('corrections'));
      expect(fact?.text).toBe('3 corrections de ton coach à relire dans ton journal.');
      expect(fact?.tone).toBe('watch');
      expect(recap.facts.some((f) => f.tone === 'loss')).toBe(false);
    });
  });

  describe('null passthrough', () => {
    it('ne fabrique aucun fait à partir d’un self-report null', () => {
      const recap = buildDayRecap(
        baseInput({ planRespectedToday: null, intentionKept: null, formationFollowed: null }),
      );
      expect(recap.facts).toHaveLength(0);
    });
  });
});
