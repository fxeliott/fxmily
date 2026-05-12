/**
 * V1.7 prep DORMANT — Crisis routing French detection (SPEC §18.2 safety).
 *
 * Pure detection layer for surfaced mental-health signals in member free-text
 * (journal notes, intentions, gratitude items) AND post-output Claude content.
 * Returns a severity level + matched patterns. Never blocks user input ;
 * caller decides response (banner, resource list, escalation).
 *
 * Posture (Round 4 trading expert + Anthropic LIVE researcher) :
 *   - **Over-trigger on the safety side** : false positives are acceptable
 *     (a member sees an unneeded resource banner). False negatives are not.
 *   - **Trading slang exclusions** : "tout perdre sur ce trade" (capital ≠
 *     life), "killer ce setup" (jargon), "tuer ma position" (jargon),
 *     "en finir avec ça" (often "arrêter de trader"), "dépression du
 *     marché" (financial term). These do NOT trigger.
 *   - **Never anthropomorphize** the LLM in resource copy ; the goal is to
 *     surface human crisis lines (3114 + SOS Amitié + Suicide Écoute).
 *   - **No LLM-driven detection** : 2026 Scientific Reports paper confirms
 *     commercial LLMs are NOT safe on suicidal ideation without a dedicated
 *     layer. Regex deterministic + low false-negative rate is mandatory.
 *
 * V1.7 wiring map (NOT included in this file) :
 *   1. `lib/weekly-report/claude-client.ts` LiveWeeklyReportClient.generate()
 *      — call detectCrisis() on output BEFORE persisting. If level >= medium,
 *      abort the generation, audit `safety.crisis_detected`, escalate to
 *      Eliot via email + Sentry, fall back to a static "we noticed something"
 *      reply with the resource block.
 *   2. `app/checkin/actions.ts` submitMorning/EveningCheckinAction —
 *      call detectCrisis() on `journalNote` + `intention` + `gratitudeItems`
 *      before persisting. Add a non-blocking banner on the redirect target.
 *   3. `app/journal/actions.ts` createTradeAction — call detectCrisis() on
 *      the `notes` field (post-exit), same banner treatment.
 *
 * Audit slug reserved for V1.7 : `safety.crisis_detected` with metadata
 * `{ level, matchedKeywordCount, source: 'checkin'|'trade'|'weekly_report' }`.
 * NEVER log the matched text content (RGPD §16 + safeFreeText hardening).
 *
 * References :
 *   - Numéro national 3114 (CHU Lille, Min. Santé, 24/7) — primary route
 *   - SOS Amitié 09 72 39 40 50 (24/7)
 *   - Suicide Écoute 01 45 39 40 00 (24/7)
 *   - Scientific Reports 2026 — LLM suicide ideation safety paper
 */

export type CrisisLevel = 'high' | 'medium' | 'low' | 'none';

export interface CrisisMatch {
  /** Canonical label for the matched pattern (logged in audit, never raw text). */
  label: string;
  /** Detected level. */
  level: 'high' | 'medium' | 'low';
}

export interface CrisisDetection {
  /** Highest level detected, or 'none' if no matches OR only false positives. */
  level: CrisisLevel;
  /** All matches that survived false-positive filtering. */
  matches: CrisisMatch[];
}

interface PatternRule {
  label: string;
  pattern: RegExp;
  level: 'high' | 'medium' | 'low';
}

// IMPORTANT — JS regex `\b` is ASCII-only even with the `u` flag : it matches
// at transitions between ASCII word chars `[A-Za-z0-9_]` and everything else.
// So `\bdésespéré\b` FAILS because `é` is NOT in `\w` — there's no boundary
// at the end of the word.
//
// Fix : use unicode-aware boundaries via lookarounds on the `\p{L}` letter
// class (requires the `u` flag). `(?<!\p{L})` and `(?!\p{L})` together act
// like a unicode-aware `\b` and let us match accented FR words safely.

// HIGH severity — explicit suicidal ideation. Triggers immediate resource
// surfacing and admin escalation in V1.7 wiring.
const HIGH_PATTERNS: PatternRule[] = [
  { label: 'suicide', pattern: /(?<!\p{L})suicide(?!\p{L})/iu, level: 'high' },
  { label: 'me_suicider', pattern: /(?<!\p{L})me\s+suicider(?!\p{L})/iu, level: 'high' },
  // "en finir" but NOT "en finir avec ça" (often "arrêter de trader")
  {
    label: 'en_finir',
    pattern: /(?<!\p{L})en\s+finir(?!\p{L})(?!\s+avec\s+ça)/iu,
    level: 'high',
  },
  // "(me) tuer" but NOT inside trading jargon "tuer ma/le/la position|trade|setup|stop|tp|sl"
  {
    label: 'me_tuer',
    pattern:
      /(?<!\p{L})(?:me\s+)?tuer(?!\p{L})(?!\s+(?:ma|mon|cette|le|la)\s+(?:position|trade|setup|stop|tp|sl))/iu,
    level: 'high',
  },
  { label: 'me_pendre', pattern: /(?<!\p{L})(?:me\s+)?pendre(?!\p{L})/iu, level: 'high' },
  {
    label: 'sauter_du',
    pattern: /(?<!\p{L})sauter\s+du\s+(?:pont|toit|balcon|hauteur)(?!\p{L})/iu,
    level: 'high',
  },
  {
    label: 'passer_a_l_acte',
    pattern: /(?<!\p{L})passer\s+à\s+l['']acte(?!\p{L})/iu,
    level: 'high',
  },
];

