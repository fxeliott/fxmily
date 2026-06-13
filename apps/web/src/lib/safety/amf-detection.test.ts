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

  // ── Anti-FP post-review §2 ──────────────────────────────────────────────
  it('coaching motivation: "ta confiance va monter avec le temps"', () => {
    expect(flag('ta confiance va monter avec le temps')).toBe(false);
  });

  it('coaching motivation: "ta motivation va monter en flèche"', () => {
    expect(flag('ta motivation va monter en flèche')).toBe(false);
  });

  it('coaching stress: "ton stress va descendre"', () => {
    expect(flag('ton stress va descendre')).toBe(false);
  });

  it('coaching fatigue: "le niveau de fatigue va baisser"', () => {
    expect(flag('le niveau de fatigue va baisser')).toBe(false);
  });

  it('coaching réfléchi: "vends-toi mieux"', () => {
    expect(flag('vends-toi mieux')).toBe(false);
  });

  it('coaching réfléchi: "tu te vends bien"', () => {
    expect(flag('tu te vends bien')).toBe(false);
  });

  it('coaching tendance personnelle: "ta tendance à hésiter sous pression diminue"', () => {
    expect(flag('ta tendance à hésiter sous pression diminue')).toBe(false);
  });

  it('coaching zone de confort: "zone de confort"', () => {
    expect(flag('zone de confort')).toBe(false);
  });

  it('coaching double vigilance: "double ta vigilance après une perte"', () => {
    expect(flag('double ta vigilance après une perte')).toBe(false);
  });

  // ── Anti-FP carve-outs Session 4 ──────────────────────────────────────────

  it('élision datif: "Le mindset probabiliste t\'achète quelque chose de précieux : la sérénité."', () => {
    expect(flag("Le mindset probabiliste t'achète quelque chose de précieux : la sérénité.")).toBe(
      false,
    );
  });

  it('quoted discourse price_will_rise: "ton cerveau crée une histoire (\\"le marché va monter\\")"', () => {
    expect(flag('ton cerveau crée une histoire ("le marché va monter")')).toBe(false);
  });

  it('quoted discourse ça va monter: "tu entres en trade en pensant \\"ça va monter\\""', () => {
    expect(flag('tu entres en trade en pensant "ça va monter"')).toBe(false);
  });

  it('TP labels without price: "écris ta TP1 et ta TP2 avant l\'entrée"', () => {
    expect(flag("écris ta TP1 et ta TP2 avant l'entrée")).toBe(false);
  });
});

// =============================================================================
// MUST FLAG — anti-FN post-review §2 (G. TA vocabulary)
// =============================================================================

describe('detectAMFViolation — MUST FLAG (post-review §2 TA vocabulary)', () => {
  it('tendance haussière: "La tendance est haussière."', () => {
    expect(flag('La tendance est haussière.')).toBe(true);
  });

  it('tendance baissière: "tendance baissière sur le CAC"', () => {
    expect(flag('tendance baissière sur le CAC')).toBe(true);
  });

  it('RSI survendu: "Le RSI est survendu."', () => {
    expect(flag('Le RSI est survendu.')).toBe(true);
  });

  it('RSI surachetê: "le RSI est suracheté"', () => {
    expect(flag('le RSI est suracheté')).toBe(true);
  });

  it('retracement: "attends le retracement pour entrer"', () => {
    expect(flag('attends le retracement pour entrer')).toBe(true);
  });

  it('chart pattern tête-épaules: "le pattern tête-épaules se forme"', () => {
    expect(flag('le pattern tête-épaules se forme')).toBe(true);
  });

  it('chart pattern double top: "double top confirmé"', () => {
    expect(flag('double top confirmé')).toBe(true);
  });

  it('zone prix: "surveiller la zone 1.0850"', () => {
    expect(flag('surveiller la zone 1.0850')).toBe(true);
  });

  it('régression va_monter_price_target: "L\'EURUSD va monter vers 1.15."', () => {
    expect(flag("L'EURUSD va monter vers 1.15.")).toBe(true);
  });

  it('régression price_will_fall: "Ça va descendre."', () => {
    expect(flag('Ça va descendre.')).toBe(true);
  });

  it('régression price_will_rise: "Le marché va monter."', () => {
    expect(flag('Le marché va monter.')).toBe(true);
  });

  // ── Regression must-flag carve-out session 4 ──────────────────────────────

  it('TP with decimal price still flags: "TP 1.0850 puis trail."', () => {
    expect(flag('TP 1.0850 puis trail.')).toBe(true);
  });

  it('price_will_rise unquoted assertion still flags: "Le marché va monter."', () => {
    expect(flag('Le marché va monter.')).toBe(true);
  });

  it('price_will_fall unquoted assertion still flags: "Ça va descendre."', () => {
    expect(flag('Ça va descendre.')).toBe(true);
  });

  it('vous-imperative still flags: "Achetez maintenant !"', () => {
    expect(flag('Achetez maintenant !')).toBe(true);
  });
});

