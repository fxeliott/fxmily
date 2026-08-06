import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { showsCookieBanner } from '@/lib/legal/cookie-banner-visibility';

/**
 * BOTTOM-SLOT ARBITRATION GUARD — exhaustive by construction.
 *
 * ## The defect this exists to prevent (already happened once)
 *
 * `globals.css` arbitrates the single "bottom slot" that several fixed islands
 * share (`fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40`)
 * with five clearance rules: hide under the cookie-banner, lift above the
 * Log-Express FAB, clear the desktop sidebar, clear the mobile bottom-nav, and
 * the combined FAB+nav case.
 *
 * J8 shipped `<IOSInstallHint>` with that geometry copied VERBATIM from
 * `<A2hsHint>` — and enrolled it in ZERO of the five rules. Result on the
 * repo's priority viewport (iPhone SE 375×667, Safari, not standalone): the
 * opaque banner (z-40) painted straight over the mobile bottom-nav (z-30),
 * hiding its icons and labels and swallowing every tap in the overlap. Nothing
 * caught it — not lint, not type-check, not the 6 000+ unit tests, not the e2e
 * gate (which asserts the banner is *visible*, never that it occludes nothing).
 *
 * ## Why a source guard rather than a screenshot
 *
 * A visual test proves ONE island at ONE width. This proves the INVARIANT for
 * every island that exists now or later, in milliseconds, inside the required
 * `Lint, type-check, build` check. It reads both sides from source:
 *
 *   islands  ← every `data-slot` in src/**\/*.tsx whose element also carries the
 *              shared bottom-slot geometry (`fixed` + `inset-x-3` + `z-40`)
 *   rules    ← every leaf CSS rule in globals.css that targets ≥1 island
 *
 * INVARIANT: a rule that arbitrates the bottom slot must target ALL islands,
 * minus any island that is itself the `:has()` subject of that rule (the
 * cookie-banner cannot be hidden by its own presence).
 *
 * So adding a 4th bottom-slot banner without enrolling it fails HERE, naming the
 * missing selectors — instead of shipping and occluding the navigation.
 *
 * ANTI-VACUITY: if either extractor returns an empty set the test FAILS loudly.
 * A guard that silently matches nothing is worse than no guard (it reads green).
 */

const WEB_ROOT = join(__dirname, '..', '..');
const SRC = join(WEB_ROOT, 'src');
const GLOBALS_CSS = join(SRC, 'app', 'globals.css');

/** The geometry that makes an element a tenant of the shared bottom slot. */
const BOTTOM_SLOT_MARKERS = ['fixed', 'inset-x-3', 'z-40'] as const;

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/**
 * Collect the `data-slot` values of every bottom-slot island.
 *
 * An element is an island when a single JSX opening tag carries BOTH a
 * `data-slot="…"` and a className holding all three geometry markers. We scan
 * tag-by-tag (`<` → `>`), so a `data-slot` in one element can never be paired
 * with the geometry of another. `.test.tsx` files are skipped: they quote slots
 * in assertions and would inject phantom islands.
 */
function collectBottomSlotIslands(): { slots: string[]; sources: Map<string, string> } {
  const slots = new Set<string>();
  const sources = new Map<string, string>();

  for (const file of walkTsx(SRC)) {
    const code = readFileSync(file, 'utf8');
    // Non-greedy tag scan. `[^>]*` cannot cross a `>`, so each match is one tag.
    for (const tag of code.match(/<[a-zA-Z][^>]*>/g) ?? []) {
      const slot = /data-slot=["']([^"']+)["']/.exec(tag);
      if (!slot?.[1]) continue;
      if (!BOTTOM_SLOT_MARKERS.every((marker) => tag.includes(marker))) continue;
      slots.add(slot[1]);
      sources.set(slot[1], file.slice(WEB_ROOT.length + 1).replace(/\\/g, '/'));
    }
  }
  return { slots: [...slots].sort(), sources };
}

