#!/usr/bin/env node
// scripts/check-no-absolute-dates-in-tests.mjs — CI guard against date TIME-BOMBS
// in the test suite.
//
// WHY THIS EXISTS.
// Two CI reds came from the SAME class of bug: a test hard-codes a calendar date
// that was in the FUTURE (or the near-present) when it was written, then real
// wall-clock time marches past it and the test's meaning silently changes —
//   • a fixture dated 2026-05-06 seeded as an "upcoming" row went stale once that
//     day passed, flipping an "à venir" assertion red;
//   • `weekendsOff`-style logic hard-anchored to a specific weekday broke every
//     time CI ran on a Saturday/Sunday.
// A future-dated literal is a landmine: green today, red on an arbitrary later
// date, with a diff that touched nothing near the failure. This guard refuses to
// let a NEW future-dated literal land.
//
// WHAT IT DOES (and, deliberately, what it does NOT).
// The overwhelming majority of the ~2400 absolute dates in the suite are PAST,
// FIXED fixtures fed to pure date logic (streak windows, timezone conversions,
// month boundaries). Those are correct and deterministic — a test of "what does
// week N look like" MUST pin week N. Flagging them would be 2000+ false positives
// and the check would be turned off within a week. So the rule is scoped to the
// only shape that actually rots:
//
//   a date literal whose value is in the FUTURE relative to "today", i.e. one
//   that will cross from future → present → past as the clock advances.
//
// A past date can't expire (it's already past). A far-future SENTINEL (year ≥
// 2090, e.g. '2099-01-15' used as "never / max") is an intentional
// end-of-time marker, not a time-bomb, so it's exempt by rule. Everything in
// between — a plausibly-real near-future calendar date — is the danger.
//
// SCOPE : *.test.ts / *.test.tsx anywhere under apps/web, plus tests/e2e/*.spec.ts.
// Comment lines (`//`, `*`, `/*`) are ignored — a date in prose is documentation,
// never executed. Dynamic dates (`new Date()`, `addDays(...)`, `Date.now()`) don't
// contain a literal so they never match: they're the RIGHT way to write a
// relative fixture and this check quietly rewards them.
//
// ALLOWLIST : a `// allow-absolute-date` marker on the offending line OR the line
// immediately above exempts it — for the rare deliberate future literal (a far
// boundary that is genuinely part of the assertion). Keep each one justified.
//
// USAGE :
//   node scripts/check-no-absolute-dates-in-tests.mjs      # exit 0 = clean, 1 = time-bombs
// Importable — exports the pure helpers so a Vitest test can assert the LIVE repo.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');

/**
 * Year at/after which a date literal is treated as an intentional far-future
 * SENTINEL ("never" / "max"), not a time-bomb. 2090 is comfortably past any
 * realistic test-fixture horizon while still catching a fat-fingered 2027/2030.
 */
export const SENTINEL_YEAR = 2090;

/** Matches `// allow-absolute-date` anywhere on a line (in a comment). */
const ALLOW_MARKER = /allow-absolute-date/;

/** A bare ISO-ish calendar date `YYYY-MM-DD` (optionally followed by a time). */
const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/g;

/**
 * True when the visible content of a line is a comment (JSDoc `*`, block `/*`,
 * or line `//`). Cheap heuristic that matches the project's comment style — a
 * trailing `// ...` on a code line is handled separately (the code part is still
 * scanned; see scanSource).
 * @param {string} line
 */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * Parse a `YYYY-MM-DD` literal into a UTC-midnight epoch ms, or null if the
 * calendar fields are out of range (so a random 4-digit-dash sequence that
 * isn't really a date can't create a false positive).
 * @param {string} y @param {string} m @param {string} d
 */
function toUtcMs(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

/**
 * Scan a single file's source for future-dated absolute literals.
 *
 * @param {string} source  file contents
 * @param {number} nowMs   "today" as epoch ms (UTC midnight) — injectable for tests
 * @returns {{ line: number, date: string, year: number }[]} violations (1-based line)
 */
export function scanSource(source, nowMs) {
  /** @type {{ line: number, date: string, year: number }[]} */
  const violations = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Whole-line comment → documentation, never executed. Skip.
    if (isCommentLine(raw)) continue;
    // A `// allow-absolute-date` on THIS line or the line ABOVE exempts it.
    const prev = i > 0 ? lines[i - 1] : '';
    if (ALLOW_MARKER.test(raw) || ALLOW_MARKER.test(prev)) continue;

    // Strip a trailing line-comment so a date mentioned in an inline comment
    // (`foo() // shipped 2026-09-01`) doesn't count as executable.
    const codePart = stripTrailingComment(raw);

    DATE_RE.lastIndex = 0;
    let match;
    while ((match = DATE_RE.exec(codePart)) !== null) {
      const [full, y, m, d] = match;
      const year = Number(y);
      if (year >= SENTINEL_YEAR) continue; // intentional "never" marker
      const ms = toUtcMs(y, m, d);
      if (ms === null) continue; // not a real calendar date
      // Time-bomb = strictly in the future relative to today. A past/present
      // fixture can't rot (it's already behind the clock).
      if (ms > nowMs) {
        violations.push({ line: i + 1, date: full, year });
      }
    }
  }
  return violations;
}

/**
 * Remove a trailing `//` line-comment from a source line, being careful not to
 * cut inside a string. Good-enough tokenizer for TS/JS test files: it walks the
 * line tracking single/double/back quotes and stops at the first `//` seen
 * outside any string.
 * @param {string} line
 */
function stripTrailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++; // skip escaped char
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Recursively collect test/spec files under a directory, skipping build + dep
 * output. Returns absolute paths.
 * @param {string} dir
 * @param {string[]} [acc]
 */
export function collectTestFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'generated') {
        continue;
      }
      collectTestFiles(full, acc);
    } else if (/\.(test\.tsx?|spec\.ts)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Read + scan every test/spec file under apps/web. Separated from the CLI so a
 * Vitest test can call it against the live tree.
 * @param {{ root?: string, nowMs?: number }} [opts]
 * @returns {{ file: string, line: number, date: string }[]} sorted violations
 */
export function checkNoAbsoluteDatesInTests(opts = {}) {
  const root = opts.root ?? WEB_ROOT;
  // Default "now" = UTC midnight today, so the boundary is a whole day and the
  // result doesn't flip mid-run.
  const now = opts.nowMs ?? todayUtcMidnight();
  const files = statSync(root).isDirectory() ? collectTestFiles(root) : [root];
  /** @type {{ file: string, line: number, date: string }[]} */
  const violations = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');
    for (const v of scanSource(readFileSync(file, 'utf8'), now)) {
      violations.push({ file: rel, line: v.line, date: v.date });
    }
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return violations;
}

/** Epoch ms for UTC midnight of the current day. */
export function todayUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ── CLI entry ───────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkNoAbsoluteDatesInTests();
  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('✅ no future-dated absolute literals in tests (time-bomb free).');
    process.exit(0);
  }
  const lines = [
    `❌ ${violations.length} future-dated absolute literal(s) in tests — these will rot as the clock advances:`,
    '',
  ];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line}  →  ${v.date}`);
  }
  lines.push('');
  lines.push('Fix each one by EITHER:');
  lines.push('  • making it relative (new Date(), addDays(base, n), a fixed BASE + offset), OR');
  lines.push('  • if the future date is deliberate and safe, annotate the line with');
  lines.push('    `// allow-absolute-date <one-word reason>` (on it or the line above).');
  // eslint-disable-next-line no-console
  console.error(lines.join('\n'));
  process.exit(1);
}
