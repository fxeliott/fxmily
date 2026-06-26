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
 * Pur (pas de `server-only`, pas de DB) ⇒ unit-testable en isolation.
 *
 * ⚖️ CALIBRATION = RAPPEL (re-calibré au 2e re-challenge S5). Les VRAIS
 * `axes_prioritaires` ne sont PAS des mots-clés courts : le prompt d'onboarding
 * (`onboarding-interview/prompt.ts`) impose des phrases ACTION-CONCRÈTE ≤200 chars
 * référençant des citations [N] et des concepts Mark Douglas (ex. « Travailler le
 * détachement du target — la peur de voir le marché repartir [8] »). Un vocabulaire
 * trop maigre rendait la feature INERTE sur les vrais profils (5/9 axes few-shot →
 * `[]`) — d'où un lexique riche, fidèle au vocabulaire psy-trading FR de Douglas.
 * Le coût d'un FAUX NÉGATIF (axe non mappé) = violation du brief §32-C (« exploite
 * réellement le profil ») ; le coût d'un FAUX POSITIF est BORNÉ par construction
 * (`PRIORITY_BOOST < 1` ne franchit jamais une tonalité ni ne renverse une gravité
 * curée distincte — il départage au pire deux entrées de MÊME poids). On privilégie
 * donc le rappel. Le filet `[]` (0 fabrication) ne se déclenche plus que sur du
 * NON-psy (méta-instructions, hors-sujet), pas sur du vrai contenu Douglas.
 */

/**
 * Mots-clés FR → axe mental, comparés sur un texte normalisé (sans accents,
 * minuscule). L'ordre fixe sert de tie-break quand un libellé touche plusieurs
 * groupes (le plus grave d'abord : honnêteté > ego > régularité > discipline). Les
 * termes purement spéculatifs/marché (« réel » seul, « gagner », « setup ») restent
 * absents : un axe qu'ils seraient seuls à porter reste non mappé (0 fabrication).
 */
const AXIS_KEYWORDS: ReadonlyArray<readonly [MentalAxis, readonly string[]]> = [
  // Honnêteté avec soi-même : vérité, dissonance dire/faire, lucidité, data vs ressenti.
  [
    'honesty',
    [
      'honnet',
      'sincer',
      'mensonge',
      'mentir',
      'transparen',
      'franchise',
      'dissonance', // écart entre ce qu'on pense/dit et ce qu'on fait
      'lucid',
      'admettre',
      'deni',
      'illusion',
      'awareness', // self-awareness / conscience de soi
      'conscience de soi',
      'backtest', // ancrer sur la data réelle plutôt que le ressenti
      'reconnait',
      // NB : « verite » volontairement ABSENT — polysémique, il attrapait « les 5
      // vérités de Mark Douglas » (qui relèvent de l'acceptation/ego, classées ci-dessous).
    ],
  ],
  // Ego & acceptation : détachement du résultat, incertitude/randomness, identité, émotions.
  [
    'ego',
    [
      'ego',
      'accept',
      'lacher', // lâcher prise / lâcher-prise
      'detach', // détachement / détacher (du target, du résultat, de l'identité)
      'controle de soi',
      'orgueil',
      'revanche',
      'fomo',
      'frustration',
      'emotion',
      'peur',
      'anxi',
      'stress',
      'incertitude',
      'random', // randomness / random distribution
      'aleatoire',
      'hasard',
      'probabilis',
      'anything can happen',
      '5 verite', // « les 5 vérités de Mark Douglas » = acceptation probabiliste
      'cinq verite',
      'identite', // identité-trader / identité-publique
      'humiliation',
      'sang-froid',
      'sang froid',
      'somatique',
      'respiration',
      'sereni',
      'calme',
    ],
  ],
  // Régularité & constance : routine, rituel, habitude, fréquence, le geste répété.
  [
    'consistency',
    [
      'regul',
      'constan',
      'consistan', // consistance
      'routine',
      'rituel',
      'habitude',
      'frequen',
      'assidu',
      'quotidien',
      'chaque jour',
      'geste', // régularité du geste
      'repet',
      'cadence',
    ],
  ],
  // Discipline : rigueur, plan, process, règle, méthode, patience, exécution, cadre.
  [
    'discipline',
    [
      'disciplin',
      'rigueur',
      'plan', // tenir / respecter / suivre mon plan
      'process', // process-focus
      'focus',
      'regle',
      'methode',
      'patience',
      'execution',
      'cadre',
      'structure',
      'protocole',
      'checklist',
      'prepar',
      'organis',
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