/** Strip `/* … *\/` comments — they name data-slots and would forge matches. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

type CssRule = { selector: string; body: string };

/**
 * Extract every LEAF rule (a `{ … }` block containing declarations, not nested
 * blocks). Hand-rolled brace scan so `@media` wrappers are traversed rather than
 * mistaken for rules.
 */
function extractLeafRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let selectorStart = 0;
  const stack: { selector: string; bodyStart: number }[] = [];

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      stack.push({ selector: css.slice(selectorStart, i).trim(), bodyStart: i + 1 });
      selectorStart = i + 1;
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame) {
        const body = css.slice(frame.bodyStart, i);
        // Leaf = no nested block inside.
        if (!body.includes('{')) rules.push({ selector: frame.selector, body });
      }
      selectorStart = i + 1;
    }
  }
  return rules;
}

/** Slots targeted by a selector, i.e. OUTSIDE every `:has(...)` clause. */
function targetedSlots(selector: string): Set<string> {
  const withoutHas = selector.replace(/:has\([^)]*\)/g, '');
  const found = new Set<string>();
  for (const m of withoutHas.matchAll(/\[data-slot=["']([^"']+)["']\]/g)) {
    if (m[1]) found.add(m[1]);
  }
  return found;
}

/** Slots appearing INSIDE a `:has(...)` clause (the rule's precondition). */
function conditionSlots(selector: string): Set<string> {
  const found = new Set<string>();
  for (const has of selector.matchAll(/:has\(([^)]*)\)/g)) {
    for (const match of (has[1] ?? '').matchAll(/\[data-slot=["']([^"']+)["']\]/g)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return found;
}

describe('bottom-slot arbitration — every fixed bottom island is enrolled in every clearance rule', () => {
  const { slots: islands, sources } = collectBottomSlotIslands();
  const css = stripCssComments(readFileSync(GLOBALS_CSS, 'utf8'));
  const rules = extractLeafRules(css);

  it('détecte bien les îlots du slot bas (anti-garde-vide)', () => {
    // Un extracteur qui ne trouve rien rendrait tout le reste vert par vacuité.
    expect(
      islands.length,
      'aucun data-slot avec la géométrie du slot bas trouvé — l’extracteur est cassé, pas le CSS',
    ).toBeGreaterThanOrEqual(2);
    // Les trois locataires connus au moment de l’écriture du garde.
    expect(islands).toContain('cookie-banner');
    expect(islands).toContain('a2hs-hint');
    expect(islands).toContain('ios-install-hint');
  });

  it('trouve bien des règles d’arbitrage dans globals.css (anti-garde-vide)', () => {
    const arbitration = rules.filter((r) => targetedSlots(r.selector).size > 0);
    expect(
      arbitration.length,
      'aucune règle CSS ne cible un data-slot — le parseur est cassé, pas le CSS',
    ).toBeGreaterThanOrEqual(5);
  });

  it('chaque règle qui arbitre le slot bas cible TOUS les îlots éligibles', () => {
    const islandSet = new Set(islands);
    const violations: string[] = [];

    for (const rule of rules) {
      const targeted = targetedSlots(rule.selector);
      const targetedIslands = [...targeted].filter((s) => islandSet.has(s));
      // Une règle qui ne touche aucun îlot du slot bas ne nous concerne pas
      // (ex. `[data-slot='legal-footer']`, `[data-slot='log-express-fab']`).
      if (targetedIslands.length === 0) continue;

      const condition = conditionSlots(rule.selector);
      const eligible = islands.filter((s) => !condition.has(s));
      const missing = eligible.filter((s) => !targeted.has(s));

      if (missing.length > 0) {
        violations.push(
          [
            `RÈGLE : ${rule.selector.replace(/\s+/g, ' ').trim()}`,
            `  cible      : ${targetedIslands.sort().join(', ')}`,
            `  MANQUANT   : ${missing.join(', ')}`,
            ...missing.map((s) => `    → ${s} déclaré dans ${sources.get(s) ?? '?'}`),
            '  Un îlot du slot bas non enrôlé peint par-dessus (ou sous) ses voisins.',
            '  Ajoute-le à la liste de sélecteurs de cette règle dans globals.css.',
          ].join('\n'),
        );
      }
    }

    expect(violations, `\n\n${violations.join('\n\n')}\n`).toEqual([]);
  });
});

/**
 * MONTAGE DE LA BANNIÈRE — visiteurs seulement.
 *
 * Le garde ci-dessus prouve que les îlots du slot bas ne se peignent pas les uns
 * sur les autres. Il ne dit rien de ce qu'ils recouvrent DANS LA PAGE, et c'est
 * par là que le défaut est passé : mesuré sur le build déployé, 375×667, session
 * ouverte, scrollY=0, la bannière (`fixed`, 445..531) recouvrait l'action
 * principale de `/dashboard` (483..568) et une carte-lien de `/journal`
 * (402..597). Contrôle négatif : la même page avec la bannière déjà fermée rend
 * le CTA libre. Elle est donc réservée aux visiteurs.
 *
 * ## Pourquoi ce garde a été RÉÉCRIT avant même d'être livré
 *
 * Sa première version lisait l'expression JSX du layout et vérifiait que le mot
 * « session » y apparaissait. Deux revues en contexte frais l'ont contournée en
 * une mutation chacune :
 *
 *   {sessionLite ? <CookieBanner /> : null}   ← polarité INVERSE, garde VERT
 *
 * c'est-à-dire la bannière montrée aux seuls membres et jamais aux visiteurs —
 * l'inverse terme à terme de l'intention, et le défaut d'origine restauré. Un
 * garde qui verdit sur l'inverse exact de ce qu'il protège est pire que pas de
 * garde. Deuxième contournement : remonter la bannière AILLEURS (le dépôt monte
 * déjà deux îlots du même slot depuis `dashboard/page.tsx`), invisible pour un
 * garde qui ne lit que `layout.tsx`.
 *
 * D'où les trois assertions ci-dessous : la polarité vit dans un prédicat pur
 * dont on asserte la table de vérité, la FORME du montage est verrouillée, et le
 * comptage porte sur tout `src/**`.
 */
describe('montage de la bannière cookies — visiteurs uniquement', () => {
  const LAYOUT = join(SRC, 'app', 'layout.tsx');
  const layout = readFileSync(LAYOUT, 'utf8');
  const sansCommentaires = (src: string): string =>
    src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('le prédicat dit bien « visiteur oui, membre non » (table de vérité)', () => {
    // La polarité se teste ICI, sur la fonction, pas sur une chaîne de source :
    // c'est la seule assertion que l'inversion ne peut pas satisfaire.
    expect(showsCookieBanner(null), 'un visiteur doit voir la bannière').toBe(true);
    expect(
      showsCookieBanner({ email: 'membre@exemple.test' }),
      'un membre connecté ne doit PAS la voir (elle recouvre son contenu)',
    ).toBe(false);
  });

  it('la bannière est bien montée depuis le layout racine (anti-garde-vide)', () => {
    // Sans cette assertion, supprimer le composant rendrait les suivantes vertes
    // par vacuité — un garde qui ne voit plus rien lit comme un garde qui ne
    // trouve rien à redire.
    expect(
      layout,
      'layout.tsx n’importe plus CookieBanner : les gardes ci-dessous ne prouveraient plus rien',
    ).toContain("from '@/components/legal/cookie-banner'");
  });

  it('le montage passe par le prédicat, dans la BRANCHE VRAIE', () => {
    // Formes acceptées, et elles seules. `showsCookieBanner(x) ? null :
    // <CookieBanner />` échoue ici : c'est exactement la mutation qui passait.
    const canoniques = [
      /\{\s*showsCookieBanner\([^)]*\)\s*\?\s*<CookieBanner\s*\/>\s*:\s*null\s*\}/,
      /\{\s*showsCookieBanner\([^)]*\)\s*&&\s*<CookieBanner\s*\/>\s*\}/,
    ];
    const src = sansCommentaires(layout);
    expect(
      canoniques.some((re) => re.test(src)),
      [
        'Le montage de la bannière ne suit aucune des deux formes canoniques :',
        '  {showsCookieBanner(sessionLite) ? <CookieBanner /> : null}',
        '  {showsCookieBanner(sessionLite) && <CookieBanner />}',
        '',
        'La bannière est `fixed` au-dessus du contenu, et la réserve de hauteur,',
        'posée en fin de document, ne protège rien à scrollY=0 : sur une page',
        'membre elle recouvre l’action principale (mesuré sur /dashboard et',
        '/journal). La montrer aux membres — ou la monter sans condition — remet',
        'ce défaut en place.',
      ].join('\n'),
    ).toBe(true);
  });

  it('elle n’est montée NULLE PART ailleurs dans src/**', () => {
    // Le contournement le plus naturel d'un futur contributeur : « remettre la
    // bannière sur le dashboard ». `dashboard/page.tsx` monte déjà deux îlots du
    // même slot, donc le précédent existe et se copie sans y penser.
    const sites = walkTsx(SRC)
      .filter((f) => !f.endsWith(`app${sep}layout.tsx`))
      .filter((f) => /<CookieBanner\b/.test(sansCommentaires(readFileSync(f, 'utf8'))));
    expect(
      sites.map((f) => f.slice(SRC.length + 1)),
      'La bannière ne doit être montée que par le layout racine, derrière le prédicat.',
    ).toEqual([]);
  });
});

