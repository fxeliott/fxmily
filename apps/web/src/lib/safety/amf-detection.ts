/**
 * Session 4 — AMF output gate (SPEC §2 posture invariant).
 *
 * Pure detection layer for AMF/CIF-regulated content in IA output text:
 * directional market advice, entry/exit signals, price targets, pattern
 * breakout calls, or any text a regulator would read as investment advice.
 *
 * POSTURE INVARIANT (SPEC §2):
 *   The coaching/IA NEVER gives market-analysis advice (setup / direction /
 *   pair / forecast / level). Authorised: execution coaching (session / hedge /
 *   plan / size / exit) + Mark Douglas psychology.
 *
 * Design principles:
 *   1. **Context-anchored patterns** — ambiguous words (`long`/`short`/
 *      `achète`/`vends`) are only flagged when clearly in a trading
 *      directive context (imperative form, explicit instrument, directional
 *      compound).  Pure coaching / psychology text must pass through clean.
 *   2. **False-positive budget > false-negative budget** on the must-not-flag
 *      side: a missed AMF violation that reaches a member is a compliance risk;
 *      a false positive silently skips a debrief (admin recovers next run).
 *      However, systematic false positives on legitimate coaching text break
 *      the product — hence the anchoring above.
 *   3. **No server-only marker** — this module is pure regex logic with zero
 *      DB/env deps, mirroring `lib/safety/crisis-detection.ts`.
 *   4. **No LLM-driven detection** — deterministic regex only, same rationale
 *      as the crisis module (commercial LLMs cannot be trusted as safety gates
 *      on their own output).
 *
 * CALIBRATION — matrice de tests (Session 4, TDD):
 *   Must flag  : directional imperatives (LONG/SHORT/BUY/SELL in trade context),
 *                TP/SL/objectif + number, support/resistance levels, monter/
 *                descendre price predictions, breakout calls, price targets.
 *   Must NOT flag: "long terme" temporel, coaching psychology, "a vendu" past,
 *                  "objectif du mois" coaching goal, "niveau de discipline",
 *                  "confiance plus longue", "stress descendu", "vont s'améliorer".
 *
 * References:
 *   - AMF règlement général — art. 314-1 et s. (conseil en investissement)
 *   - Directive MiFID II — art. 24 (informations + conseil)
 *   - SPEC §2 Fxmily posture invariant
 */

export interface AMFViolationResult {
  /** True iff the text contains at least one AMF-violating pattern. */
  suspected: boolean;
  /** Canonical labels of matched patterns (never the raw text — RGPD §16). */
  matchedLabels: string[];
}

interface AMFPatternRule {
  label: string;
  pattern: RegExp;
}

// =============================================================================
// AMF_VIOLATION_PATTERNS
//
// Groupes logiques :
//  A. Directives directionnelles (impératif trade context)
//  B. TP / SL / objectif prix + chiffre
//  C. Niveaux de support / résistance
//  D. Prédictions de mouvement de prix
//  E. Breakout / cassure directionnelle
//  F. Cibles de prix ("vers 1.15")
//  G. Vocabulaire d'analyse technique (FN fermés post-review §2)
// =============================================================================

