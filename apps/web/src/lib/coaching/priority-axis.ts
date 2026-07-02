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
      // « règle / règles / règlement / respecter une règle » = discipline-as-rule.
      // ANCRÉ avec une espace de tête : le stem nu 'regle' est un substring de
      // 'déréglé' / 'dérèglement' (un axe SOMMEIL/mode-de-vie « mon sommeil est
      // déréglé », brief §130/§262 = axe lifestyle DISTINCT de discipline-process).
      // Le préfixe « dé- » colle « de » + « regle » SANS espace → ' regle' matche
      // « mes règles » mais jamais « déréglé », tuant le faux positif qui surfaçait
      // une trace d'alignement MENSONGÈRE (§0/honnêteté).
      ' regle',
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
 * D5 §J-D — indices de coaching DÉTERMINISTES issus du profil S2 profond (dimensions
 * J-A `coachingTone.register` / `learningStage.stage`). Enum-only : jamais le texte
 * brut IA (`rationale`/`evidence`) — l'appelant `service.ts` fait un `safeParse` des
 * schemas Zod puis ne transmet QUE les deux enums ici. §50-safe (aucun contenu
 * AI-dérivé surfacé, mapping enum→enum) ; firewall §21.5 (jamais un input du score).
 * On ne lit JAMAIS `weakSignals` (admin-only, ne traverse pas la frontière membre).
 */
export interface PriorityAxisHints {
  /** Registre de coaching préféré (dimension J-A `coachingTone.register`). */
  readonly register?: 'direct' | 'pedagogique' | 'socratique';
  /** Stade d'apprentissage (dimension J-A `learningStage.stage`). */
  readonly stage?: 'mechanical' | 'subjective' | 'intuitive';
}

/**
 * Stade d'apprentissage → axe mental de départage. ALIGNÉ sur le mapping D4
 * `learning-stage.ts` STAGE_HINT (une seule source de vérité de l'orientation par
 * stade) : `mechanical` = « respect strict des règles » ⇒ discipline ; `subjective`
 * = quitter les règles mécaniques pour la lecture subjective ⇒ acceptation de
 * l'incertitude (ego) ; `intuitive` = « consolide ta constance » ⇒ consistency.
 */
const STAGE_PREFERRED_AXIS: Record<NonNullable<PriorityAxisHints['stage']>, MentalAxis> = {
  mechanical: 'discipline',
  subjective: 'ego',
  intuitive: 'consistency',
};

/**
 * Registre de coaching → axe mental de départage. `direct` = cadre/process direct
 * ⇒ discipline ; `pedagogique` = construire la conscience de soi ⇒ honnêteté ;
 * `socratique` = questionner pour accepter l'incertitude/lâcher le besoin d'avoir
 * raison ⇒ ego.
 */
const REGISTER_PREFERRED_AXIS: Record<NonNullable<PriorityAxisHints['register']>, MentalAxis> = {
  direct: 'discipline',
  pedagogique: 'honesty',
  socratique: 'ego',
};

/**
 * Départage DÉTERMINISTE des axes qu'UN libellé touche à égalité. Ne renvoie un axe
 * préféré QUE s'il figure parmi les `matched` (jamais un axe non détecté dans le
 * texte ⇒ 0 fabrication). Le stade prime sur le registre (marqueur développemental
 * plus structurant, canon D4). `undefined` ⇒ aucune préférence applicable → l'ordre
 * de gravité curé de `AXIS_KEYWORDS` reste seul juge (comportement historique).
 */
function preferredAxis(
  matched: readonly MentalAxis[],
  hints: PriorityAxisHints,
): MentalAxis | undefined {
  const candidates: MentalAxis[] = [];
  if (hints.stage) candidates.push(STAGE_PREFERRED_AXIS[hints.stage]);
  if (hints.register) candidates.push(REGISTER_PREFERRED_AXIS[hints.register]);
  return candidates.find((axis) => matched.includes(axis));
}

/**
 * Classe les priorités d'onboarding (déjà nettoyées par `coerceAxes`) en axes
 * mentaux. Déduplique en conservant l'ordre de première apparition. Retourne `[]`
 * si rien ne mappe (jamais un axe inventé). Les 4 axes possibles bornent la sortie.
 *
 * D5 §J-D — `hints` OPTIONNEL. Il sert UNIQUEMENT de tie-break déterministe quand un
 * MÊME libellé touche plusieurs groupes d'axes À ÉGALITÉ (aucun signal ordinal ne les
 * sépare hormis l'ordre figé de `AXIS_KEYWORDS`). Il ne re-classe RIEN d'autre : un
 * libellé qui ne touche qu'un seul axe est intouché, et sans `hints` le comportement
 * est STRICTEMENT identique à aujourd'hui (aucune régression). L'exemption AI Act §50
 * de ce module est préservée : `hints` est enum→enum, jamais du texte brut IA.
 */
export function classifyPriorityAxes(
  axes: readonly string[],
  hints?: PriorityAxisHints,
): MentalAxis[] {
  const result: MentalAxis[] = [];
  for (const raw of axes) {
    const haystack = fold(raw);
    // Tous les axes que CE libellé touche, dans l'ordre de gravité curé (historique).
    const matched: MentalAxis[] = [];
    for (const [axis, keywords] of AXIS_KEYWORDS) {
      if (keywords.some((keyword) => haystack.includes(keyword))) matched.push(axis);
    }
    // Ordre de gravité curé (historique) : le 1er groupe touché. `matched` est non
    // vide ici (garde ci-dessous) ⇒ `fallback` est défini.
    const fallback = matched[0];
    if (fallback === undefined) continue;
    // Tie-break §J-D : n'agit QUE sur une égalité (≥2 axes touchés) et QUE si un axe
    // préféré est réellement parmi eux. Sinon → 1er de l'ordre de gravité (historique).
    const chosen =
      (hints && matched.length > 1 ? preferredAxis(matched, hints) : undefined) ?? fallback;
    if (!result.includes(chosen)) result.push(chosen);
  }
  return result;
}