/**
 * Spécificité (b, c) d'un sélecteur — b = classes/attributs/pseudo-classes,
 * c = éléments/pseudo-éléments. Ce n'est PAS un moteur CSS : juste assez pour
 * comparer entre elles les règles de `globals.css`, qui n'emploient que des
 * attributs, des classes, des éléments et `:has()`/`:is()`/`:where()`. Les
 * identifiants (composante `a`) n'apparaissent nulle part dans ce fichier et ne
 * sont donc pas comptés. Limite assumée — et c'est pourquoi le premier test
 * ci-dessous valide l'instrument sur des cas connus AVANT qu'on croie son
 * verdict : un calculateur faux rendrait un rapport faux avec l'air d'un vrai.
 */
type Spec = { a: number; b: number; c: number };

const SPEC_ZERO: Spec = { a: 0, b: 0, c: 0 };

function plusForte(x: Spec, y: Spec): Spec {
  if (x.a !== y.a) return x.a > y.a ? x : y;
  if (x.b !== y.b) return x.b > y.b ? x : y;
  return x.c >= y.c ? x : y;
}

/** `x` l'emporte-t-elle sur `y` SANS dépendre de l'ordre du fichier ? */
function strictementPlusForte(x: Spec, y: Spec): boolean {
  if (x.a !== y.a) return x.a > y.a;
  if (x.b !== y.b) return x.b > y.b;
  return x.c > y.c;
}

