import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from '@/lib/safety/amf-detection';

import {
  deriveTrainingReviewStatus,
  TRAINING_REVIEW_STATUS_META,
  type TrainingReviewStatus,
} from './review-status';

/**
 * S8 V2 §33-3 — backtest review-status derivation + guardrail.
 *
 * The status is derived at render (no migration), so the derivation must be
 * total and order-independent. The member-visible labels/descriptions are also
 * subject to garde-fou §2 (a review state is psychology/process, never a market
 * judgement) — proven with the production `detectAMFViolation` detector.
 */

describe('deriveTrainingReviewStatus', () => {
  it('returns `pending` when there is no correction', () => {
    expect(deriveTrainingReviewStatus([])).toBe('pending');
  });

  it('returns `corrected` when at least one correction is unseen', () => {
    expect(
      deriveTrainingReviewStatus([
        { seenByMemberAt: '2026-06-10T09:00:00.000Z' },
        { seenByMemberAt: null },
      ]),
    ).toBe('corrected');
  });

  it('returns `seen` only when EVERY correction has been seen', () => {
    expect(
      deriveTrainingReviewStatus([
        { seenByMemberAt: '2026-06-10T09:00:00.000Z' },
        { seenByMemberAt: '2026-06-11T10:00:00.000Z' },
      ]),
    ).toBe('seen');
  });

  it('is order-independent (unseen anywhere → corrected)', () => {
    const a = deriveTrainingReviewStatus([
      { seenByMemberAt: null },
      { seenByMemberAt: '2026-06-10T09:00:00.000Z' },
    ]);
    const b = deriveTrainingReviewStatus([
      { seenByMemberAt: '2026-06-10T09:00:00.000Z' },
      { seenByMemberAt: null },
    ]);
    expect(a).toBe('corrected');
    expect(b).toBe('corrected');
  });
});

describe('TRAINING_REVIEW_STATUS_META', () => {
  const statuses: TrainingReviewStatus[] = ['pending', 'corrected', 'seen'];

  it('has a calm tone for each status (never warn/bad — a pending review is no fault)', () => {
    const allowed = new Set(['mute', 'cy', 'ok']);
    for (const s of statuses) {
      const meta = TRAINING_REVIEW_STATUS_META[s];
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.description.trim().length).toBeGreaterThan(0);
      expect(allowed.has(meta.tone), `tone ${meta.tone} for ${s}`).toBe(true);
    }
  });

  it('GARDE-FOU §2 — every label + description is AMF-safe', () => {
    for (const s of statuses) {
      const meta = TRAINING_REVIEW_STATUS_META[s];
      for (const text of [meta.label, meta.description]) {
        const result = detectAMFViolation(text);
        expect(result.suspected, `matched ${result.matchedLabels.join(', ')} in "${text}"`).toBe(
          false,
        );
      }
    }
  });
});
