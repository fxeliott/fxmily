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
 * CALIBRATION — matrice de tests (Session 4 + S5 hardening, TDD):
 *   Must flag  : directional imperatives (LONG/SHORT/BUY/SELL in trade context),
 *                TP/SL/objectif + number, support/resistance levels, monter/
 *                descendre price predictions, breakout calls, price targets,
 *                "Short le Nasdaq", "Long le DAX", "Reste long tant que…",
 *                "Place ton take profit à 1.0850", "Vise les 1.15", "Cible 1.09",
 *                "biais haussier/baissier", "Le support se situe autour de…",
 *                "Le prix cassera la zone des 4300", "shorter le DAX".
 *   Must NOT flag: "long terme" temporel, coaching psychology, "a vendu" past,
 *                  "objectif du mois" coaching goal, "niveau de discipline",
 *                  "confiance plus longue", "stress descendu", "vont s'améliorer",
 *                  "« ça va monter »" (cité), "il pense que ça va monter" (rapporté),
 *                  "zone 2 d'effort", "zone 3 de RPE", "zone de confort".
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

// -----------------------------------------------------------------------------
// Instrument WHITELIST (S5 14e challenge — instrument-anchored detection).
//
// High-precision, proper-noun-ish market tokens. Anchoring direction/level
// patterns on a NAMED instrument is the FP-safe path the integer-level residual
// (`price_target_vers`) flagged as the only viable closure ("whitelist
// d'instruments") — a legitimate coaching sentence never names EURUSD/DAX/SP500
// + a direction. Deliberately EXCLUDES bare "or" (conjonction) and "argent"
// (argent = monnaie en coaching) — only the unambiguous "l'or" gold form.
// Covers : forex majors, EU/US/Asia indices, crypto, commodities.
// -----------------------------------------------------------------------------
const INSTRUMENT_TOKEN = String.raw`(?:eur[\/]?usd|gbp[\/]?usd|usd[\/]?jpy|usd[\/]?chf|usd[\/]?cad|aud[\/]?usd|nzd[\/]?usd|eur[\/]?gbp|eur[\/]?jpy|gbp[\/]?jpy|xau[\/]?usd|dax(?:\s?40)?|cac(?:\s?40)?|nasdaq|nikkei|footsie|ftse|russell|dow(?:\s+jones)?|sp\s?500|s&p\s?500|bitcoin|btc|ethereum|eth|p[ée]trole|brent|wti|l['’]or)`;