/** Découpe une liste de sélecteurs sur les virgules de PREMIER niveau. */
function decouperListe(liste: string): string[] {
  const out: string[] = [];
  let profondeur = 0;
  let courant = '';
  for (let i = 0; i < liste.length; i += 1) {
    const ch = liste.charAt(i);
    if (ch === '(') profondeur += 1;
    if (ch === ')') profondeur -= 1;
    if (ch === ',' && profondeur === 0) {
      out.push(courant);
      courant = '';
      continue;
    }
    courant += ch;
  }
  if (courant.trim()) out.push(courant);
  return out;
}

function specificite(selecteur: string): Spec {
  let a = 0;
  let b = 0;
  let c = 0;
  let i = 0;
  const finDuMot = (depuis: number): number => {
    let j = depuis;
    while (j < selecteur.length && /[\w-]/.test(selecteur.charAt(j))) j += 1;
    return j;
  };
  while (i < selecteur.length) {
    const ch = selecteur.charAt(i);
    if (ch === '[') {
      const fin = selecteur.indexOf(']', i);
      b += 1;
      i = fin === -1 ? selecteur.length : fin + 1;
    } else if (ch === '.') {
      b += 1;
      i = finDuMot(i + 1);
    } else if (ch === '#') {
      // Composante `a` — oubliée dans la première version, qui comptait
      // `#main-content` comme un ÉLÉMENT. Ce n'est pas théorique : cet
      // identifiant existe (`src/app/layout.tsx`), donc une règle rivale le
      // portant battait la nôtre pendant que le garde restait VERT.
      a += 1;
      i = finDuMot(i + 1);
    } else if (ch === ':') {
      const pseudoElement = selecteur.charAt(i + 1) === ':';
      const debutNom = i + (pseudoElement ? 2 : 1);
      const finNom = finDuMot(debutNom);
      const nom = selecteur.slice(debutNom, finNom);
      if (selecteur.charAt(finNom) === '(') {
        let profondeur = 0;
        let k = finNom;
        for (; k < selecteur.length; k += 1) {
          if (selecteur.charAt(k) === '(') profondeur += 1;
          else if (selecteur.charAt(k) === ')') {
            profondeur -= 1;
            if (profondeur === 0) break;
          }
        }
        // `:where()` ne compte pour rien ; `:is()`/`:has()`/`:not()` prennent la
        // spécificité de leur argument LE PLUS FORT ; toute AUTRE pseudo-classe
        // fonctionnelle compte comme une pseudo-classe simple. La première
        // version passait `:nth-child(1)` par le calcul récursif — dont
        // l'argument n'est pas un sélecteur, donc il rendait zéro — et laissait
        // une règle rivale l'emporter pendant que le garde restait VERT.
        if (['is', 'has', 'not', 'matches'].includes(nom)) {
          const max = decouperListe(selecteur.slice(finNom + 1, k))
            .map(specificite)
            .reduce(plusForte, SPEC_ZERO);
          a += max.a;
          b += max.b;
          c += max.c;
        } else if (nom !== 'where') {
          b += 1;
        }
        i = k + 1;
      } else {
        if (pseudoElement) c += 1;
        else b += 1;
        i = finNom;
      }
    } else if (/[a-zA-Z]/.test(ch)) {
      c += 1;
      i = finDuMot(i + 1);
    } else {
      i += 1;
    }
  }
  return { a, b, c };
}

