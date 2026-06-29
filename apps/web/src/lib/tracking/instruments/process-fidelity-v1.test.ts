import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from '@/lib/safety/amf-detection';

import { PROCESS_FIDELITY_V1 } from './process-fidelity-v1';

/**
 * §36 LONGITUDINAL-VALIDITY GUARD (mirror MindsetCheck §27.7 instrument.test.ts):
 * the exact set of question ids is FROZEN here. A future rename/reorder/removal
 * FAILS this test instead of silently breaking intra-version trend comparison —
 * any wording/scale change must ship a NEW version file (process-fidelity-v2.ts),
 * never an edit to v1.
 */
const EXPECTED_QUESTION_IDS = [
  'cut_20h',
  'one_risk_trade_per_day',
  'one_stop_per_day',
  'stop_set_before_entry',
  'risk_size_respected',
  'breakeven_secured',
  'prep_done_before_session',
  'patience_anti_fomo',
  'no_revenge_after_loss',
  'felt_emotion',
] as const;

describe('process-fidelity v1 instrument', () => {
  it('is keyed, versioned and on the risk_discipline axis', () => {
    expect(PROCESS_FIDELITY_V1.key).toBe('process-fidelity');
    expect(PROCESS_FIDELITY_V1.version).toBe('v1');
    expect(PROCESS_FIDELITY_V1.axis).toBe('risk_discipline');
    expect(PROCESS_FIDELITY_V1.cadence).toEqual({ kind: 'weekly', anchorDow: 1 });
    expect(PROCESS_FIDELITY_V1.capturesConfidence).toBe(true);
  });

  it('has unique, stable, non-empty question ids', () => {
    const ids = PROCESS_FIDELITY_V1.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of PROCESS_FIDELITY_V1.questions) {
      expect(q.id.trim().length).toBeGreaterThan(0);
      expect(q.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('freezes the exact set of question ids (§36 longitudinal validity)', () => {
    const ids = PROCESS_FIDELITY_V1.questions.map((q) => q.id);
    expect(ids).toEqual([...EXPECTED_QUESTION_IDS]);
    expect(new Set(ids).size).toBe(EXPECTED_QUESTION_IDS.length);
  });

  it('Likert questions carry exactly 5 ascending anchors', () => {
    for (const q of PROCESS_FIDELITY_V1.questions) {
      if (q.kind === 'likert') {
        expect(q.anchors.map((a) => a.value)).toEqual([1, 2, 3, 4, 5]);
      }
    }
  });

  // ── POSTURE §2 (BLOQUANT) ────────────────────────────────────────────────
  // The whole instrument must be PROCESS/PSYCHOLOGY only — never a market-
  // analysis surface. We run the REAL production AMF guard over the full label
  // corpus (preamble + every question label + help + option labels). If this
  // ever flags, the instrument wording leaked market content and MUST change.
  it('contains ZERO AMF-violating (market-analysis) content', () => {
    const corpus = [
      PROCESS_FIDELITY_V1.title,
      PROCESS_FIDELITY_V1.preamble,
      ...PROCESS_FIDELITY_V1.questions.flatMap((q) => [
        q.label,
        q.help ?? '',
        ...('options' in q ? q.options.map((o) => o.label) : []),
        ...('anchors' in q ? q.anchors.map((a) => a.label) : []),
      ]),
    ].join('\n');

    const result = detectAMFViolation(corpus);
    expect(result.matchedLabels).toEqual([]);
    expect(result.suspected).toBe(false);
  });
});