// Directional verb/adjective IMMEDIATELY bound to the instrument token (a market
// prediction). The strict adjacency is what keeps it FP-safe : "l'EURUSD va
// monter" flags, but "tu as tradé l'EURUSD, ta discipline va monter" does NOT
// (the direction sits after "discipline", not the instrument).
const DIR_AFTER_INSTRUMENT = String.raw`(?:va\s+(?:re)?(?:monter|descendre|baisser|chuter|grimper|plonger|rebondir|repartir|reculer|d[ée]coller|exploser|corriger|acc[éèe]l[éèe]rer|red[ée]marrer|d[ée]visser|flamber|s['’]envoler|s['’]effondrer)|(?:re)?(?:monte|descend|baisse|chute|grimpe|plonge|rebondit|recule|d[ée]colle|explose|acc[éèe]l[éèe]re|repart|red[ée]marre|d[ée]visse|flambe)|s['’](?:envole|effondre)|(?:est|reste|devient|redevient|semble|para[iî]t)\s+(?:haussi[eè]re?|baissi[eè]re?|haussier|baissier|bullish|bearish)|[àa]\s+la\s+(?:hausse|baisse))`;

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
    label: 'directive_positions_directionnelles',
    // "Garde tes positions longues sur le DAX" — plural form missed by long_instrument
    pattern: /(?<!\p{L})positions?\s+(?:longues?|courtes?)\s+sur\b/iu,
  },
  {
    label: 'directive_acheteur_vendeur',
    // "Passe acheteur sur l'or" / "reste vendeur" / "acheteur sur l'EURUSD"
    // Position directive via acheteur/vendeur (not in the imperatif patterns).
    // S5 12e challenge (E3) : formes FÉMININES "acheteuse"/"vendeuse" attrapées dans
    //   les MÊMES contextes que le masculin : "passe/reste/deviens/sois acheteuse" OU
    //   "acheteuse sur l'<instrument>" ("reste acheteuse sur le DAX", "je suis vendeuse
    //   sur l'or"). "position acheteuse" seul (sans verbe ni "sur l'") reste non capté
    //   (résiduel backstop) — avant, masculin seul (FN sur le féminin).
    pattern:
      /(?<!\p{L})(?:(?:passe[sz]?|reste[sz]?|deviens?|sois)\s+(?:acheteu(?:r|se)|vendeu(?:r|se))|(?:acheteu(?:r|se)|vendeu(?:r|se))\s+sur\s+l)/iu,
  },
  {
    label: 'directive_long_short_instrument',
    // "Short le Nasdaq immédiatement" / "Long le DAX dès l'ouverture"
    // Protect: "long terme" (neg lookahead), "longue/longtemps" (boundary),
    //   and the "le long de/du/des <X>" / "au long de" idioms (le/du/au lookbehinds
    //   + connector excludes du/des → "le long du chemin" PASSES).
    pattern:
      /(?<!\p{L})(?<!au\s)(?<!le\s)(?<!du\s)(?:long|short)(?!\s+terme)(?!\p{L})\s+(?:(?:le|la|les|un|une)\s+\p{L}|l[''’]\p{L})/iu,
  },
  {
    label: 'directive_reste_long_short',
    // "Reste long tant que la tendance le permet" / "Reste short sur le DAX"
    // Anchored on a TRADE context after long/short (sur / tant que / en position /
    // jusqu) so coaching "le chemin reste long", "ça reste long à faire" PASS.
    pattern: /(?<!\p{L})reste[sz]?\s+(?:long|short)\s+(?:sur\s|tant\s+que\s|en\s+position|jusqu)/iu,
  },
  {
    label: 'directive_shorter_instrument',
    // "shorter le DAX" / "Je te conseille de shorter"
    pattern: /(?<!\p{L})short(?:e[rz]?|ez)(?!\p{L})/iu,
  },
  {
    label: 'directive_prends_un_short',
    // "Prends un short sur le Nasdaq"
    pattern: /(?<!\p{L})prends\s+un\s+short(?!\p{L})/iu,
  },
  {
    label: 'directive_conseille_trade',
    // "Je te conseille de shorter / short / long le DAX" — directional only.
    // EXCLUT acheter/vendre/prendre (FP: "conseille de prendre du recul/ton temps").
    pattern: /(?<!\p{L})conseille[sz]?\s+de\s+(?:shorter|short|long)(?!\p{L})/iu,
  },
  {
    label: 'directive_place_tp_sl',
    // "Place ton take profit à 1.0850" / "Place ton stop loss à 4200"
    pattern:
      /(?<!\p{L})place[sz]?\s+(?:ton|votre|ta|le|la)\s+(?:take\s+profit|stop[\s-]?loss|tp|sl)(?!\p{L})/iu,
  },
  {
    label: 'directive_vise_prix',
    // "Vise les 1.15 sur la paire" — PRICE format only (>=4 digits OR >=2 decimals)
    // so "vise les 3 sessions" / "vise les 100%" (coaching goals) AND "vise les
    // 1.5R" / "vise les 2.0 de ratio" (risk-multiple sizing = coaching) PASS.
    pattern: /(?<!\p{L})vise[sz]?\s+les\s+(?:\d{4,}|\d+[.,]\d{2,})/iu,
  },
  {
    label: 'directive_cible_prix',
    // "Cible 1.0900 ce matin"
    pattern: /(?<!\p{L})cible\s+\d+[.,]\d/iu,
  },
  {
    label: 'biais_directionnel',
    // "Le biais reste haussier sur le DAX" / "Privilégie un biais haussier cette semaine"
    pattern:
      /(?<!\p{L})(?:biais\s+(?:reste\s+|est\s+)?|privil[eé]gi[ez]+\s+(?:un|le)\s+biais\s+)(?:haussi[eè]re?|baissi[eè]re?|haussier|baissier)(?!\p{L})/iu,
  },
  {
    label: 'support_standalone',
    // "Le support se situe autour de 1.0850" — bare "support" + level construct
    // ANCHORED on a price-format number (decimal OR >=4 digits) so coaching
    // "ton support se situe dans ta routine" / "le support de tes proches" PASS.
    // ("Le prix cassera la zone des 4300" is caught by zone_prix below — no need
    //  for a dedicated cassure pattern, which would FP on "casser une habitude".)
    pattern:
      /(?<!\p{L})(?<!de\s)support\s+(?:se\s+situe|est|à|autour|vers)[^.]{0,20}?(?:\d{4,}|\d+[.,]\d+)/iu,
  },
  {
    label: 'directive_imperative_achetez',
    // "Achetez maintenant" — vous-imperative unambiguous
    pattern: /(?<!\p{L})achetez(?!\p{L})/iu,
  },
  {
    label: 'directive_imperative_achete',
    // Impératif "Achète" ; PAS "achète du recul/dip" (métaphore), "t'/m'/l'achète"
    // (datif figuré), ni "achète-toi/vous/nous/moi un carnet/du temps" (impératif
    // pronominal réfléchi = coaching). "achète-le/la/les" reste flaggé (directionnel).
    pattern:
      /(?<!\p{L})(?<!['‘’])(?<!\btu\s+as\s+)achète(?!-(?:toi|vous|nous|moi))(?!\s+du\s+recul)(?!\s+du\s+dip)(?!\p{L})(?!\s+son)(?!\s+sa)(?!\s+leur)/iu,
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
    // "Buy the dip" / "Buy now" — English imperatives.
    // CARVE-OUT (S5 10e challenge — D1-F3) : une directive anglaise CITÉE & CLOSE
    //   (« buy now », l'histoire 'buy now') = pédagogie Douglas qui NOMME l'impulsion.
    //   Le carve exige un guillemet FERMANT juste après l'impulsion courte — un simple
    //   guillemet ouvrant ne suffit pas (re-review adverse : "« buy the dip sur
    //   l'EURUSD" sans fermeture = vrai ordre → FLAG). L'instrument qui suit casse
    //   l'enclosure donc reste détecté.
    pattern: new RegExp(
      String.raw`(?<!\p{L})buy\s+(?:the\s+)?(?:dip|now|here|it|signal)(?!\s*[»”’›"'])(?!\p{L})`,
      'iu',
    ),
  },
  {
    label: 'directive_sell_english',
    // "Sell the rally" / "Sell now" — voir D1-F3 (carve = impulsion citée ET close).
    pattern: new RegExp(
      String.raw`(?<!\p{L})sell\s+(?:the\s+)?(?:rally|now|here|it|signal)(?!\s*[»”’›"'])(?!\p{L})`,
      'iu',
    ),
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
    // "TP 1.0850" / "TP 4250" niveau de prix ; PAS "TP1"/"TP2" (labels de discipline collés, sans prix)
    pattern: /(?<!\p{L})tp\s*\d+[.,]\d|(?<!\p{L})tp\s+\d+/iu,
  },
  {
    label: 'sl_price_target',
    // "Stop-loss à 4250" / "SL 1.0800" / "stop loss à 100"
    pattern: /(?<!\p{L})(?:stop[\s\-]?loss|sl)\s*(?:à\s*)?\d/iu,
  },
  {
    label: 'objectif_price_number',
    // "objectif à 1.20" — prix Forex décimal. PAS "objectif du mois"/"ton objectif"
    //   (pas de nombre), PAS "objectif à 100%" (entier+%, coaching). S5 12e challenge :
    //   décimale uniquement → supprime le FP latent "objectif à 100% de respect" (avant
    //   `à \d` le flaggait) ; les niveaux ENTIERS d'indice passent par price_level_instrument.
    pattern: /(?<!\p{L})objectif\s+à\s+\d+[.,]\d+/iu,
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
    // “le marché va monter” prédiction ; PAS cité entre guillemets (piège pédagogique Mark Douglas)
    // ni dans discours rapporté introduit par “que” (ex: “je pense que ça va monter”).
    // Variable-length lookbehind handles “« ça va monter »” (char before ça = space after «).
    // U+00AB=«  U+201C/D=curly-double  U+2018/9=curly-single  U+2039=‹  U+0022=”  U+0027=’
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?<!(?:[«“‘‹”‹›’"])\s*)(?<!que\s)(?:ça|le\s+marché|les?\s+prix?)\s+va\s+(?:re)?monter(?!\p{L})`,
      'iu',
    ),
  },
  {
    label: 'price_will_fall',
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?<!(?:[«“‘‹”‹›’"])\s*)(?<!que\s)(?:ça|le\s+marché|les?\s+prix?)\s+va\s+(?:descendre|baisser)(?!\p{L})`,
      'iu',
    ),
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
    // anchored: must be a decimal number (price format) not a date.
    // CARVE-OUT (S5 10e challenge — D1-F1) : "vers 1.00%" / "vers 1.5% de risque" /
    //   "vers 2.0R" / "vers 1.0 de risque" = coaching de TAILLE/risque (§2 autorise
    //   explicitement le coaching d'exécution/size) → NE PAS flag. Le suffixe
    //   %/R/unité-de-risque distingue un % de risque d'un prix Forex/indice. Sans ce
    //   carve-out, un FP skip silencieusement TOUT le débrief mensuel (batch.ts).
    // Le carve (lookahead EN TÊTE, avant de consommer le nombre) ne s'active QUE
    //   si le nombre est *risk-shaped* : 1-3 chiffres entiers + 1-2 décimales +
    //   suffixe %/R/unité-de-risque ("1.00%", "1.5% de risque", "2.00R"). Un prix
    //   Forex (1.0850 = 4 déc.) ou indice (4300) N'EST PAS risk-shaped → reste flag
    //   même suivi d'un token parasite ("vers 1.0850 de risque" → FLAG, anti-FN
    //   re-review adverse). Sans le test de forme, le carve neutralisait tout prix.
    // Décimale Forex uniquement (1.0850). S5 12e challenge : les niveaux ENTIERS
    //   d'indice nus ("vers 18250") restent un RÉSIDUEL BACKSTOP ASSUMÉ — 2 tentatives
    //   de les capter (entier nu, puis "entier + sur le <X>" avec blacklist d'idiomes)
    //   ont chacune réintroduit un FP TIER1 (tout nombre coaching ≥4 chiffres : 10000 €,
    //   1000 trades, "5000 sur la bonne voie" skippaient un débrief légitime). Une regex
    //   ne distingue pas un niveau d'indice d'un montant/compte coaching sans whitelist
    //   d'instruments. Stop-loss (CLAUDE.md) → revert. Contrôle primaire = system prompt
    //   §2 (vérifié : interdit explicitement d'analyser le marché). Résiduel rejoint les
    //   FN assumés (conditionnel, synonymes). Future option : whitelist d'instruments.
    pattern:
      /(?<!\p{L})vers\s+(?!\d{1,3}[.,]\d{1,2}\s*(?:%|[rR]\b|de\s+(?:risque|gain|perte|capital|marge)|(?:ta|ton|sa|son|votre)\s+(?:taille|risque|marge)))\d+[.,]\d+(?!\p{L})/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // G. Vocabulaire d'analyse technique (FN fermés post-review §2).
  //    "tendance haussière" / "RSI survendu" / "retracement" / "tête-épaules" /
  //    "zone 1.0850". Ce sont des termes d'ANALYSE de marché → interdits §2.
  //    Patterns volontairement étroits pour éviter les FP coaching.
  // ──────────────────────────────────────────────────────────────────────────
  {
    label: 'tendance_directionnelle',
    // "tendance haussière/baissière" (marché) → flag ; PAS "ta tendance à hésiter".
    // CARVE-OUT (S5 10e challenge — D1-F2) : la tendance d'un attribut PSY/comportemental
    //   (discipline / régularité / constance / progression / confiance / motivation /
    //   exécution) = coaching légitime. Le prompt mensuel raisonne explicitement sur
    //   `disciplineTrend` ; "ta discipline est sur une tendance haussière" est §2-conforme.
    //   Lookbehind possessif-personne ("ta/ton/sa…") + lookahead sujet-psy carvent ces cas
    //   sans relâcher "la tendance est haussière sur le DAX" (qui flag toujours).
    // Carve UNIQUEMENT le génitif psy IMMÉDIAT "tendance haussière de ta discipline"
    //   (sujet psy directement après l'adjectif). La lookbehind variable précédente
    //   sur-carvait : un mot psy n'importe où dans 40 chars avant désactivait la
    //   détection marché ("Côté discipline, la tendance est haussière sur le DAX" →
    //   FN). "La tendance est haussière sur le DAX" flag toujours (re-review adverse).
    //   Le cas rare "ta discipline est sur une tendance haussière" reste FP-flag
    //   (côté sûr du budget §2 ; le system prompt steere Claude vers "amélioration").
    //   Carve restreint au POSSESSIF-PERSONNE ("de ta discipline") — pas l'article
    //   générique ("de la discipline du Nasdaq" reste FLAG, anti-game re-review).
    //   S5 12e challenge (E2) : adverbe intercalé ("tendance RESTE/DEMEURE/DEVIENT
    //   haussière") attrapé — avant, seul "tendance (est) haussière" matchait, "reste"
    //   cassait la détection marché (FN reel).
    pattern:
      /(?<!\p{L})tendance\s+(?:(?:est|reste|demeure|devient|redevient|semble|para[iî]t)\s+)?(?:haussi[eè]re|baissi[eè]re|haussier|baissier)(?!\s+(?:de\s+)?(?:ta|ton|tes|sa|ses|ma|mon|mes|votre|vos|notre|nos)\s+(?:discipline|r[eé]gularit[eé]|constance|progression|confiance|motivation|ex[eé]cution|gestion|mental))(?!\p{L})/iu,
  },
  {
    label: 'retournement_directionnel',
    // "un retournement haussier dès cet après-midi" ; PAS "un retournement de situation"
    pattern:
      /(?<!\p{L})retournement\s+(?:haussi[eè]re?|baissi[eè]re?|haussier|baissier)(?!\p{L})/iu,
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
    // "zone 1.0850" / "zone des 4300" — price-format anchor (decimal OR ≥4 digits).
    // PAS "zone de confort" (no digit), PAS "zone 2 d'effort" / "zone 3 de RPE"
    //   (single digit ≤3 = effort/RPE level, not a Forex/index price).
    // GARDE: "zone 1.0850" → flag (decimal) ; "zone 4300" → flag (≥4 digits).
    pattern: /(?<!\p{L})zone\s+(?:des?\s+)?(?:\d{4,}|\d+[.,]\d+)(?!\p{L})/iu,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // H. Instrument-anchored directional / position / level (S5 14e challenge).
  //
  // Red-team runtime (14e challenge) a montré des FN réels que le backstop
  // ratait : "EURUSD va monter, garde tes longs", "Augmente ta position sur le
  // SP500, ça va repartir à la hausse", "Place ton stop sous 1.0820, vise
  // 1.0950". Le contrôle PRIMAIRE (system prompt §2) les interdit déjà ; ces
  // patterns durcissent le BACKSTOP via la WHITELIST d'instruments — la seule
  // approche FP-safe (cf. note `price_target_vers` : un nombre/idiome sur lexique
  // ouvert = FP TIER1, mais un instrument NOMMÉ + direction = violation §2 non
  // ambiguë). Adjacence stricte instrument↔direction = pas de FP coaching.
  // ──────────────────────────────────────────────────────────────────────────
  {
    label: 'instrument_directional',
    // "EURUSD va monter" / "le DAX est haussier" / "bitcoin chute" / "le Nasdaq
    // grimpe". L'instrument est IMMÉDIATEMENT suivi (≤séparateur , /espace) d'un
    // verbe/adjectif directionnel → prédiction de marché. PAS "tu as tradé
    // l'EURUSD, ta discipline va monter" (direction après "discipline", pas
    // après l'instrument). PAS "Seth monte" ("eth" non borné).
    pattern: new RegExp(
      String.raw`(?<!\p{L})${INSTRUMENT_TOKEN}(?!\p{L})[\s,]+${DIR_AFTER_INSTRUMENT}`,
      'iu',
    ),
  },
  {
    label: 'directive_position_instrument',
    // "Augmente ta position sur le SP500" / "garde ta position sur le DAX" —
    // recommandation d'exposition sur un instrument NOMMÉ. PAS "ta position sur
    // le plan / le marché / le risque" (non-instruments).
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?:positions?|exposition)\s+(?:\p{L}+['’]?\s+){0,2}?sur\s+(?:l[ea]\s+|l['’]\s*|du\s+|des\s+|un\s+|une\s+)?${INSTRUMENT_TOKEN}(?!\p{L})`,
      'iu',
    ),
  },
  {
    label: 'directive_stop_level',
    // "Place ton stop sous 1.0820" / "ton stop à 4250" — niveau de stop chiffré
    // (prix Forex décimal OU entier ≥4 chiffres). Complète `sl_price_target` qui
    // exige "stop-loss"/"sl" littéral. PAS "ton stop à 2 minutes" (pas un prix),
    // PAS "le stop de la perte" ("de" ∉ prépositions de niveau).
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?:ton|ta|votre|vos|le|la|mon|ma|son|sa)\s+stops?\s+(?:à|sous|vers|au[\s-]?dessus|en[\s-]?dessous|au[\s-]?dessous)(?:\s+de)?\s*(?:\d{4,}|\d+[.,]\d+)(?!\p{L})`,
      'iu',
    ),
  },
  {
    label: 'vise_price_decimal',
    // "vise 1.0950" (≥3 décimales = prix Forex) — complète `directive_vise_prix`
    // qui exige "vise LES". Les ratios coaching (1.5R, 2.0, 1.50 de RR) ont ≤2
    // décimales → PASS ; ≥3 décimales = format prix non ambigu.
    pattern: /(?<!\p{L})vise[sz]?\s+\d+[.,]\d{3,}(?!\p{L})/iu,
  },
  {
    label: 'directional_adj_instrument',
    // Ordre INVERSÉ direction→instrument : "Haussier sur le DAX" / "Bearish sur
    // l'EURUSD" (Pattern A exige instrument PUIS direction). Adjectif marché +
    // "sur" + instrument NOMMÉ = avis directionnel. Restreint à haussier/baissier/
    // bullish/bearish (PAS "positif/optimiste" = FP coaching).
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?:haussi[eè]re?|baissi[eè]re?|haussier|baissier|bullish|bearish)\s+sur\s+(?:l[ea]\s+|l['’]\s*|le\s+|du\s+|des\s+)?${INSTRUMENT_TOKEN}(?!\p{L})`,
      'iu',
    ),
  },
  {
    label: 'cible_objectif_instrument',
    // "cible/objectif sur <instrument> à/: /est à <prix>" : "Mets ta cible sur
    // l'EURUSD à 1.0950", "Objectif sur le DAX : 18250". L'ancre INSTRUMENT rend
    // FP-safe la capture d'un niveau ENTIER nu (résiduel bare-level) quand un
    // instrument est nommé. PAS "ton objectif sur le DAX : rester calme" (pas de
    // chiffre après à/:/vers).
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?:cible|objectif)\s+(?:\p{L}+['’]?\s+){0,3}?sur\s+(?:l[ea]\s+|l['’]\s*|le\s+|du\s+|des\s+)?${INSTRUMENT_TOKEN}(?!\p{L})[^.]{0,20}?(?:[àa]|:|vers)\s*\d`,
      'iu',
    ),
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