/**
 * Spécificité d'une LISTE de sélecteurs (`A, B, C`) : en CSS chacun porte la
 * sienne, et c'est la plus forte qui décide du sort de la déclaration.
 *
 * Oublier de découper donnait (6,3) pour trois sélecteurs qui valent (2,1)
 * chacun — l'instrument mentait, et le premier jeu de « cas connus » ne l'a pas
 * vu parce qu'aucun ne comportait de virgule. D'où le cas de liste ajouté aux
 * cas de validation : un instrument ne se valide que sur des cas qui peuvent le
 * faire échouer.
 */
function specificiteMax(liste: string): Spec {
  return decouperListe(liste).map(specificite).reduce(plusForte, SPEC_ZERO);
}

const ILOTS = ['cookie-banner', 'a2hs-hint', 'ios-install-hint'] as const;

/**
 * Les at-rules (`@media`, `@supports`) qui englobent la position `index`.
 *
 * Sans elles le garde ne voit QUE le sélecteur de la règle feuille, et trois
 * mutations qui coupent le correctif de tous les appareils réels — point de
 * bascule ramené à `1px`, `@media print`, condition remplacée — passaient au
 * VERT. Trou signalé par une revue en contexte frais, rejoué sur des copies.
 */
function contexteAtRules(css: string, index: number): string[] {
  const contexte: string[] = [];
  let profondeur = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = css.charAt(i);
    if (ch === '}') {
      profondeur += 1;
    } else if (ch === '{') {
      if (profondeur > 0) {
        profondeur -= 1;
        continue;
      }
      const debut = Math.max(css.lastIndexOf('{', i - 1), css.lastIndexOf('}', i - 1));
      const tete = css
        .slice(debut + 1, i)
        .trim()
        .replace(/\s+/g, ' ');
      if (tete.startsWith('@')) contexte.unshift(tete);
    }
  }
  return contexte;
}

