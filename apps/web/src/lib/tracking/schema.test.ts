import { describe, expect, it } from 'vitest';

import { PROCESS_FIDELITY_V1 } from './instruments/process-fidelity-v1';
import { buildResponsesSchema, buildSubmissionSchema } from './schema';
import type { TrackingInstrument } from './types';

/** A tiny synthetic instrument exercising every question kind. */
const KITCHEN_SINK: TrackingInstrument = {
  key: 'kitchen-sink',
  version: 'v1',
  axis: 'execution',
  title: 'Test',
  preamble: 'Test',
  cadence: { kind: 'daily' },
  defaultCaptureContext: 'scheduled',
  capturesConfidence: false,
  questions: [
    { id: 'b', kind: 'boolean', label: 'b' },
    {
      id: 'l',
      kind: 'likert',
      label: 'l',
      anchors: [
        { value: 1, label: 'a' },
        { value: 2, label: 'b' },
        { value: 3, label: 'c' },
        { value: 4, label: 'd' },
        { value: 5, label: 'e' },
      ],
    },
    { id: 's', kind: 'scale', label: 's', min: 1, max: 5, minLabel: 'lo', maxLabel: 'hi' },
    { id: 'n', kind: 'numeric', label: 'n', min: 0, max: 240, integer: true },
    {
      id: 'c',
      kind: 'single_choice',
      label: 'c',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
      ],
    },
    {
      id: 'm',
      kind: 'multi_tag',
      label: 'm',
      maxSelected: 2,
      options: [
        { value: 'p', label: 'P' },
        { value: 'q', label: 'Q' },
        { value: 'r', label: 'R' },
      ],
    },
    { id: 'opt', kind: 'boolean', label: 'opt', required: false },
  ],
};

describe('buildResponsesSchema', () => {
  const schema = buildResponsesSchema(KITCHEN_SINK);

  it('accepts a fully valid response set (optional question omitted)', () => {
    const ok = schema.safeParse({ b: true, l: 4, s: 2, n: 30, c: 'x', m: ['p', 'q'] });
    expect(ok.success).toBe(true);
  });

  it('rejects a missing required answer', () => {
    const r = schema.safeParse({ l: 4, s: 2, n: 30, c: 'x', m: ['p'] }); // b missing
    expect(r.success).toBe(false);
  });

  it('rejects an unknown question id (strict)', () => {
    const r = schema.safeParse({ b: true, l: 4, s: 2, n: 30, c: 'x', m: ['p'], ghost: 1 });
    expect(r.success).toBe(false);
  });

  it('rejects a wrong type (likert out of range, boolean as string)', () => {
    expect(schema.safeParse({ b: true, l: 6, s: 2, n: 30, c: 'x', m: ['p'] }).success).toBe(false);
    expect(schema.safeParse({ b: 'yes', l: 4, s: 2, n: 30, c: 'x', m: ['p'] }).success).toBe(false);
  });

  it('rejects an unknown single_choice option and a too-long multi_tag', () => {
    expect(schema.safeParse({ b: true, l: 4, s: 2, n: 30, c: 'z', m: ['p'] }).success).toBe(false);
    expect(
      schema.safeParse({ b: true, l: 4, s: 2, n: 30, c: 'x', m: ['p', 'q', 'r'] }).success,
    ).toBe(false);
  });

  it('rejects duplicate multi_tag values and non-integer numeric', () => {
    expect(schema.safeParse({ b: true, l: 4, s: 2, n: 30, c: 'x', m: ['p', 'p'] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ b: true, l: 4, s: 2, n: 1.5, c: 'x', m: ['p'] }).success).toBe(false);
  });

  it('rejects an empty array for a REQUIRED multi_tag (server is authority on "answered")', () => {
    // The wizard sends '' for an empty selection (→ absent → required-missing),
    // but a tampered literal `[]` must not slip through as a non-answer.
    const r = schema.safeParse({ b: true, l: 4, s: 2, n: 30, c: 'x', m: [] });
    expect(r.success).toBe(false);
  });

  it('accepts an empty array for an OPTIONAL multi_tag (not over-restricted)', () => {
    const optional: TrackingInstrument = {
      ...KITCHEN_SINK,
      questions: [
        {
          id: 'mo',
          kind: 'multi_tag',
          label: 'mo',
          required: false,
          options: [{ value: 'p', label: 'P' }],
        },
      ],
    };
    const s = buildResponsesSchema(optional);
    expect(s.safeParse({ mo: [] }).success).toBe(true); // present-but-empty is fine
    expect(s.safeParse({}).success).toBe(true); // omitted is fine
  });
});

describe('buildSubmissionSchema', () => {
  it('accepts a valid submission for the real process-fidelity instrument', () => {
    const schema = buildSubmissionSchema(PROCESS_FIDELITY_V1);
    const r = schema.safeParse({
      instrumentKey: 'process-fidelity',
      instrumentVersion: 'v1',
      occurrenceKey: '2026-W26',
      responses: {
        cut_20h: true,
        one_risk_trade_per_day: true,
        one_stop_per_day: false,
        stop_set_before_entry: true,
        risk_size_respected: true,
        prep_done_before_session: true,
        patience_anti_fomo: 4,
        no_revenge_after_loss: 3,
      },
      confidenceLevel: 4,
      captureContext: 'cold',
      responseLatencyMs: 12_000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a wrong instrument key/version literal', () => {
    const schema = buildSubmissionSchema(PROCESS_FIDELITY_V1);
    expect(
      schema.safeParse({
        instrumentKey: 'mindset',
        instrumentVersion: 'v1',
        occurrenceKey: '2026-W26',
        responses: {},
      }).success,
    ).toBe(false);
  });

  it('rejects a confidence level outside 1..5', () => {
    const schema = buildSubmissionSchema(PROCESS_FIDELITY_V1);
    const base = {
      instrumentKey: 'process-fidelity',
      instrumentVersion: 'v1',
      occurrenceKey: '2026-W26',
      responses: {
        cut_20h: true,
        one_risk_trade_per_day: true,
        one_stop_per_day: true,
        stop_set_before_entry: true,
        risk_size_respected: true,
        prep_done_before_session: true,
        patience_anti_fomo: 4,
        no_revenge_after_loss: 3,
      },
    };
    expect(schema.safeParse({ ...base, confidenceLevel: 7 }).success).toBe(false);
  });
});
