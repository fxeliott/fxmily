#!/usr/bin/env node
// scripts/check-e2e-copy-sync.mjs — CI guard that keeps E2E copy assertions in
// sync with the source strings they target.
//
// WHY THIS EXISTS.
// Four separate CI reds came from the same move: a UI copy string was edited in
// `src/` (a lead, an empty state, a button label) but the Playwright spec that
// asserted the OLD wording with `getByText('…')` / `getByRole(name: '…')` was
// not updated, so the locator matched nothing and the spec failed — a failure
// whose stack points at the test, not at the copy change that actually caused
// it. This check makes that break happen at PR time with a precise message ("this
// spec literal no longer exists in src") instead of an opaque locator timeout in
// a 25-minute sharded E2E run.
//
// WHAT IT DOES.
// From every spec under apps/web/tests/e2e it extracts the FRENCH string LITERALS
// passed to the copy-matching locators — getByText('…'), toContainText('…'),
// toHaveText('…'), and the `name: '…'` option of getByRole('…', { name: '…' }).
// Only quoted literals are considered; regex matchers (getByText(/…/), name:/…/)
// and dynamic expressions are intentionally skipped — they are the RIGHT tool for
// a fuzzy match and are not a copy-drift risk. To stay noise-free the check looks
// only at "sentence-like" literals: at least MIN_LEN characters AND containing a
// space (so a class name, a slug, a single word, or an ARIA role never counts).
//
// Each surviving literal must have a home in apps/web/src. Three real properties
// of THIS codebase would otherwise produce false orphans, so the match is made
// robust to each:
//   1. JSX escapes apostrophes/quotes/ampersands (`n&apos;a`, `&amp;`) and may
//      wrap a copy line — so both sides are NORMALISED (entities decoded, quotes
//      unified, whitespace collapsed) before comparing.
//   2. Some copy is ASSEMBLED dynamically (`{count} écart à regarder`,
//      `Insérer le recadrage : {preset}`) — the source holds only the static run,
//      so a literal also counts as present when its longest template-invariant
//      FRAGMENT is found.
//   3. A spec often SEEDS its own fixture text (`label: 'Backtest XAUUSD …'`) and
//      then asserts it after render — that is a data round-trip, never source
//      copy, so a literal that also appears elsewhere in the same spec (as the
//      seed value) is skipped.
// What's left after those three is a genuine ORPHAN: the spec asserts copy the
// app no longer ships. The source is the source of truth; update the SPEC.
//
// USAGE :
//   node scripts/check-e2e-copy-sync.mjs      # exit 0 = every literal has a home, 1 = orphans
// Importable — exports the pure helpers so a Vitest test can assert the LIVE tree.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');
const E2E_DIR = join(WEB_ROOT, 'tests', 'e2e');
const SRC_DIR = join(WEB_ROOT, 'src');

/** Minimum literal length to be considered "copy" (below this = label/slug/role). */
export const MIN_LEN = 8;

// Copy-matching locator calls whose FIRST string arg is user-facing copy.
const TEXT_CALL_RE = /\b(?:getByText|toContainText|toHaveText)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
// The `name:` option (getByRole('button', { name: 'Enregistrer' })). Kept
// separate because the copy is the option value, not the first positional arg.
const NAME_OPT_RE = /\bname:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * True when a literal looks like user-facing copy worth cross-checking: long
 * enough AND multi-word. Filters out roles ('button'), slugs, single words, and
 * short labels that are cheap to keep in sync and prone to legit reuse noise.
 * @param {string} s
 */
export function isCopyLiteral(s) {
  return s.length >= MIN_LEN && /\s/.test(s);
}

/**
 * Normalise a string so the SPEC literal (a plain JS string) and the SOURCE
 * (JSX, which escapes apostrophes as `&apos;`/`&#39;`, `&` as `&amp;`, quotes as
 * `&quot;`, and may type curly quotes) compare equal on the SAME human copy.
 * Without this, EVERY French copy line with an apostrophe is a false orphan.
 * Collapses whitespace so a JSX line-break inside the copy doesn't matter.
 * @param {string} s
 */
