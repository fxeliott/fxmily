import { describe, expect, it } from 'vitest';

import { ALERT_RULES } from './alerts';
import { ALERT_LABELS } from './alert-labels';

/**
 * Anti-drift guard (S10 re-verif). The §31 `meeting_missed_repeat` rule was
 * added to ALERT_RULES without a parallel FR label, so the admin verification
 * panel rendered its raw English slug. This test makes that whole class of bug
 * a build failure: every trigger type that can produce an Alert row MUST have a
 * human label, and no label may dangle without a rule.
 */
describe('ALERT_LABELS ↔ ALERT_RULES coverage', () => {
  it('every ALERT_RULES trigger type has a non-empty FR label', () => {
    for (const rule of ALERT_RULES) {
      expect(
        ALERT_LABELS[rule.triggerType],
        `missing FR label for trigger '${rule.triggerType}' — add it to lib/verification/alert-labels.ts`,
      ).toBeTruthy();
    }
  });

  it('has no orphan label without a matching rule (keeps the map honest)', () => {
    const ruleTriggers = new Set(ALERT_RULES.map((r) => r.triggerType));
    for (const trigger of Object.keys(ALERT_LABELS)) {
      expect(
        ruleTriggers.has(trigger),
        `orphan label '${trigger}' has no ALERT_RULES entry — remove it or add the rule`,
      ).toBe(true);
    }
  });
});
