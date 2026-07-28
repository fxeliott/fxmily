import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