export function normalizeCopy(s) {
  return (
    s
      .replace(/&apos;|&#39;|&rsquo;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      // '&amp;' LAST — decoding it earlier would re-expose entities it encoded
      // ('&amp;gt;' must yield '&gt;', not '>'), the classic double-unescape.
      .replace(/&amp;/g, '&')
      .replace(/[‘’′]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * The template-invariant fragments of a normalised literal — the static runs
 * that survive interpolation. Copy asserted against dynamic source (`{count}
 * écart à regarder`, `Ton motif : {reason}`, `Insérer le recadrage : {preset}`)
 * ships the interpolated value in the spec, but the source only holds the static
 * run around the `${…}`. Splitting on digit groups (numeric interpolation) AND on
 * the separators that typically bracket an interpolated value (`:` `·` `—` `–`
 * `>` `|`) leaves the invariant runs, at least one of which lives in the source
 * verbatim. Returns every fragment long enough to be meaningful copy.
 * @param {string} s  already-normalised literal
 * @returns {string[]} static runs of length ≥ MIN_LEN, trimmed
 */
export function stableFragments(s) {
  return s
    .split(/\d+|\s[:·—–>|]\s/)
    .map((part) => part.trim())
    .filter((part) => part.length >= MIN_LEN);
}

/**
 * Extract the copy literals asserted by a spec's source. Each entry records
 * whether the literal is ALSO defined elsewhere in the same spec as a data value
 * (a seeded fixture the test inserts then asserts) — detected by counting raw
 * occurrences: a locator-only literal appears once (the assertion); a seeded one
 * appears at least twice (the seed + the assertion).
 * @param {string} source
 * @returns {{ literal: string, seeded: boolean }[]}
 */
export function extractSpecLiterals(source) {
  /** @type {Map<string, boolean>} */
  const found = new Map();
  for (const re of [TEXT_CALL_RE, NAME_OPT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const literal = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (!isCopyLiteral(literal)) continue;
      const occurrences = source.split(literal).length - 1;
      found.set(literal, occurrences > 1);
    }
  }
  return [...found].map(([literal, seeded]) => ({ literal, seeded }));
}

/**
 * Recursively collect files matching a predicate under a dir, skipping build +
 * dependency output. Returns absolute paths.
 * @param {string} dir
 * @param {(name: string) => boolean} match
 * @param {string[]} [acc]
 */
function collectFiles(dir, match, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'generated') {
        continue;
      }
      collectFiles(full, match, acc);
    } else if (match(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Build the searchable source haystack — the NORMALISED concatenation of every
 * ts/tsx file under src (test/spec files excluded). A naive substring search over
 * one big string is O(n·m) but n is a few MB and m a few dozen literals —
 * sub-second, and far simpler (thus more trustworthy) than an index.
 * @param {string} srcDir
 */
export function buildSourceHaystack(srcDir) {
  const files = collectFiles(srcDir, (n) => /\.(ts|tsx)$/.test(n) && !/\.(test|spec)\./.test(n));
  return normalizeCopy(files.map((f) => readFileSync(f, 'utf8')).join('\n \n'));
}

/**
 * Decide whether a spec literal has a home in the normalised source: present
 * when EITHER its full normalised form OR its longest template-invariant
 * fragment appears in the source.
 * @param {string} literal  raw spec literal
 * @param {string} haystack normalised source
 * @returns {boolean} true = present (not an orphan)
 */
export function literalHasSourceHome(literal, haystack) {
  const norm = normalizeCopy(literal);
  if (haystack.includes(norm)) return true;
  // Dynamic copy: present when ANY of its static (template-invariant) runs is in
  // the source — the interpolated value lives only in the spec, the static run
  // in the component.
  return stableFragments(norm).some((fragment) => haystack.includes(fragment));
}

/**
 * Cross-check every spec literal against the source haystack. Read from disk;
 * separated from the CLI so a Vitest test can call it against the live tree.
 * @param {{ e2eDir?: string, srcDir?: string }} [paths]
 * @returns {{ file: string, literal: string }[]} orphans (sorted)
 */
export function checkE2eCopySync(paths = {}) {
  const e2eDir = paths.e2eDir ?? E2E_DIR;
  const srcDir = paths.srcDir ?? SRC_DIR;
  const haystack = buildSourceHaystack(srcDir);
  const specFiles = collectFiles(e2eDir, (n) => /\.spec\.ts$/.test(n));

  /** @type {{ file: string, literal: string }[]} */
  const orphans = [];
  for (const spec of specFiles) {
    const rel = relative(REPO_ROOT, spec).replaceAll('\\', '/');
    for (const { literal, seeded } of extractSpecLiterals(readFileSync(spec, 'utf8'))) {
      if (seeded) continue; // fixture data the spec injects itself — not source copy
      if (!literalHasSourceHome(literal, haystack)) orphans.push({ file: rel, literal });
    }
  }
  orphans.sort((a, b) => a.file.localeCompare(b.file) || a.literal.localeCompare(b.literal));
  return orphans;
}

// ── CLI entry ───────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srcExists = (() => {
    try {
      return statSync(SRC_DIR).isDirectory();
    } catch {
      return false;
    }
  })();
  if (!srcExists) {
    // eslint-disable-next-line no-console
    console.error(`x source dir not found at ${SRC_DIR} — run from the repo root.`);
    process.exit(1);
  }

  const orphans = checkE2eCopySync();
  if (orphans.length === 0) {
    // eslint-disable-next-line no-console
    console.log('✅ every E2E copy literal still exists in src (no orphaned assertions).');
    process.exit(0);
  }
  const lines = [
    `❌ ${orphans.length} E2E copy literal(s) no longer found in apps/web/src — the spec asserts`,
    '   wording the app no longer ships (source is the source of truth):',
    '',
  ];
  for (const o of orphans) {
    lines.push(`  ${o.file}\n     -> «${o.literal}»`);
  }
  lines.push('');
  lines.push('Fix: open the current source component, read the NEW copy, and update the spec');
  lines.push(
    'literal to match it (or switch the assertion to a stable regex if the copy is dynamic).',
  );
  // eslint-disable-next-line no-console
  console.error(lines.join('\n'));
  process.exit(1);
}