// =============================================================================
// MUST FLAG — S5 hardening corpus (FN closed)
// =============================================================================

describe('detectAMFViolation — MUST FLAG (S5 hardening — FN fermés)', () => {
  it('"Short le Nasdaq immédiatement"', () => {
    expect(flag('Short le Nasdaq immédiatement')).toBe(true);
  });

  it('"Long le DAX dès l\'ouverture"', () => {
    expect(flag("Long le DAX dès l'ouverture")).toBe(true);
  });

  it('"Reste long tant que la tendance le permet"', () => {
    expect(flag('Reste long tant que la tendance le permet')).toBe(true);
  });

  it('"Je te conseille de shorter le DAX demain"', () => {
    expect(flag('Je te conseille de shorter le DAX demain')).toBe(true);
  });

  it('"Prends un short sur le Nasdaq"', () => {
    expect(flag('Prends un short sur le Nasdaq')).toBe(true);
  });

  it('"Place ton take profit à 1.0850"', () => {
    expect(flag('Place ton take profit à 1.0850')).toBe(true);
  });

  it('"Vise les 1.15 sur la paire"', () => {
    expect(flag('Vise les 1.15 sur la paire')).toBe(true);
  });

  it('"Cible 1.0900 ce matin"', () => {
    expect(flag('Cible 1.0900 ce matin')).toBe(true);
  });

  it('"Le biais reste haussier sur le DAX"', () => {
    expect(flag('Le biais reste haussier sur le DAX')).toBe(true);
  });

  it('"Privilégie un biais haussier cette semaine"', () => {
    expect(flag('Privilégie un biais haussier cette semaine')).toBe(true);
  });

  it('"Le support se situe autour de 1.0850"', () => {
    expect(flag('Le support se situe autour de 1.0850')).toBe(true);
  });

  it('"Le prix cassera la zone des 4300"', () => {
    expect(flag('Le prix cassera la zone des 4300')).toBe(true);
  });

  // ── FN supplémentaires fermés sur re-review adversariale (verifier) ──
  it('"Passe acheteur sur l\'or maintenant" (directive acheteur/vendeur)', () => {
    expect(flag("Passe acheteur sur l'or maintenant")).toBe(true);
  });

  it('"Garde tes positions longues sur le DAX" (forme plurielle)', () => {
    expect(flag('Garde tes positions longues sur le DAX cet après-midi')).toBe(true);
  });

  it('"On vise un retournement haussier dès cet après-midi" (retournement directionnel)', () => {
    expect(flag('On vise un retournement haussier dès cet après-midi')).toBe(true);
  });

  it('"Achète-le maintenant avant la hausse" (directionnel — carve-out -toi ne sur-protège pas)', () => {
    expect(flag('Achète-le maintenant avant la hausse')).toBe(true);
  });
});

// =============================================================================
// MUST NOT FLAG — S5 hardening corpus (FP carve-outs)
// =============================================================================