// MEDIUM severity — distress signals warranting a non-blocking banner.
const MEDIUM_PATTERNS: PatternRule[] = [
  // "tout perdre" but NOT "tout perdre sur ce trade" / "tout perdre mon capital"
  {
    label: 'tout_perdre',
    pattern: /(?<!\p{L})tout\s+perdre(?!\p{L})(?!\s+sur\s+ce\s+trade)(?!\s+mon\s+capital)/iu,
    level: 'medium',
  },
  { label: 'desespere', pattern: /(?<!\p{L})désespér[ée]+s?(?!\p{L})/iu, level: 'medium' },
  { label: 'plus_envie', pattern: /(?<!\p{L})plus\s+envie(?!\p{L})/iu, level: 'medium' },
  { label: 'a_quoi_bon', pattern: /(?<!\p{L})à\s+quoi\s+bon(?!\p{L})/iu, level: 'medium' },
  {
    label: 'abandonner_ma_vie',
    pattern: /(?<!\p{L})abandonner\s+ma\s+vie(?!\p{L})/iu,
    level: 'medium',
  },
];

// LOW severity — emotional fatigue signals. Logged, no banner surfaced (avoid
// over-triggering on common burnout language).
const LOW_PATTERNS: PatternRule[] = [
  // "dépression" but NOT "dépression du marché" (financial term)
  {
    label: 'depression',
    pattern: /(?<!\p{L})dépression(?!\p{L})(?!\s+du\s+marché)/iu,
    level: 'low',
  },
  { label: 'deprime', pattern: /(?<!\p{L})déprim[ée]+s?(?!\p{L})/iu, level: 'low' },
  { label: 'epuise', pattern: /(?<!\p{L})épuis[ée]+s?(?!\p{L})/iu, level: 'low' },
];

const ALL_RULES = [...HIGH_PATTERNS, ...MEDIUM_PATTERNS, ...LOW_PATTERNS];

/**
 * Detect crisis signals in a free-text string. Pure, side-effect free.
 *
 * Algorithm :
 *   1. NFC-normalize the input (handles bidi/zero-width strips upstream).
 *   2. For each pattern rule, test against the normalized text.
 *   3. Return the HIGHEST level matched, plus the canonical labels (never
 *      the raw text content — caller logs the labels for audit).
 *
 * Edge cases :
 *   - Empty / null-ish input → `{ level: 'none', matches: [] }`.
 *   - Pure whitespace → `{ level: 'none', matches: [] }`.
 *   - Mixed case → matched (regex flags `iu`).
 *   - Trading slang patterns (`tuer ma position`, etc.) → suppressed by
 *     negative lookaheads in the HIGH rules.
 *
 * Tested in `crisis-detection.test.ts` (15+ TDD cases covering FP exclusions).
 */
export function detectCrisis(text: string | null | undefined): CrisisDetection {
  if (text === null || text === undefined) {
    return { level: 'none', matches: [] };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { level: 'none', matches: [] };
  }
  // Defensive NFC ; callers should already have applied safeFreeText().
  const normalized = trimmed.normalize('NFC');

  const matches: CrisisMatch[] = [];
  for (const rule of ALL_RULES) {
    if (rule.pattern.test(normalized)) {
      matches.push({ label: rule.label, level: rule.level });
    }
  }

  if (matches.length === 0) {
    return { level: 'none', matches: [] };
  }
  // Highest level wins.
  if (matches.some((m) => m.level === 'high')) {
    return { level: 'high', matches };
  }
  if (matches.some((m) => m.level === 'medium')) {
    return { level: 'medium', matches };
  }
  return { level: 'low', matches };
}

// =============================================================================
// FR crisis resources — surfaced to the member in V1.7 banner.
// =============================================================================

export interface CrisisResource {
  /** Display name (FR). */
  name: string;
  /** Phone number (digits only, for `tel:` URI). */
  phone: string;
  /** Hours of availability. */
  hours: string;
  /** One-line description. */
  description: string;
}

/**
 * V1.7 banner resources. Numbers verified 2026-05-12 via Round 4 trading
 * expert + Anthropic LIVE researcher. All free, 24/7, FR.
 */
export const CRISIS_RESOURCES_FR: readonly CrisisResource[] = Object.freeze([
  {
    name: '3114',
    phone: '3114',
    hours: '24/7',
    description: 'Numéro national de prévention du suicide (gratuit)',
  },
  {
    name: 'SOS Amitié',
    phone: '0972394050',
    hours: '24/7',
    description: 'Écoute anonyme par téléphone',
  },
  {
    name: 'Suicide Écoute',
    phone: '0145394000',
    hours: '24/7',
    description: 'Écoute, soutien, orientation',
  },
]);

/**
 * Return the recommended resources for a detected level. V1.7 banner
 * displays these inline. NONE level returns empty (no banner).
 */
export function getCrisisResources(level: CrisisLevel): readonly CrisisResource[] {
  if (level === 'high' || level === 'medium') {
    return CRISIS_RESOURCES_FR;
  }
  return [];
}
