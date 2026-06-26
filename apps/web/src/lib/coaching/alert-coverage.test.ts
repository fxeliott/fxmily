import { describe, expect, it } from 'vitest';

import { ALERT_RULES } from '@/lib/verification/alerts';

import { COACHING_BASIS_ALERT_TRIGGERS } from './engine';
import { MENTAL_MAP_ALERT_TRIGGERS } from './mental-map';

/**
 * S5 §32-B (anti-drift, canon S10). « CHAQUE alerte S3 → accompagnement traçable au
 * motif. » Une alerte de répétition dont le `triggerType` n'a pas de copie de carte
 * mentale serait SILENCIEUSEMENT ignorée (`buildMentalMap` fait `continue`), et son
 * libellé de traçabilité retomberait sur le fallback générique « discipline ». Comme
 * `alert-labels.test.ts` le fait pour le panneau admin, ce test transforme tout futur
 * `triggerType` ajouté à `ALERT_RULES` sans accompagnement coaching en ÉCHEC de build.
 */
describe('coaching ↔ ALERT_RULES coverage (§32-B, 0 alerte orpheline)', () => {
  it('chaque triggerType d’ALERT_RULES a une copie d’accompagnement (carte mentale)', () => {
    const covered = new Set(MENTAL_MAP_ALERT_TRIGGERS);
    for (const rule of ALERT_RULES) {
      expect(
        covered.has(rule.triggerType),
        `alerte « ${rule.triggerType} » sans copie ALERT_COPY — ajoute-la dans lib/coaching/mental-map.ts`,
      ).toBe(true);
    }
  });

  it('chaque triggerType d’ALERT_RULES a un libellé de traçabilité (basis)', () => {
    const labelled = new Set(COACHING_BASIS_ALERT_TRIGGERS);
    for (const rule of ALERT_RULES) {
      expect(
        labelled.has(rule.triggerType),
        `alerte « ${rule.triggerType} » sans libellé ALERT_LABEL — ajoute-le dans lib/coaching/engine.ts`,
      ).toBe(true);
    }
  });

  it('aucune copie/libellé orphelin sans règle correspondante (cartes honnêtes)', () => {
    const ruleTriggers = new Set(ALERT_RULES.map((r) => r.triggerType));
    for (const trigger of [...MENTAL_MAP_ALERT_TRIGGERS, ...COACHING_BASIS_ALERT_TRIGGERS]) {
      expect(
        ruleTriggers.has(trigger),
        `mapping coaching orphelin « ${trigger} » sans ALERT_RULES — retire-le ou ajoute la règle`,
      ).toBe(true);
    }
  });
});