describe('detectAMFViolation — MUST NOT FLAG (S5 hardening — FP carve-outs)', () => {
  it('"« ça va monter »" (cité entre guillemets français)', () => {
    expect(flag('« ça va monter »')).toBe(false);
  });

  it('"il pense que ça va monter" (discours rapporté par que)', () => {
    expect(flag('il pense que ça va monter')).toBe(false);
  });

  it('"objectif à atteindre : 3 sessions" (coaching goal, pas prix)', () => {
    expect(flag('objectif à atteindre : 3 sessions')).toBe(false);
  });

  it('"niveau de confiance" (coaching, pas support/résistance)', () => {
    expect(flag('niveau de confiance')).toBe(false);
  });

  it('"ta confiance va monter" (coaching motivation)', () => {
    expect(flag('ta confiance va monter')).toBe(false);
  });

  it('"ton stress va descendre" (coaching)', () => {
    expect(flag('ton stress va descendre')).toBe(false);
  });

  it('"tes résultats vont s\'améliorer" (coaching)', () => {
    expect(flag("tes résultats vont s'améliorer")).toBe(false);
  });

  it('"TP1 puis TP2 sont des labels de discipline" (labels coaching sans prix)', () => {
    expect(flag('TP1 puis TP2 sont des labels de discipline')).toBe(false);
  });

  it('"Reste dans ta zone 2 d\'effort, pas plus" (FIX zone_prix faux-positif)', () => {
    expect(flag("Reste dans ta zone 2 d'effort, pas plus")).toBe(false);
  });

  it('"travaille dans la zone 3 de RPE" (zone effort/RPE, pas prix)', () => {
    expect(flag('travaille dans la zone 3 de RPE')).toBe(false);
  });

  it('"zone de confort" (coaching)', () => {
    expect(flag('zone de confort')).toBe(false);
  });

  it('"long terme" (temporel)', () => {
    expect(flag('long terme')).toBe(false);
  });

  it('"vends-toi mieux" (réfléchi coaching)', () => {
    expect(flag('vends-toi mieux')).toBe(false);
  });

  it('"je t\'achète un café" (datif figuré)', () => {
    expect(flag("je t'achète un café")).toBe(false);
  });

  // ── Coaching FP carve-outs (resserrage post re-review : le 1er jet des patterns
  //    directionnels flaggait ces phrases de coaching légitimes → débrief skippé). ──
  it('"le chemin reste long mais tu avances" (coaching, pas "reste long sur/tant que")', () => {
    expect(flag('le chemin reste long mais tu avances')).toBe(false);
  });

  it('"ça reste long à intégrer, sois patient" (coaching)', () => {
    expect(flag('ça reste long à intégrer, sois patient')).toBe(false);
  });

  it('"je te conseille de prendre du recul" (coaching, "prendre" exclu)', () => {
    expect(flag('je te conseille de prendre du recul')).toBe(false);
  });

  it('"je te conseille de prendre ton temps" (coaching)', () => {
    expect(flag('je te conseille de prendre ton temps')).toBe(false);
  });

  it('"vise les 3 prochaines sessions cette semaine" (objectif coaching, pas prix)', () => {
    expect(flag('vise les 3 prochaines sessions cette semaine')).toBe(false);
  });

  it('"vise les 100% de respect du plan" (objectif coaching)', () => {
    expect(flag('vise les 100% de respect du plan')).toBe(false);
  });

  it('"ton support se situe dans ta routine du matin" (support=soutien, pas prix)', () => {
    expect(flag('ton support se situe dans ta routine du matin')).toBe(false);
  });

  it('"le soutien de tes proches est un vrai support" (support=soutien)', () => {
    expect(flag('le soutien de tes proches est un vrai support')).toBe(false);
  });

  it('"progresse le long du chemin de la discipline" (idiome "le long du")', () => {
    expect(flag('progresse le long du chemin de la discipline')).toBe(false);
  });

  // ── FP supplémentaires carve-outés sur re-review adversariale ──
  it('"Achète-toi un carnet dédié à tes revues de trades" (impératif pronominal réfléchi)', () => {
    expect(flag('Achète-toi un carnet dédié à tes revues de trades')).toBe(false);
  });

  it('"Achète-toi du temps pour respirer" (coaching réflexif)', () => {
    expect(flag('Achète-toi du temps pour respirer')).toBe(false);
  });

  it('"vise les 1.5R par trade" (risk-multiple, pas un prix)', () => {
    expect(flag('vise les 1.5R par trade')).toBe(false);
  });

  it('"vise les 2.0 de ratio risque-récompense" (sizing coaching)', () => {
    expect(flag('vise les 2.0 de ratio risque-récompense')).toBe(false);
  });
});

// =============================================================================
// S5 — 10e challenge (re-audit adverse 2026-06-13) : régressions FP/asymétrie
//   D1-F1 (price_target_vers % / R / risque), D1-F2 (tendance psy),
//   D1-F3 (symétrie EN citée). Voir amf-detection.ts carve-outs.
// =============================================================================

describe('detectAMFViolation — S5 10e challenge MUST NOT FLAG (D1-F1/F2/F3)', () => {
  // D1-F1 — "vers <décimal>" suivi d'un %/R/unité de risque = coaching de taille.
  it('D1-F1 "Réduis ta taille vers 1.00% pour de la sérénité."', () => {
    expect(flag('Réduis ta taille vers 1.00% pour de la sérénité.')).toBe(false);
  });
  it('D1-F1 "Ramène ton risque vers 1.0% par trade."', () => {
    expect(flag('Ramène ton risque vers 1.0% par trade.')).toBe(false);
  });
  it('D1-F1 "reviens vers 1.5% de risque"', () => {
    expect(flag('reviens vers 1.5% de risque')).toBe(false);
  });
  it('D1-F1 "tends vers 2.00R de gain"', () => {
    expect(flag('tends vers 2.00R de gain')).toBe(false);
  });
  it('D1-F1 "Vise une perte max vers 0.50% du capital."', () => {
    expect(flag('Vise une perte max vers 0.50% du capital.')).toBe(false);
  });

  // D1-F2 — génitif possessif "tendance haussière de ta <psy>" = coaching.
  //   (Le carve est volontairement restreint au possessif-personne pour ne PAS
  //    pouvoir être gamé par "de la discipline du Nasdaq" — cf. anti-FN ci-dessous.)
  it('D1-F2 "tendance haussière de ta régularité"', () => {
    expect(flag('On voit une tendance haussière de ta régularité.')).toBe(false);
  });
  it('D1-F2 "tendance haussière de ta discipline ce mois-ci"', () => {
    expect(flag('Ta constance : tendance haussière de ta discipline ce mois-ci.')).toBe(false);
  });

  // D1-F3 — directive EN CITÉE / discours rapporté = pédagogie Douglas (symétrie FR).
  it('D1-F3 "Ton cerveau fabrique l\'histoire « buy now » — observe-la."', () => {
    expect(flag("Ton cerveau fabrique l'histoire « buy now » — observe-la.")).toBe(false);
  });
  it('D1-F3 "Le réflexe \'sell now\' est une peur, pas un signal."', () => {
    expect(flag("Le réflexe 'sell now' est une peur, pas un signal.")).toBe(false);
  });
});

