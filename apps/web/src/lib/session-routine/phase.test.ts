import { describe, expect, it } from 'vitest';

import {
  currentSessionPhase,
  SESSION_STEPS,
  sessionPhaseGuidance,
  sessionStepIndex,
  type SessionPhase,
} from './phase';

/**
 * S24 — pure session-phase derivation. Anchored on Europe/Paris (the method's
 * NY-session schedule read in heure française). We assert the boundaries in BOTH
 * summer (UTC+2) and winter (UTC+1) to prove the `Intl`-based hour read is
 * DST-safe (never `Date.getHours()` on a naive instant).
 */

describe('currentSessionPhase — summer (Paris = UTC+2, June)', () => {
  const cases: Array<[string, SessionPhase]> = [
    ['2026-06-15T06:30:00Z', 'before'], // Paris 08:30
    ['2026-06-15T09:59:00Z', 'before'], // Paris 11:59
    ['2026-06-15T10:00:00Z', 'analysis'], // Paris 12:00 (boundary)
    ['2026-06-15T10:30:00Z', 'analysis'], // Paris 12:30
    ['2026-06-15T11:00:00Z', 'execution'], // Paris 13:00 (boundary)
    ['2026-06-15T13:30:00Z', 'execution'], // Paris 15:30
    ['2026-06-15T14:00:00Z', 'management'], // Paris 16:00 (boundary)
    ['2026-06-15T17:30:00Z', 'management'], // Paris 19:30
    ['2026-06-15T18:00:00Z', 'closed'], // Paris 20:00 (boundary — coupure)
    ['2026-06-15T21:30:00Z', 'closed'], // Paris 23:30
  ];
  it.each(cases)('%s → %s', (iso, expected) => {
    expect(currentSessionPhase(new Date(iso))).toBe(expected);
  });
});

describe('currentSessionPhase — winter (Paris = UTC+1, January)', () => {
  const cases: Array<[string, SessionPhase]> = [
    ['2026-01-15T11:00:00Z', 'analysis'], // Paris 12:00
    ['2026-01-15T12:00:00Z', 'execution'], // Paris 13:00
    ['2026-01-15T15:00:00Z', 'management'], // Paris 16:00
    ['2026-01-15T19:00:00Z', 'closed'], // Paris 20:00
  ];
  it.each(cases)('%s → %s', (iso, expected) => {
    expect(currentSessionPhase(new Date(iso))).toBe(expected);
  });
});

describe('sessionStepIndex', () => {
  it('maps before → -1 (no active step) and the four phases → 0..3', () => {
    expect(sessionStepIndex('before')).toBe(-1);
    expect(sessionStepIndex('analysis')).toBe(0);
    expect(sessionStepIndex('execution')).toBe(1);
    expect(sessionStepIndex('management')).toBe(2);
    expect(sessionStepIndex('closed')).toBe(3);
  });

  it('SESSION_STEPS has the four ordered trading phases', () => {
    expect(SESSION_STEPS.map((s) => s.phase)).toEqual([
      'analysis',
      'execution',
      'management',
      'closed',
    ]);
  });
});

describe('sessionPhaseGuidance — posture §2 (process only, never a market call)', () => {
  const phases: SessionPhase[] = ['before', 'analysis', 'execution', 'management', 'closed'];

  it.each(phases)('%s yields a non-empty calm headline + line', (phase) => {
    const g = sessionPhaseGuidance(phase);
    expect(g.headline.length).toBeGreaterThan(0);
    expect(g.line.length).toBeGreaterThan(0);
  });

  it('no guidance line ever issues a market call (achète / vends)', () => {
    for (const phase of phases) {
      const line = sessionPhaseGuidance(phase).line.toLowerCase();
      expect(line).not.toMatch(/\bach[èe]te\b/);
      expect(line).not.toMatch(/\bvends?\b/);
    }
  });
});
