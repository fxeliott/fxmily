import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from '@/lib/safety/amf-detection';

import { PROCESS_FIDELITY_V1 } from './process-fidelity-v1';

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
