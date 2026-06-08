/**
 * TDD matrice AMF — Session 4 (SPEC §2 output gate).
 *
 * Two groups:
 *   MUST FLAG    → suspected === true
 *   MUST NOT FLAG → suspected === false
 *
 * See `amf-detection.ts` for calibration notes.
 */

import { describe, expect, it } from 'vitest';

import { detectAMFViolation } from './amf-detection';

// =============================================================================
// Helper
// =============================================================================

function flag(text: string) {
  return detectAMFViolation(text).suspected;
}

// =============================================================================
// MUST FLAG (suspected === true)
// =============================================================================

describe('detectAMFViolation — MUST FLAG', () => {
  it('directional long imperative: "Prends position LONG sur EURUSD."', () => {
    expect(flag('Prends position LONG sur EURUSD.')).toBe(true);
  });

  it('directional short with vise: "Vise un SHORT le DAX."', () => {
    expect(flag('Vise un SHORT le DAX.')).toBe(true);
  });

  it('passe long sur instrument: "Passe long sur l\'or."', () => {
    expect(flag("Passe long sur l'or.")).toBe(true);
  });

  it('vous-imperative achetez: "Achetez maintenant !"', () => {
    expect(flag('Achetez maintenant !')).toBe(true);
  });

  it('imperative vends with instrument: "Vends l\'EURUSD à la cassure."', () => {
    expect(flag("Vends l'EURUSD à la cassure.")).toBe(true);
  });

  it('English buy imperative: "Buy the dip."', () => {
    expect(flag('Buy the dip.')).toBe(true);
  });

  it('English sell imperative: "Sell the rally."', () => {
    expect(flag('Sell the rally.')).toBe(true);
  });

  it('TP with price number: "TP 1.0850 puis trail."', () => {
    expect(flag('TP 1.0850 puis trail.')).toBe(true);
  });

  it('Stop-loss with price: "Stop-loss à 4250."', () => {
    expect(flag('Stop-loss à 4250.')).toBe(true);
  });

  it('Objectif à price: "Objectif à 1.20."', () => {
    expect(flag('Objectif à 1.20.')).toBe(true);
  });

  it('support level: "Niveau de support à surveiller."', () => {
    expect(flag('Niveau de support à surveiller.')).toBe(true);
  });

  it('resistance level with price: "Niveau de résistance à 1.10."', () => {
    expect(flag('Niveau de résistance à 1.10.')).toBe(true);
  });

  it('price prediction rising: "L\'EURUSD va monter vers 1.15."', () => {
    expect(flag("L'EURUSD va monter vers 1.15.")).toBe(true);
  });

  it('generic ça va descendre: "Ça va descendre."', () => {
    expect(flag('Ça va descendre.')).toBe(true);
  });

  it('prévision haussière: "Prévision haussière sur le CAC."', () => {
    expect(flag('Prévision haussière sur le CAC.')).toBe(true);
  });

  it('breakout haussier: "Le breakout haussier confirme."', () => {
    expect(flag('Le breakout haussier confirme.')).toBe(true);
  });

  it('cassure baissière: "Cassure baissière imminente."', () => {
    expect(flag('Cassure baissière imminente.')).toBe(true);
  });
});

// =============================================================================
// MUST NOT FLAG (suspected === false) — coaching / psychology / execution
// =============================================================================

describe('detectAMFViolation — MUST NOT FLAG', () => {
  it('"Sur le long terme, ta discipline progresse."', () => {
    expect(flag('Sur le long terme, ta discipline progresse.')).toBe(false);
  });

  it('"Tout au long du mois, tu as respecté ton plan."', () => {
    expect(flag('Tout au long du mois, tu as respecté ton plan.')).toBe(false);
  });

  it('"Il a vendu sa position trop tôt par peur."', () => {
    expect(flag('Il a vendu sa position trop tôt par peur.')).toBe(false);
  });

  it('"Tu as acheté du recul ce mois-ci." (métaphore coaching)', () => {
    expect(flag('Tu as acheté du recul ce mois-ci.')).toBe(false);
  });

  it('"Ton objectif du mois prochain : tenir ton hedge."', () => {
    expect(flag('Ton objectif du mois prochain : tenir ton hedge.')).toBe(false);
  });

  it('"Ton niveau de discipline est solide."', () => {
    expect(flag('Ton niveau de discipline est solide.')).toBe(false);
  });

  it('"Ta confiance est plus longue à revenir après une perte."', () => {
    expect(flag('Ta confiance est plus longue à revenir après une perte.')).toBe(false);
  });

  it('"Le stress est descendu ce mois-ci."', () => {
    expect(flag('Le stress est descendu ce mois-ci.')).toBe(false);
  });

  it('"Tes résultats vont s\'améliorer si tu gardes le process."', () => {
    expect(flag("Tes résultats vont s'améliorer si tu gardes le process.")).toBe(false);
  });

  it('empty string', () => {
    expect(flag('')).toBe(false);
  });

  it('"Un mois calme — reprends à ton rythme."', () => {
    expect(flag('Un mois calme — reprends à ton rythme.')).toBe(false);
  });

  it('"8 trades alignés au plan sur 12."', () => {
    expect(flag('8 trades alignés au plan sur 12.')).toBe(false);
  });

  it('null input', () => {
    expect(detectAMFViolation(null).suspected).toBe(false);
  });

  it('undefined input', () => {
    expect(detectAMFViolation(undefined).suspected).toBe(false);
  });
});
