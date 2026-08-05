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
  'min-h-[100svh]': "[data-slot='splash-hero'] { min-height: calc(100svh - …) }",
};

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