describe('detectAMFViolation — S5 10e challenge MUST STILL FLAG (anti-FN)', () => {
  it('D1-F1 anti-FN "Vise vers 1.0850 sur l\'euro." (prix Forex)', () => {
    expect(flag("Vise vers 1.0850 sur l'euro.")).toBe(true);
  });
  it('D1-F1 anti-FN "Le prix file vers 4300.50 sur le DAX."', () => {
    expect(flag('Le prix file vers 4300.50 sur le DAX.')).toBe(true);
  });
  it('D1-F2 anti-FN "La tendance est haussière sur le DAX." (marché)', () => {
    expect(flag('La tendance est haussière sur le DAX.')).toBe(true);
  });
  it('D1-F2 anti-FN "Une tendance haussière se dessine sur le Nasdaq."', () => {
    expect(flag('Une tendance haussière se dessine sur le Nasdaq.')).toBe(true);
  });
  it('D1-F3 anti-FN "Buy the dip maintenant sur le Nasdaq." (directive non citée)', () => {
    expect(flag('Buy the dip maintenant sur le Nasdaq.')).toBe(true);
  });
  it('D1-F3 anti-FN "Sell the rally tout de suite." (directive non citée)', () => {
    expect(flag('Sell the rally tout de suite.')).toBe(true);
  });
});

// Cas adverses trouvés par le verifier (re-review 2026-06-13) : les premiers
// carve-outs ouvraient ces FN (carve sur présence d'un token, pas absence
// d'ancre marché). Resserrés → ces vrais conseils directionnels flag à nouveau.
describe('detectAMFViolation — S5 carve-out adversarial anti-FN (verifier)', () => {
  it('D1-F1 "le prix repart vers 1.0850 de risque limité" (prix Forex + token parasite)', () => {
    expect(flag('Le support tient, le prix repart vers 1.0850 de risque limité.')).toBe(true);
  });
  it('D1-F1 "L\'EURUSD se dirige vers 1.0850%." (prix Forex + % collé)', () => {
    expect(flag("L'EURUSD se dirige vers 1.0850%.")).toBe(true);
  });
  it('D1-F1 "Ça remonte vers 1.0850 de marge."', () => {
    expect(flag('Ça remonte vers 1.0850 de marge.')).toBe(true);
  });
  it('D1-F2 "Côté discipline, la tendance est haussière sur le DAX" (psy avant + marché)', () => {
    expect(flag('Côté discipline, la tendance est haussière sur le DAX cette semaine.')).toBe(true);
  });
  it('D1-F2 "Garde la confiance: la tendance est baissière sur l\'or"', () => {
    expect(
      flag("Garde la confiance: la tendance est baissière sur l'or, attends la cassure."),
    ).toBe(true);
  });
  it('D1-F2 "tendance haussière de la discipline du Nasdaq" (article générique gamé)', () => {
    expect(flag('La tendance est haussière de la discipline du Nasdaq.')).toBe(true);
  });
  it('D1-F3 "« buy the dip sur l\'EURUSD" (guillemet ouvrant SANS fermeture)', () => {
    expect(flag("Mon conseil: « buy the dip sur l'EURUSD dès l'ouverture.")).toBe(true);
  });
  it('D1-F3 "\'sell now le CAC" (apostrophe ouvrante seule)', () => {
    expect(flag("'sell now le CAC avant la clôture.")).toBe(true);
  });
  it('D1-F3 "‘buy now and ride the trend on Nasdaq"', () => {
    expect(flag('‘buy now and ride the trend on Nasdaq.')).toBe(true);
  });
});
