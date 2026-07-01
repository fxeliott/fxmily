import { describe, expect, it } from 'vitest';

import {
  buildReprofileSnapshot,
  concatReflectionCorpus,
  MAX_REFLECTIONS,
  MAX_TAG_FREQUENCIES,
  REFLECTION_MAX_CHARS,
} from './snapshot';
import type { RawReprofileCheckin, RawReprofileSlice, RawReprofileTrade } from './types';

/**
 * J-E — PURE monthly re-profiling snapshot builder.
 *
 * Proves the evidence-grounding contract holds at the source: the corpus the
 * gate validates against is EXACTLY the free-text the builder emits (member
 * words only, `safeFreeText`-sanitised once), the baseline/previous-month are
 * reference-only, and the aggregation is deterministic (idempotent re-runs).
 */

function checkin(over: Partial<RawReprofileCheckin> = {}): RawReprofileCheckin {
  return {
    localDate: '2026-06-03',
    intention: null,
    journalNote: null,
    gratitudeItems: [],
    emotionTags: [],
    ...over,
  };
}

function trade(over: Partial<RawReprofileTrade> = {}): RawReprofileTrade {
  return {
    localDate: '2026-06-04',
    notes: null,
    emotionBefore: [],
    emotionDuring: [],
    emotionAfter: [],
    tags: [],
    ...over,
  };
}

function slice(over: Partial<RawReprofileSlice> = {}): RawReprofileSlice {
  return {
    pseudonymLabel: 'member-1A2B3C4D',
    timezone: 'Europe/Paris',
    monthStartLocal: '2026-06-01',
    monthEndLocal: '2026-06-30',
    accountAgeDaysInWindow: 30,
    checkins: [],
    trades: [],
    baselineProfile: null,
    previousMonthSnapshot: null,
    ...over,
  };
}

describe('J-E — buildReprofileSnapshot (reflections corpus)', () => {
  it('extracts intention + journal + each gratitude item as separate reflections', () => {
    const snap = buildReprofileSnapshot(
      slice({
        checkins: [
          checkin({
            intention: 'Rester patient et attendre mon setup A+.',
            journalNote: "J'ai coupe une position par peur, pas par plan.",
            gratitudeItems: ['Mon suivi de plan', 'Ma discipline du matin'],
          }),
        ],
      }),
    );

    expect(snap.reflections.map((r) => r.source)).toEqual([
      'intention',
      'journal',
      'gratitude',
      'gratitude',
    ]);
    expect(snap.reflections.every((r) => r.localDate === '2026-06-03')).toBe(true);
    expect(snap.processSignals.reflectionCount).toBe(4);
    expect(snap.processSignals.checkinCount).toBe(1);
  });

  it('extracts only the free-text note from a trade (emotions/tags are NOT reflections)', () => {
    const snap = buildReprofileSnapshot(
      slice({
        trades: [
          trade({
            notes: "J'ai respecte mon stop cette fois, moins de stress.",
            emotionBefore: ['confiance'],
            tags: ['plan_respecte'],
          }),
        ],
      }),
    );

    expect(snap.reflections).toHaveLength(1);
    expect(snap.reflections[0]).toMatchObject({ source: 'trade_note', localDate: '2026-06-04' });
    expect(snap.processSignals.tradeCount).toBe(1);
  });

  it('drops whitespace / zero-width-only free text (safeFreeText -> "")', () => {
    const snap = buildReprofileSnapshot(
      slice({
        checkins: [
          // Spaces, zero-width space (U+200B) + LRM (U+200E), and a lone RLM (U+200F).
          checkin({
            intention: '   ',
            journalNote: String.fromCharCode(0x200b, 0x200e),
            gratitudeItems: [String.fromCharCode(0x200f)],
          }),
        ],
        trades: [trade({ notes: '' })],
      }),
    );
    expect(snap.reflections).toHaveLength(0);
    expect(snap.processSignals.reflectionCount).toBe(0);
  });

  it('caps each reflection at REFLECTION_MAX_CHARS', () => {
    const long = 'a'.repeat(REFLECTION_MAX_CHARS + 50);
    const snap = buildReprofileSnapshot(slice({ checkins: [checkin({ journalNote: long })] }));
    expect(snap.reflections).toHaveLength(1);
    expect(snap.reflections[0]?.text).toHaveLength(REFLECTION_MAX_CHARS);
  });

  it('caps the total reflection count at MAX_REFLECTIONS (stable earliest prefix)', () => {
    const checkins = Array.from({ length: MAX_REFLECTIONS + 20 }, (_, i) =>
      checkin({ localDate: '2026-06-01', intention: `Intention numero ${i}.` }),
    );
    const snap = buildReprofileSnapshot(slice({ checkins }));
    expect(snap.reflections).toHaveLength(MAX_REFLECTIONS);
    // Stable prefix: the first entry is kept, the overflow tail is dropped.
    expect(snap.reflections[0]?.text).toBe('Intention numero 0.');
  });
});

