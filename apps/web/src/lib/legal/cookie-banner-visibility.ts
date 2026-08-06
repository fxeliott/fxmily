/**
 * Qui voit la bannière d'information cookies — un prédicat pur, pour que la
 * règle soit TESTABLE au lieu d'être devinée dans du JSX.
 *
 * Le premier garde écrit pour cette règle lisait la source du layout et
 * vérifiait que le mot « session » apparaissait dans la condition. Deux revues
 * en contexte frais l'ont contourné en une mutation chacune : `{sessionLite ?
 * <CookieBanner /> : null}` — la polarité inverse, donc la bannière montrée aux
 * seuls membres et jamais aux visiteurs — le laissait VERT. Un garde qui verdit
 * sur l'inverse exact de son intention est pire que pas de garde.
 *
 * D'où ce prédicat : la polarité vit ici, dans une fonction dont la table de
 * vérité est assertée, et le layout se contente de l'appeler.
 *
 * Pourquoi les visiteurs seulement — mesuré sur le build déployé, hit-test au
 * centre réel de chaque cible, 375×667, session ouverte, scrollY = 0 : la
 * bannière (`fixed`, 445..531) recouvrait l'action principale de `/dashboard`
 * (`hero-next-action` → /checkin/evening, 483..568) et une carte-lien de
 * `/journal` (402..597). Le contrôle négatif tranche : la même page avec la
 * bannière déjà fermée rend le CTA libre.
 */

/** La forme que le layout racine dérive de la session Auth.js. */
export type CookieBannerAudience = Readonly<{ email: string }> | null;

/**
 * `true` pour un visiteur, `false` dès qu'une session existe.
 *
 * Le paramètre est volontairement la valeur déjà calculée par le layout
 * (`sessionLite`) plutôt qu'un booléen : un booléen nommé `isAuthenticated`
 * s'inverse silencieusement au premier refactor, une valeur nulle ou non ne
 * s'inverse pas.
 */
export function showsCookieBanner(audience: CookieBannerAudience): boolean {
  return audience === null;
}
