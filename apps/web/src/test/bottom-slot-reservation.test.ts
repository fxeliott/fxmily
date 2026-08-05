import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * BOTTOM-SLOT RESERVATION GUARD — the page must give the fixed islands room.
 *
 * ## The defect this exists to prevent (it shipped, and stayed shipped)
 *
 * `bottom-slot-arbitration.test.ts` next door proves the fixed bottom islands
 * never overlap EACH OTHER. Nothing proved they don't overlap the PAGE — and
 * they did, on the entry path of the whole app.
 *
 * Measured in production on 2026-08-05, iPhone SE (375×667), cookie banner up,
 * `document.elementFromPoint()` at the exact centre of each target:
 *
 *   /                 « Se connecter », « Demander un accès »        OCCLUDED
 *   /login            « Se connecter » (submit), « Mot de passe
 *                     oublié ? », « Faire une demande »              OCCLUDED
 *   /forgot-password  « Envoyer le lien » (submit), « Revenir à la
 *                     connexion »                                    OCCLUDED
 *
 * The banner was `position: fixed` and reserved nothing, so it sat on top of
 * the primary action of every public page. The render looked perfectly fine —
 * an opaque card floating above the page is what a banner is supposed to look
 * like. Only a hit-test showed the button was no longer reachable.
 *
 * ## What this guard checks, and why it is not a screenshot
 *
 * A screenshot proves one page at one width on one day. These two invariants
 * hold for every page that exists now or later, in milliseconds, inside the
 * required `Lint, type-check, build` check:
 *
 *   1. every bottom-slot island publishes its band (`useBottomSlotReservation`)
 *   2. every viewport-height lock used anywhere in `src` is a syntax that
 *      globals.css actually subtracts the band from
 *
 * (2) is the one that rots silently: `min-h-dvh` is today the only way this
 * repo says "as tall as the viewport", and the CSS keys on exactly that. The
 * day someone writes `min-h-screen` instead, the reservation stops applying to
 * their page and the occlusion comes back, green. That fails HERE, naming the
 * file and the token.
 *
 * ANTI-VACUITY: every extractor is asserted non-empty first. A guard that
 * matches nothing reads green while proving nothing — the failure mode this
 * repo has already been bitten by (see `feedback_gate_vert_ne_prouve_rien`).
 */

const WEB_ROOT = join(__dirname, '..', '..');
const SRC = join(WEB_ROOT, 'src');
const GLOBALS_CSS = join(SRC, 'app', 'globals.css');

/** The geometry that makes an element a tenant of the shared bottom slot. */
const BOTTOM_SLOT_MARKERS = ['fixed', 'inset-x-3', 'z-40'] as const;

/**
 * Viewport-height locks, and where globals.css subtracts the band from each.
 *
 * A token absent from this map is NOT covered — that is the whole point. Adding
 * one here without adding the matching CSS rule would be cheating the guard, so
 * the rule itself is asserted below.
 */
const COVERED_VIEWPORT_LOCKS: Record<string, string> = {
  'min-h-dvh': '.min-h-dvh { min-height: calc(100dvh - var(--bottom-slot-inset, 0px)) }',
  // ⚠️ Couverture par COÏNCIDENCE, pas par le token. La règle CSS cible un
  // ATTRIBUT (`[data-slot='splash-hero']`), pas la classe : elle ne couvre ce
  // token que tant que les deux sont portés par le MÊME élément. Le jour où
  // quelqu'un écrit `min-h-[100svh]` ailleurs, ce tableau le déclarerait couvert
  // à tort et la réservation ne s'appliquerait pas. D'où l'assertion de
  // confinement plus bas — sans elle, cette ligne est un mensonge en attente.
  'min-h-[100svh]':
    "[data-slot='splash-hero'] { min-height: calc(100svh - …) } (attribut, pas classe)",
};

/** Le seul fichier autorisé à porter `min-h-[100svh]` — cf. la note ci-dessus. */
const SVH_LOCK_OWNER = 'src/app/splash-hero.tsx';

/**
 * A class token that pins a box to the viewport height, variant prefix included.
 *
 * Anchored on the WHOLE token, not searched inside it: `max-h-screen` caps a
 * height and must not be reported, while `sm:min-h-dvh` must be — the CSS rule
 * targets `.min-h-dvh`, so a variant-prefixed lock is genuinely NOT covered.
 */
const VIEWPORT_LOCK_RE =
  /^(?:[a-z0-9@[\]:.-]+:)?(?:min-)?h-(?:dvh|svh|lvh|screen|\[100[dsl]?vh\])$/;

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

const rel = (file: string): string => file.slice(WEB_ROOT.length + 1).replace(/\\/g, '/');

