import type { MentalAxis } from './mental-map';

/**
 * S5 §32-C — pont entre les priorités d'onboarding du membre (texte LIBRE issu de
 * l'analyse Claude, `MemberProfile.axesPrioritaires`) et les quatre axes
 * psychologiques sur lesquels raisonne le moteur de coaching.
 *
 * WHY (brief §32-C / DoD §33.3). Le moteur doit exploiter le profil S2 du membre
 * RÉELLEMENT — pas seulement ses comportements/alertes. Les axes du profil sont du
 * texte libre ; le moteur raisonne sur un enum à 4 axes. Ce module est le seam
 * déterministe et testé entre les deux, pour que l'insight surfacé reflète ce que
 * le membre s'est lui-même fixé.
 *
 * 🛡️ §50 / §2 (BLOQUANT). On mappe le texte vers l'enum d'axe UNIQUEMENT ; le texte
 * libre AI-dérivé n'est JAMAIS retourné ni surfacé. Le moteur se sert de l'enum
 * obtenu pour (a) PRIORISER quel insight curé remonte (classement) et (b) ajouter
 * une trace d'alignement CURÉE — il ne rend jamais le texte libre du membre. Les
 * surfaces coaching restent donc sans `AIGeneratedBanner` (l'exemption §50 du
 * moteur déterministe est préservée) et le contexte des prompts S6 reste
 * injection-free. Contraste avec `objectives/coaching-axis.ts`, qui rend le texte
 * BRUT de l'axe et porte donc, lui, l'`AIGeneratedBanner` (§50).
 *
 * Pur (pas de `server-only`, pas de DB) ⇒ unit-testable en isolation. CALIBRÉ pour
 * la PRÉCISION plutôt que le rappel : seuls des mots-clés à forte confiance mappent ;
 * un axe ambigu est ABANDONNÉ (→ pas de personnalisation plutôt qu'une MAUVAISE
 * personnalisation). Mieux vaut silencieux que faux (calibrated refusal).
 */

/**
 * Mots-clés FR à forte confiance → axe mental. Comparés sur un texte normalisé
 * (sans accents, minuscule). L'ordre fixe sert de tie-break quand un même axe-texte
 * touche plusieurs groupes (le plus grave d'abord : honnêteté > ego > régularité >
 * discipline). Les termes ambigus (ex. « réel » seul, « perte ») sont volontairement
 * absents : un axe qu'ils seraient seuls à porter reste non mappé (0 fabrication).
 */
const AXIS_KEYWORDS: ReadonlyArray<readonly [MentalAxis, readonly string[]]> = [
  ['honesty', ['honnet', 'verite', 'sincer', 'mensonge', 'mentir', 'transparen']],
  [
    'ego',
    [
      'ego',
      'accept',
      'lacher prise',
      'lacher-prise',
      'controle de soi',
      'orgueil',
      'revanche',
      'fomo',
      'frustration',
      'emotion',
    ],
  ],
  [
    'consistency',
    ['regul', 'constan', 'routine', 'habitude', 'frequen', 'assidu', 'quotidien', 'chaque jour'],
  ],
  [
    'discipline',
    [
      'disciplin',
      'rigueur',
      'tenir mon plan',
      'respecter mon plan',
      'suivre mon plan',
      'plan de trading',
      'patience',
      'process',
      'regle',
      'methode',
    ],
  ],
];

/** Replie un libellé : décompose les accents (NFD) puis retire les diacritiques. */
function fold(value: string): string {
  let folded = '';
  for (const char of value.normalize('NFD')) {
    const code = char.codePointAt(0) ?? 0;
    // Retire les diacritiques combinants (U+0300 a U+036F) : 'e accent' -> 'e'.
    if (code >= 0x0300 && code <= 0x036f) continue;
    folded += char;
  }
  return folded.toLowerCase();
}

/**
 * Classe les priorités d'onboarding (déjà nettoyées par `coerceAxes`) en axes
 * mentaux. Déduplique en conservant l'ordre de première apparition. Retourne `[]`
 * si rien ne mappe (jamais un axe inventé). Les 4 axes possibles bornent la sortie.
 */
export function classifyPriorityAxes(axes: readonly string[]): MentalAxis[] {
  const result: MentalAxis[] = [];
  for (const raw of axes) {
    const haystack = fold(raw);
    for (const [axis, keywords] of AXIS_KEYWORDS) {
      if (keywords.some((keyword) => haystack.includes(keyword))) {
        if (!result.includes(axis)) result.push(axis);
        break; // premier groupe qui matche → cet axe-texte est classé
      }
    }
  }
  return result;
}
