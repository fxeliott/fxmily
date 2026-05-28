import { describe, expect, it } from 'vitest';

import {
  CURRENT_ONBOARDING_INSTRUMENT,
  CURRENT_ONBOARDING_INSTRUMENT_VERSION,
  CURRENT_ONBOARDING_DIMENSION_COUNT,
  CURRENT_ONBOARDING_ITEM_COUNT,
  getOnboardingInstrument,
  ONBOARDING_INSTRUMENT_V1,
  ONBOARDING_INSTRUMENTS,
  type OnboardingDimensionId,
  type OnboardingPhase,
} from './instrument-v1';

/**
 * V2.4 Phase A.2 — Onboarding interview instrument v1 anti-régression
 * invariants (longitudinal-validity INVARIANT carbone V1.5 mindset §27.7).
 *
 * If any test here fails on `v1`, an instrument mutation slipped through
 * without a `v2` version bump — that's a SILENT BREACH of every historical
 * `MemberProfile.instrumentVersion='v1'` row (trends become incomparable).
 *
 * The ONLY legitimate way to break these tests is :
 *   1. Add `ONBOARDING_INSTRUMENT_V2` to `ONBOARDING_INSTRUMENTS` registry.
 *   2. Bump `CURRENT_ONBOARDING_INSTRUMENT = ONBOARDING_INSTRUMENT_V2`.
 *   3. Migrate all consumers (claude-client + prompt + service).
 *   4. Keep `ONBOARDING_INSTRUMENT_V1` immutable in the registry.
 */

describe('OnboardingInstrument v1 — anti-régression invariants', () => {
  it('has exactly 30 items (longitudinal-validity pin)', () => {
    expect(CURRENT_ONBOARDING_ITEM_COUNT).toBe(30);
    expect(CURRENT_ONBOARDING_INSTRUMENT.items).toHaveLength(30);
  });

  it('has exactly 12 dimensions (longitudinal-validity pin)', () => {
    expect(CURRENT_ONBOARDING_DIMENSION_COUNT).toBe(12);
    expect(CURRENT_ONBOARDING_INSTRUMENT.dimensions).toHaveLength(12);
  });

  it('has questionIndex unique 0-29 (no gaps, no duplicates)', () => {
    const indexes = CURRENT_ONBOARDING_INSTRUMENT.items.map((i) => i.questionIndex);
    const sorted = [...indexes].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 30 }, (_, k) => k));
    expect(new Set(indexes).size).toBe(30);
  });

  it('all items.dimensionId reference a valid dimension', () => {
    const dimensionIds = new Set(
      CURRENT_ONBOARDING_INSTRUMENT.dimensions.map((d) => d.id as string),
    );
    for (const item of CURRENT_ONBOARDING_INSTRUMENT.items) {
      expect(dimensionIds.has(item.dimensionId)).toBe(true);
    }
  });

  it('all 12 dimensions have at least 1 item', () => {
    const dimsWithItems = new Set<OnboardingDimensionId>();
    for (const item of CURRENT_ONBOARDING_INSTRUMENT.items) {
      dimsWithItems.add(item.dimensionId);
    }
    expect(dimsWithItems.size).toBe(12);
  });

  it('covers all 3 phases (warmup / core / reflective_close)', () => {
    const phases = new Set<OnboardingPhase>();
    for (const item of CURRENT_ONBOARDING_INSTRUMENT.items) {
      phases.add(item.phase);
    }
    expect(phases).toEqual(new Set(['warmup', 'core', 'reflective_close']));
    // Specific counts per phase (anti-régression catalogue spec §3)
    expect(CURRENT_ONBOARDING_INSTRUMENT.items.filter((i) => i.phase === 'warmup')).toHaveLength(4);
    expect(CURRENT_ONBOARDING_INSTRUMENT.items.filter((i) => i.phase === 'core')).toHaveLength(22);
    expect(
      CURRENT_ONBOARDING_INSTRUMENT.items.filter((i) => i.phase === 'reflective_close'),
    ).toHaveLength(4);
  });

  it('contains zero banned clinical wording in any item text', () => {
    // Posture §J Anthropic profilage : descriptif-comportemental, pas
    // clinique. Mots bannis ne doivent JAMAIS apparaître dans le texte
    // des questions (qui sont lues par le membre + servent de référence
    // pour les highlights Claude).
    const CLINICAL_REGEX =
      /\b(dépression|anxiété\s+généralisée|trouble\s+(?:psychotique|bipolaire)|pathologie|diagnostic)\b/i;
    for (const item of CURRENT_ONBOARDING_INSTRUMENT.items) {
      expect(item.text).not.toMatch(CLINICAL_REGEX);
    }
  });

  it('contains zero `lhedge` reference in any item text (SPEC §1134/1235/1338)', () => {
    // "Lhedge inconnu de l'assistant — JAMAIS l'inventer". Posture
    // confidentialité formation Eliot — le mot ne doit JAMAIS fuiter
    // dans une question membre-facing.
    for (const item of CURRENT_ONBOARDING_INSTRUMENT.items) {
      expect(item.text.toLowerCase()).not.toContain('lhedge');
    }
  });

  it('has primary sources documented in INSTRUMENT_METADATA', () => {
    expect(ONBOARDING_INSTRUMENT_V1.metadata.primarySources.length).toBeGreaterThanOrEqual(3);
    // Mark Douglas attribution mandatory (cœur du framework)
    const hasDouglas = ONBOARDING_INSTRUMENT_V1.metadata.primarySources.some((s) =>
      s.author.toLowerCase().includes('douglas'),
    );
    expect(hasDouglas).toBe(true);
  });

  it('keeps v1 in registry + getOnboardingInstrument resolver works', () => {
    expect(CURRENT_ONBOARDING_INSTRUMENT_VERSION).toBe('v1');
    expect(ONBOARDING_INSTRUMENTS).toContain(ONBOARDING_INSTRUMENT_V1);
    expect(getOnboardingInstrument('v1')).toBe(ONBOARDING_INSTRUMENT_V1);
    expect(getOnboardingInstrument('v999')).toBeUndefined();
  });
});