/** `data-slot` → source file, for every element carrying the bottom-slot geometry. */
function collectIslands(): Map<string, string> {
  const islands = new Map<string, string>();
  for (const file of walkTsx(SRC)) {
    const code = readFileSync(file, 'utf8');
    for (const tag of code.match(/<[a-zA-Z][^>]*>/g) ?? []) {
      const slot = /data-slot=["']([^"']+)["']/.exec(tag);
      if (!slot?.[1]) continue;
      if (!BOTTOM_SLOT_MARKERS.every((marker) => tag.includes(marker))) continue;
      islands.set(slot[1], file);
    }
  }
  return islands;
}

/**
 * Viewport-lock token → files that use it.
 *
 * Scans STRING LITERALS rather than `className=…`: classes reach the DOM through
 * `cn(...)`, `cva(...)` and template strings too, and a `className={cn(a, b)}`
 * brace-scan truncates on the first nested `}`. Literals also exclude prose
 * comments, which name these tokens when explaining them (this file does).
 */
function collectViewportLocks(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walkTsx(SRC)) {
    const code = readFileSync(file, 'utf8');
    for (const [literal] of code.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)) {
      for (const token of literal.slice(1, -1).split(/[\s${}()]+/)) {
        if (!VIEWPORT_LOCK_RE.test(token)) continue;
        const files = found.get(token) ?? [];
        if (!files.includes(file)) files.push(file);
        found.set(token, files);
      }
    }
  }
  return found;
}