/** Règles feuilles qui posent un `bottom:` (jamais `padding-bottom`) sur un îlot. */
function reglesBottomSurIlot(
  css: string,
): { sel: string; corps: string; index: number; contexte: string[] }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({
      sel: (m[1] ?? '').trim().replace(/\s+/g, ' '),
      corps: m[2] ?? '',
      index: m.index ?? 0,
      contexte: contexteAtRules(css, m.index ?? 0),
    }))
    .filter((r) => /(?:^|[;\s])bottom\s*:/.test(r.corps))
    .filter((r) => ILOTS.some((slot) => r.sel.includes(`[data-slot='${slot}']`)));
}

describe('ancrage haut des bandeaux d’installation — la règle doit VRAIMENT gagner', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const regles = reglesBottomSurIlot(css);
  const ancrage = regles.filter((r) => r.sel.includes("[data-anchor='top']"));
  const concurrentes = regles.filter((r) => !r.sel.includes("[data-anchor='top']"));

  it('le calculateur de spécificité est juste sur des cas connus (valider l’instrument)', () => {
    expect(specificite("body:has([data-slot='app-bottom-nav']) [data-slot='a2hs-hint']")).toEqual({
      a: 0,
      b: 2,
      c: 1,
    });
    expect(
      specificite(
        "body:has([data-slot='a']):has([data-slot='b']) :is([data-slot='c'], [data-slot='d'])",
      ),
    ).toEqual({ a: 0, b: 3, c: 1 });
    expect(specificite("html[lang] body :is([data-slot='b'])[data-anchor='top']")).toEqual({
      a: 0,
      b: 3,
      c: 2,
    });
    expect(specificite(":where([data-slot='a']) p")).toEqual({ a: 0, b: 0, c: 1 });
    expect(specificite('.x.y div')).toEqual({ a: 0, b: 2, c: 1 });
    // Le cas qui a pris l'instrument en défaut la première fois : une LISTE.
    // Sans découpage, les sélecteurs s'additionnaient en (6,3) au lieu de (2,1).
    expect(
      specificiteMax(
        "body:has([data-slot='x']) [data-slot='a'], body:has([data-slot='x']) [data-slot='b']",
      ),
    ).toEqual({ a: 0, b: 2, c: 1 });
    // Les DEUX cas où il se trompait dans le sens VERT, trouvés par une revue en
    // contexte frais : un identifiant compté comme un élément, et une
    // pseudo-classe fonctionnelle dont l'argument n'est pas un sélecteur.
    // `#main-content` existe (`src/app/layout.tsx`) : ce rival est réaliste.
    expect(specificite("#main-content [data-slot='a2hs-hint']")).toEqual({ a: 1, b: 1, c: 0 });
    expect(
      specificite(
        "body:has([data-slot='a']):has([data-slot='b']) :is([data-slot='c']):nth-child(1)",
      ),
    ).toEqual({ a: 0, b: 4, c: 1 });
    expect(specificite('div:hover')).toEqual({ a: 0, b: 1, c: 1 });
  });

  it('le lecteur de contexte at-rule est juste sur le fichier réel (valider l’instrument)', () => {
    // Sans lui, muter le point de bascule ou passer en `@media print` — donc
    // couper le correctif de tout appareil réel — laissait le garde VERT.
    expect(ancrage[0]?.contexte, 'la règle d’ancrage doit être vue SOUS son @media').toEqual([
      '@media (max-width: 639px)',
    ]);
    // Et l'instrument se valide sur un échantillon dont on CONNAÎT la réponse,
    // dans les deux sens. Le vérifier sur le fichier réel ne prouverait qu'une
    // propriété contingente : ici, toutes les règles `bottom:` des îlots vivent
    // sous un `@media`, donc « au moins une hors at-rule » aurait échoué sans
    // qu'aucun instrument ne soit cassé.
    const echantillon = 'a { bottom: 1px; }\n@media print { b { bottom: 2px; } }';
    expect(contexteAtRules(echantillon, echantillon.indexOf('a {'))).toEqual([]);
    expect(contexteAtRules(echantillon, echantillon.indexOf('b {'))).toEqual(['@media print']);
  });

  it('la règle d’ancrage existe, neutralise `bottom` et nomme les trois îlots', () => {
    expect(
      regles.length,
      'aucune règle `bottom:` sur un îlot — l’extracteur est cassé, pas le CSS',
    ).toBeGreaterThanOrEqual(3);
    expect(
      ancrage.length,
      "aucune règle [data-anchor='top'] : les bandeaux sont retombés dans le slot bas, où ils recouvrent l’action principale du dashboard (mesuré : 359..531 par-dessus 483..568, à 375×667).",
    ).toBe(1);
    expect(
      ancrage[0]?.corps,
      '`top:` sans `bottom: auto` définit les DEUX bords : l’élément s’étire (mesuré 519px de haut au lieu de 173).',
    ).toMatch(/bottom\s*:\s*auto/);
    expect(ancrage[0]?.corps, 'la règle doit poser un `top:`, sinon elle n’ancre rien').toMatch(
      /(?:^|[;\s])top\s*:/,
    );
    for (const slot of ILOTS) {
      expect(
        ancrage[0]?.sel,
        `la règle doit NOMMER les trois îlots (invariant de ce fichier) — il manque ${slot}`,
      ).toContain(`[data-slot='${slot}']`);
    }
  });

  it('elle bat STRICTEMENT toute autre règle qui pose `bottom` sur un îlot', () => {
    expect(
      concurrentes.length,
      'aucune règle concurrente trouvée — la comparaison serait vide, donc vaine',
    ).toBeGreaterThanOrEqual(3);
    const mienne = specificiteMax(ancrage[0]?.sel ?? '');
    const perdantes = concurrentes
      .map((r) => ({ sel: r.sel, spec: specificiteMax(r.sel) }))
      .filter((r) => !strictementPlusForte(mienne, r.spec));
    expect(
      perdantes.map(
        (p) =>
          `${p.sel} → (${p.spec.a},${p.spec.b},${p.spec.c}) ≥ ancrage (${mienne.a},${mienne.b},${mienne.c})`,
      ),
      [
        '',
        'À spécificité ÉGALE ou supérieure, l’ancrage ne gagne plus par lui-même : il',
        'ne tiendrait que par sa position dans le fichier, et une règle ajoutée plus',
        'bas le rendrait inerte SANS AUCUN SIGNE. Mesuré en injectant les candidats en',
        'tête du <head>, position la plus défavorable : à égalité le bandeau s’étire',
        '(519px), strictement au-dessus il tient sa place (173px).',
        '',
      ].join('\n'),
    ).toEqual([]);
  });

  it('et elle reste la dernière du fichier — double filet si la spécificité change un jour', () => {
    const derniereConcurrente = Math.max(...concurrentes.map((r) => r.index));
    expect(
      (ancrage[0]?.index ?? -1) > derniereConcurrente,
      'la règle d’ancrage doit rester APRÈS toutes les règles `bottom:` des îlots.',
    ).toBe(true);
  });

  it('l’ancrage ne dépend d’aucun élément qui peut ne pas être là', () => {
    const conditions = [...(ancrage[0]?.sel ?? '').matchAll(/:has\(([^)]*)\)/g)].map((m) => m[1]);
    expect(
      conditions,
      [
        '',
        'La première version conditionnait la règle à `html:has([data-slot="app-bottom-nav"])`.',
        'Sur une route qui monterait un bandeau SANS la barre de navigation, il retombait',
        'donc en bas — mesuré en production : 592..764 au lieu de 12..185, le défaut revenu',
        'intact. Un ancrage doit tenir à ce que le document est, pas à ce qu’il contient.',
        '',
      ].join('\n'),
    ).toEqual([]);
  });

  it('le hook lit le signal `--slot-anchored` posé par la règle, et ne DEVINE pas la position', () => {
    const hook = readFileSync(
      join(SRC, 'components', 'ui', 'use-bottom-slot-reservation.ts'),
      'utf8',
    );
    expect(
      ancrage[0]?.corps,
      'la règle doit poser `--slot-anchored: top`, sinon le hook n’a aucun signal à lire',
    ).toMatch(/--slot-anchored\s*:\s*top/);
    expect(
      hook,
      [
        '',
        'Le hook doit LIRE ce signal. La version qui DEVINAIT la position en comparant',
        '`top < bottom` se trompait en paysage téléphone (667×375 : top 58,5 < bottom 136',
        'pour un îlot ancré en BAS occupant 48 % de l’écran) et supprimait la réservation',
        'là où elle comptait le plus. La variable qui cassait ce calcul était la HAUTEUR',
        'du viewport, pas sa largeur.',
        '',
      ].join('\n'),
    ).toContain('--slot-anchored');
    expect(
      hook,
      'un îlot ancré en haut doit publier sa bande HAUTE, que `scroll-padding-top` consomme',
    ).toContain('--slot-top-');
  });

  it('un îlot ancré en haut ne masque pas le focus clavier (WCAG 2.2 SC 2.4.11 AA)', () => {
    const regles = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m) => ({ sel: (m[1] ?? '').trim().replace(/\s+/g, ' '), corps: m[2] ?? '' }))
      .filter((r) => /(?:^|[;\s])scroll-padding-top\s*:/.test(r.corps));
    expect(
      regles.length,
      [
        '',
        'Aucune règle `scroll-padding-top`. Mesuré sur le build déployé, `/dashboard` à',
        '375×667, bandeau ancré en haut (12..185) : à scrollY 150 un bouton occupe 47..71,',
        'donc ENTIÈREMENT sous le bandeau ; `focus()` ne défile pas et `elementFromPoint`',
        'à son centre renvoie le bandeau. C’est exactement le défaut que #605 avait fermé',
        'en BAS, rouvert en HAUT par le déplacement.',
        '',
      ].join('\n'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      regles.some((r) => r.sel.includes("[data-anchor='top']")),
      'la règle doit être conditionnée à la présence d’un îlot ancré en haut',
    ).toBe(true);
    expect(
      regles.some((r) => /--slot-top-/.test(r.corps)),
      'la valeur doit venir de la bande RÉELLEMENT publiée, pas d’une constante : la hauteur dépend du retour à la ligne et de `env(safe-area-inset-top)`',
    ).toBe(true);
  });

  it('tout composant qui déclare data-anchor="top" est un îlot que la règle nomme', () => {
    // Les commentaires de ces composants CITENT `data-anchor="top"` pour
    // l'expliquer : sans les retirer, un fichier qui n'ancre rien serait compté
    // comme porteur, et l'assertion « ≥ 2 » passerait au vert sans sujet réel.
    const sansCommentaires = (src: string): string =>
      src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const porteurs = walkTsx(SRC)
      .map((f) => sansCommentaires(readFileSync(f, 'utf8')))
      .filter((code) => /data-anchor=["']top["']/.test(code));
    expect(
      porteurs.length,
      'aucun composant ne déclare data-anchor="top" — l’extracteur est cassé, ou l’ancrage a été retiré',
    ).toBeGreaterThanOrEqual(2);
    const orphelins = porteurs
      .flatMap((code) => [...code.matchAll(/data-slot=["']([^"']+)["']/g)].map((m) => m[1] ?? ''))
      .filter((slot) => !(ILOTS as readonly string[]).includes(slot));
    expect(
      [...new Set(orphelins)],
      'un composant s’ancre en haut avec un data-slot que la règle CSS ne nomme pas : il gardera son `bottom:` et s’étirera.',
    ).toEqual([]);
  });
});