export const AMF_VIOLATION_PATTERNS: AMFPatternRule[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // A. Directional imperatives — trading context only.
  //
  // "Prends position LONG" / "Passe long sur l'or" / "Vise un SHORT le DAX"
  //   ► anchored on "position LONG|SHORT", "passe long|short", "vise.*short"
  // "Achetez maintenant" / "Vends l'EURUSD à la cassure" / "Achète"
  //   ► imperative form of acheter/vendre + optional object
  //     but NOT "il a vendu" (past indicative), "tu as acheté" (passé composé)
  //     and NOT "achète du recul" where "recul" is NOT a financial instrument
  //     but CAN be a figurative phrase meaning "buy the dip" — however the
  //     matrice treats "achète" alone (imperative stand-alone) as flagged.
  //     Compromise: match bare "achetez" (vous-imperative, unambiguous) and
  //     "achète" only when NOT followed by "du recul" (explicit carve-out).
  // "Buy the dip" / "Sell the rally" — English imperatives.
  // ──────────────────────────────────────────────────────────────────────────

  {
    label: 'directive_long_position',
    // "prends position long(ue)" / "passe long" / "position long(ue)" standalone
    pattern: /(?<!\p{L})(?:prends?\s+position|passe[sz]?)\s+long(?:ue)?(?!\s+terme)(?!\p{L})/iu,
  },
  {
    label: 'directive_short_position',
    // "prends position short" / "passe short" / "vise un short"
    pattern: /(?<!\p{L})(?:prends?\s+position|passe[sz]?|vise[sz]?\s+un)\s+short(?!\p{L})/iu,
  },
  {
    label: 'directive_long_instrument',
    // "passe long sur l'or" / "être long EURUSD" / "long sur le DAX"
    // anchored: "long" immediately followed by "sur" + instrument hint
    pattern: /(?<!\p{L})long\s+sur\s+(?:l[ae]?[''\s]|le\s|un\s)?\p{L}/iu,
  },
  {
    label: 'directive_imperative_achetez',
    // "Achetez maintenant" — vous-imperative unambiguous
    pattern: /(?<!\p{L})achetez(?!\p{L})/iu,
  },
  {
    label: 'directive_imperative_achete',
    // "Achète" stand-alone imperative but NOT "achète du recul" (coaching metaphor)
    // and NOT "tu as acheté" (passé composé — handled by "as acheté" check below)
    pattern:
      /(?<!\p{L})(?<!\btu\s+as\s+)achète(?!\s+du\s+recul)(?!\s+du\s+dip)(?!\p{L})(?!\s+son)(?!\s+sa)(?!\s+leur)/iu,
  },
  {
    label: 'directive_vends',
    // Impératif "Vends l'EURUSD" ; PAS "il a vendu" (passé), PAS "vends-toi mieux"
    // / "tu te vends bien" (réfléchi métaphorique coaching).
    pattern:
      /(?<!\p{L})(?<!(?:a|as|avait|avez|ont|avaient|te|se|me|nous|vous)\s)vend[sz](?![-\s]*(?:toi|te|vous|nous))(?!\p{L})/iu,
  },
  {
    label: 'directive_buy_english',
    // "Buy the dip" / "Buy now" — English imperatives
    pattern: /(?<!\p{L})buy\s+(?:the\s+)?(?:dip|now|here|it|signal)(?!\p{L})/iu,
  },
  {
    label: 'directive_sell_english',
    // "Sell the rally" / "Sell now"
    pattern: /(?<!\p{L})sell\s+(?:the\s+)?(?:rally|now|here|it|signal)(?!\p{L})/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // B. TP / SL / objectif + number
  //
  // "TP 1.0850 puis trail" / "Stop-loss à 4250" / "Objectif à 1.20"
  // Distinguishes "objectif à 1.20" (price target) from
  // "objectif du mois" / "ton objectif : tenir" (coaching goal — no number).
  // ──────────────────────────────────────────────────────────────────────────

  {
    label: 'tp_price_target',
    // TP followed by a number (price level)
    pattern: /(?<!\p{L})tp\s*\d/iu,
  },
  {
    label: 'sl_price_target',
    // "Stop-loss à 4250" / "SL 1.0800" / "stop loss à 100"
    pattern: /(?<!\p{L})(?:stop[\s\-]?loss|sl)\s*(?:à\s*)?\d/iu,
  },
  {
    label: 'objectif_price_number',
    // "objectif à 1.20" / "objectif 1.20" — price number immediately after
    // but NOT "objectif du mois" / "ton objectif" (coaching, no number follows)
    pattern: /(?<!\p{L})objectif\s+à\s+\d/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // C. Support / résistance levels
  //
  // "Niveau de support à surveiller" / "Niveau de résistance à 1.10"
  // Must NOT flag "niveau de discipline" / "niveau de confiance" (coaching).
  // Anchored on the exact words "support" and "résistance" in a level context.
  // ──────────────────────────────────────────────────────────────────────────

  {
    label: 'support_level',
    // "niveau de support" / "zone de support" / "support à surveiller"
    pattern: /(?<!\p{L})(?:niveau|zone|seuil)\s+de\s+support(?!\p{L})/iu,
  },
  {
    label: 'resistance_level',
    // "niveau de résistance" / "résistance à 1.10"
    pattern: /(?<!\p{L})(?:niveau|zone|seuil)\s+de\s+r[eé]sistance(?!\p{L})/iu,
  },
  {
    label: 'resistance_at_price',
    // "résistance à 1.10" — standalone with price
    pattern: /(?<!\p{L})r[eé]sistance\s+à\s+\d/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // D. Price movement predictions
  //
  // "L'EURUSD va monter vers 1.15" / "Ça va descendre" / "Prévision haussière"
  // Must NOT flag "tes résultats vont s'améliorer" (coaching) —
  //   anchored on "va monter|descendre" (price verbs) and "prévision" keyword.
  // ──────────────────────────────────────────────────────────────────────────

  {
    label: 'price_will_rise',
    // "va monter" / "va remonter" — price movement prediction
    pattern: /(?<!\p{L})(?:ça|le\s+marché|les?\s+prix?)\s+va\s+(?:re)?monter(?!\p{L})/iu,
  },
  {
    label: 'price_will_fall',
    // "va descendre" / "va baisser" — price movement prediction
    pattern: /(?<!\p{L})(?:ça|le\s+marché|les?\s+prix?)\s+va\s+(?:descendre|baisser)(?!\p{L})/iu,
  },
  {
    label: 'prevision_directionnelle',
    // "prévision haussière sur le CAC" — capture the directional adjective
    pattern: /(?<!\p{L})pr[eé]vision\s+(?:haussi[eè]re|baissi[eè]re)(?!\p{L})/iu,
  },
  {
    label: 'va_monter_price_target',
    // "va monter vers 1.15" / "va remonter à 4300" — prédiction de niveau de prix.
    // PAS "ta confiance va monter" (aucun niveau → coaching légitime).
    pattern: /(?<!\p{L})va\s+(?:re)?monter\s+(?:vers|jusqu['']?\s*à|à)\s*\d/iu,
  },
  {
    label: 'va_descendre_price_target',
    // "va descendre vers 1.10" / "va baisser à 100" — prédiction de niveau de prix.
    // PAS "ton stress va descendre" (aucun niveau → coaching légitime).
    pattern: /(?<!\p{L})va\s+(?:descendre|baisser|chuter)\s+(?:vers|jusqu['']?\s*à|à)\s*\d/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // E. Breakout / cassure directionnelle
  //
  // "Le breakout haussier confirme" / "Cassure baissière imminente"
  // These are technical-analysis signal terms — any occurrence is AMF-violating.
  // ──────────────────────────────────────────────────────────────────────────

  {
    label: 'breakout',
    // "breakout" in any context (purely technical analysis term)
    pattern: /(?<!\p{L})breakout(?!\p{L})/iu,
  },
  {
    label: 'cassure_directionnelle',
    // "cassure haussière" / "cassure baissière" — directional breakout in FR
    pattern: /(?<!\p{L})cassure\s+(?:haussi[eè]re|baissi[eè]re|haussier|baissier)(?!\p{L})/iu,
  },
  {
    label: 'cassure_avec_instrument',
    // "Vends l'EURUSD à la cassure" — "cassure" in a trade directive context
    // (preceded or followed by instrument/action hints)
    pattern:
      /(?<!\p{L})(?:vend[sz]?|achète[sz]?|buy|sell)\s+.{0,40}?\s*à\s+la\s+cassure(?!\p{L})/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // F. Price targets "vers \d" in a market-movement context
  //
  // "va monter vers 1.15" — already caught by D; standalone "vers 1.15"
  // as a price target in a directional sentence.
  // ──────────────────────────────────────────────────────────────────────────
  {
    label: 'price_target_vers',
    // "vers 1.15" / "vers 4300" — price-level target (≥3 digit or decimal)
    // anchored: must be a decimal number (price format) not a date
    pattern: /(?<!\p{L})vers\s+\d+[.,]\d+(?!\p{L})/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // G. Vocabulaire d'analyse technique (FN fermés post-review §2).
  //    "tendance haussière" / "RSI survendu" / "retracement" / "tête-épaules" /
  //    "zone 1.0850". Ce sont des termes d'ANALYSE de marché → interdits §2.
  //    Patterns volontairement étroits pour éviter les FP coaching.
  // ──────────────────────────────────────────────────────────────────────────
  {
    label: 'tendance_directionnelle',
    // "tendance haussière/baissière" / "tendance est haussière" ; PAS "ta tendance à hésiter"
    pattern:
      /(?<!\p{L})tendance\s+(?:est\s+)?(?:haussi[eè]re|baissi[eè]re|haussier|baissier)(?!\p{L})/iu,
  },
  {
    label: 'indicateur_technique',
    pattern: /(?<!\p{L})(?:rsi|macd|stochastique|bollinger|ichimoku|fibonacci|fibo)(?!\p{L})/iu,
  },
  {
    label: 'survendu_surachete',
    pattern: /(?<!\p{L})(?:survendu|surachet[eé]|oversold|overbought)(?!\p{L})/iu,
  },
  {
    label: 'retracement_pullback',
    // termes d'analyse ; "point d'entrée" inclus (signal). PAS "entrer en position" (exécution).
    pattern: /(?<!\p{L})(?:retracement|pullback|point\s+d['']entr[eé]e)(?!\p{L})/iu,
  },
  {
    label: 'chart_pattern',
    pattern:
      /(?<!\p{L})(?:t[eê]te[\s-]?[eé]paules|double\s+(?:top|bottom|sommet|creux)|biseau|fanion|drapeau\s+(?:haussier|baissier))(?!\p{L})/iu,
  },
  {
    label: 'zone_prix',
    // "zone 1.0850" ; PAS "zone de confort" (zone + chiffre requis)
    pattern: /(?<!\p{L})zone\s+\d+(?:[.,]\d+)?(?!\p{L})/iu,
  },
];

// =============================================================================
// detectAMFViolation
// =============================================================================

/**
 * Detect AMF/CIF-violating content in an AI output text. Pure, side-effect free.
 *
 * Algorithm:
 *   1. NFC-normalize the input (bidi/zero-width strips already upstream via
 *      `safeFreeText`, but we add NFC as a safety net).
 *   2. For each pattern rule, test against the normalized text.
 *   3. Return `{ suspected: true, matchedLabels }` on any match, or
 *      `{ suspected: false, matchedLabels: [] }`.
 *
 * Edge cases:
 *   - Empty / null-ish input → `{ suspected: false, matchedLabels: [] }`.
 *   - Pure whitespace → same.
 *   - Mixed case → matched (regex flags `iu`).
 *   - Coaching text with ambiguous words (« long terme », « a vendu »,
 *     « objectif du mois », « niveau de discipline ») → NOT matched.
 *
 * Caller responsibility:
 *   - Concatenate ALL free-text fields of the AI output before calling.
 *   - Never log `matchedLabels` alongside the raw text (RGPD §16).
 */
export function detectAMFViolation(text: string | null | undefined): AMFViolationResult {
  if (text === null || text === undefined) {
    return { suspected: false, matchedLabels: [] };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { suspected: false, matchedLabels: [] };
  }
  // Defensive NFC; callers should already have applied safeFreeText().
  const normalized = trimmed.normalize('NFC');

  const matchedLabels: string[] = [];
  for (const rule of AMF_VIOLATION_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      matchedLabels.push(rule.label);
    }
  }

  return { suspected: matchedLabels.length > 0, matchedLabels };
}