describe('bottom-slot reservation — les îlots fixes rendent leur place à la page', () => {
  const islands = collectIslands();
  const locks = collectViewportLocks();
  const css = readFileSync(GLOBALS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('détecte bien les îlots et les verrous plein-viewport (anti-garde-vide)', () => {
    expect(
      [...islands.keys()].sort(),
      'aucun îlot du slot bas trouvé — l’extracteur est cassé, pas le code',
    ).toEqual(['a2hs-hint', 'cookie-banner', 'ios-install-hint']);
    expect(
      locks.size,
      'aucune classe de verrouillage plein-viewport trouvée — l’extracteur est cassé',
    ).toBeGreaterThanOrEqual(1);
    expect(locks.has('min-h-dvh'), 'min-h-dvh introuvable : l’extracteur ne lit rien').toBe(true);
  });

  it('chaque îlot du slot bas publie sa bande via useBottomSlotReservation', () => {
    const violations: string[] = [];
    for (const [slot, file] of islands) {
      const code = readFileSync(file, 'utf8');
      if (!code.includes('useBottomSlotReservation(')) {
        violations.push(
          `${rel(file)} déclare data-slot="${slot}" avec la géométrie du slot bas mais n’appelle pas useBottomSlotReservation() : il se posera sur le contenu.`,
        );
        continue;
      }
      if (!code.includes(`'${slot}'`)) {
        violations.push(
          `${rel(file)} appelle useBottomSlotReservation() sans passer '${slot}' : il publierait sa bande sous un autre nom que celui que globals.css lit.`,
        );
      }
    }
    expect(violations, `\n\n${violations.join('\n')}\n`).toEqual([]);
  });

  it('ce qui suit <main> dans le flux sort aussi de la bande', () => {
    // Défaut mesuré le 2026-08-05 à 1440×900 : rétrécir `<main>` de la bande la
    // libérait en bas d'écran, et le pied de page légal — élément suivant du
    // flux — s'y installait. La réservation DÉPLAÇAIT le recouvrement sur les
    // liens que la bannière référence. Les deux moitiés du correctif :
    const footer = readFileSync(join(SRC, 'components', 'legal', 'legal-footer.tsx'), 'utf8');
    expect(
      footer.includes('useBottomSlotReservation(') && footer.includes("'legal-footer'"),
      'legal-footer.tsx ne publie plus sa hauteur : les boîtes plein-viewport ne peuvent plus la retrancher',
    ).toBe(true);
    expect(
      css,
      'globals.css ne retranche plus --slot-legal-footer : le pied de page retombe dans la bande',
    ).toMatch(/\.min-h-dvh\s*\{[^}]*--slot-legal-footer/);
    expect(css).toMatch(/\[data-slot='splash-hero'\]\s*\{[^}]*--slot-legal-footer/);
  });

  it('la réservation existe vraiment dans globals.css (anti-garde-vide)', () => {
    // Le garde ci-dessous compare des tokens à une table ; si la table décrit
    // des règles qui n’existent pas, il valide du vide.
    expect(css).toContain('--bottom-slot-inset');
    expect(css).toMatch(/\.min-h-dvh\s*\{[^}]*--bottom-slot-inset/);
    expect(css).toMatch(/\[data-slot='splash-hero'\]\s*\{[^}]*--bottom-slot-inset/);
    for (const slot of islands.keys()) {
      expect(
        css.includes(`[data-slot='${slot}']`),
        `globals.css ne mentionne pas ${slot} : son îlot ne déclenche pas la réservation`,
      ).toBe(true);
    }
  });

  it('le verrou svh reste confiné à l’élément que la règle d’attribut couvre', () => {
    // La règle CSS cible `[data-slot='splash-hero']`, pas la classe. La table
    // COVERED_VIEWPORT_LOCKS déclare pourtant le TOKEN couvert : c'est vrai
    // uniquement tant que les deux vivent sur le même élément. Sans cette
    // assertion, écrire `min-h-[100svh]` sur n'importe quel autre composant
    // passerait le garde au vert tout en rouvrant l'occlusion sur cette page.
    const porteurs = (locks.get('min-h-[100svh]') ?? []).map(rel);
    expect(
      porteurs.length,
      'plus aucun usage de min-h-[100svh] : soit le hero a changé, soit l’extracteur est cassé — retire la ligne du tableau ou répare',
    ).toBeGreaterThanOrEqual(1);
    expect(
      porteurs,
      `min-h-[100svh] n’est couvert que par la règle d’ATTRIBUT [data-slot='splash-hero']. Ces fichiers l’utilisent hors du porteur autorisé, donc SANS réservation : ${porteurs.join(', ')}`,
    ).toEqual([SVH_LOCK_OWNER]);
    const hero = readFileSync(join(WEB_ROOT, SVH_LOCK_OWNER), 'utf8');
    expect(
      hero.includes(`data-slot="splash-hero"`),
      `${SVH_LOCK_OWNER} a perdu data-slot="splash-hero" : la règle CSS ne l’atteint plus, la coïncidence est rompue`,
    ).toBe(true);
  });

  it('aucun `padding-bottom` concurrent sur <body> : ils composent, ils ne s’écrasent pas', () => {
    // DÉFAUT MESURÉ le 2026-08-05, en production, sur la feuille de style RÉELLE.
    // `globals.css` portait DEUX `padding-bottom` sur `body`, tous deux hors
    // `@layer`, à spécificité ÉGALE — (0,1,1) contre (0,1,1) : celui de la
    // bottom-nav, plus bas dans le fichier, écrasait la réservation d'îlot.
    // Conséquence : la réservation livrée par #597/#598/#600 était INERTE sur
    // toute route authentifiée < 1024px, c'est-à-dire la surface où les membres
    // passent leur temps. Personne ne l'a vu : les deux règles sont à 800 lignes
    // d'écart, et l'e2e est aveugle (fixtures.ts pré-ferme la bannière).
    //
    // Preuve runtime : en ajoutant un `<nav data-slot="app-bottom-nav">` au DOM
    // de la prod, le `padding-bottom` du corps tombait de 111px à 56px.
    //
    // L'invariant qui ferme la classe : tout `padding-bottom` posé sur `body`
    // doit passer par `--bottom-slot-inset`, donc COMPOSER avec la bande au lieu
    // de la remplacer. Une future règle qui pose une valeur fixe échoue ici.
    const declarations: { selector: string; value: string }[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ');
      if (!/(^|[\s,>~+])body\b/.test(selector)) continue;
      const decl = /(?:^|[;\s])padding-bottom\s*:([^;]*)/.exec(match[2] ?? '');
      if (!decl?.[1]) continue;
      declarations.push({ selector, value: decl[1].trim() });
    }

    // ANTI-VACUITÉ : si l'extracteur ne trouve plus rien, il valide du vide.
    expect(
      declarations.length,
      'aucun padding-bottom sur body trouvé dans globals.css — l’extracteur est cassé, ou la réservation a disparu',
    ).toBeGreaterThanOrEqual(2);

    const concurrents = declarations.filter((d) => !d.value.includes('--bottom-slot-inset'));
    expect(
      concurrents,
      `\n\n${concurrents
        .map(
          (d) =>
            `PADDING CONCURRENT : ${d.selector} { padding-bottom: ${d.value} }\n` +
            '  Il a la même spécificité que la réservation d’îlot et n’en tient pas compte :\n' +
            '  celui des deux qui est le plus bas dans le fichier gagne, l’autre devient inerte.\n' +
            '  Compose au lieu d’écraser, p. ex. max(var(--bottom-slot-inset, 0px), <ta valeur>).',
        )
        .join('\n\n')}\n`,
    ).toEqual([]);
  });

  it('chaque verrou plein-viewport est couvert par une règle de réservation', () => {
    const violations: string[] = [];
    for (const [token, files] of locks) {
      if (token in COVERED_VIEWPORT_LOCKS) continue;
      violations.push(
        [
          `TOKEN NON COUVERT : ${token}`,
          ...files.map((f) => `    → ${rel(f)}`),
          `  globals.css ne retranche la bande du slot bas qu’à : ${Object.keys(COVERED_VIEWPORT_LOCKS).join(', ')}.`,
          `  Une boîte verrouillée sur ${token} garde sa pleine hauteur, donc la bannière`,
          '  cookies (ou un hint d’installation) se reposera sur son contenu — le défaut',
          '  mesuré en prod le 2026-08-05. Corrige en utilisant min-h-dvh, ou ajoute la',
          '  règle dans globals.css ET la ligne correspondante dans COVERED_VIEWPORT_LOCKS.',
        ].join('\n'),
      );
    }
    expect(violations, `\n\n${violations.join('\n\n')}\n`).toEqual([]);
  });
});