describe('J-E — buildReprofileSnapshot (structured tag frequencies)', () => {
  it('aggregates emotion + behavioural tags across checkins and trades, count desc then tag asc', () => {
    const snap = buildReprofileSnapshot(
      slice({
        checkins: [
          checkin({ emotionTags: ['stress', 'stress'] }),
          checkin({ emotionTags: ['confiance'] }),
        ],
        trades: [
          trade({ emotionBefore: ['stress'], tags: ['revenge_trade'] }),
          trade({ emotionAfter: ['confiance'], emotionDuring: ['stress'] }),
        ],
      }),
    );

    // stress: 2 (checkin) + 1 (before) + 1 (during) = 4 ; confiance: 2 ; revenge_trade: 1
    expect(snap.processSignals.tagFrequencies).toEqual([
      { tag: 'stress', count: 4 },
      { tag: 'confiance', count: 2 },
      { tag: 'revenge_trade', count: 1 },
    ]);
  });

  it('caps the tag frequency list at MAX_TAG_FREQUENCIES', () => {
    const emotionTags = Array.from({ length: MAX_TAG_FREQUENCIES + 5 }, (_, i) => `tag_${i}`);
    const snap = buildReprofileSnapshot(slice({ checkins: [checkin({ emotionTags })] }));
    expect(snap.processSignals.tagFrequencies).toHaveLength(MAX_TAG_FREQUENCIES);
  });
});

describe('J-E — buildReprofileSnapshot (baseline reference)', () => {
  it('maps the onboarding baseline + previous-month snapshot (reference context)', () => {
    const snap = buildReprofileSnapshot(
      slice({
        baselineProfile: {
          onboardingSummary: 'Portrait initial du membre.',
          coachingRegister: 'pedagogique',
          learningStage: 'mechanical',
        },
        previousMonthSnapshot: {
          monthStartLocal: '2026-05-01',
          evolutionNarrative: 'Le mois dernier, la discipline progressait.',
          coachingRegister: 'pedagogique',
          learningStage: 'subjective',
        },
      }),
    );

    expect(snap.baseline.coachingRegister).toBe('pedagogique');
    expect(snap.baseline.learningStage).toBe('mechanical');
    expect(snap.baseline.onboardingSummary).toBe('Portrait initial du membre.');
    expect(snap.baseline.previousMonth?.monthStartLocal).toBe('2026-05-01');
    expect(snap.baseline.previousMonth?.learningStage).toBe('subjective');
  });

  it('collapses an absent baseline / previous-month to null (no fabrication)', () => {
    const snap = buildReprofileSnapshot(slice());
    expect(snap.baseline.coachingRegister).toBeNull();
    expect(snap.baseline.learningStage).toBeNull();
    expect(snap.baseline.onboardingSummary).toBeNull();
    expect(snap.baseline.previousMonth).toBeNull();
  });
});

describe('J-E — concatReflectionCorpus (evidence source of truth)', () => {
  it('joins ONLY reflection text (baseline/narrative are excluded)', () => {
    const snap = buildReprofileSnapshot(
      slice({
        checkins: [checkin({ intention: 'Patienter.', journalNote: 'Coupe trop tot.' })],
        baselineProfile: {
          onboardingSummary: 'BASELINE_SENTINEL',
          coachingRegister: null,
          learningStage: null,
        },
        previousMonthSnapshot: {
          monthStartLocal: '2026-05-01',
          evolutionNarrative: 'NARRATIVE_SENTINEL',
          coachingRegister: null,
          learningStage: null,
        },
      }),
    );

    const corpus = concatReflectionCorpus(snap);
    expect(corpus).toBe('Patienter.\nCoupe trop tot.');
    // Reference context must never leak into the citable corpus.
    expect(corpus).not.toContain('BASELINE_SENTINEL');
    expect(corpus).not.toContain('NARRATIVE_SENTINEL');
  });

  it('is NFC-normalised so a decomposed journal note matches a composed citation', () => {
    // Author "regularite" (with acute accents) in NFD (e + combining acute);
    // the corpus must expose it in NFC so a model citing the composed form validates.
    const composed = `régularité`; // NFC form
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed); // guard: the input really is decomposed
    const snap = buildReprofileSnapshot(
      slice({ checkins: [checkin({ journalNote: decomposed })] }),
    );
    const corpus = concatReflectionCorpus(snap);
    expect(corpus.includes(composed)).toBe(true);
  });
});
