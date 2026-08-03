import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// J9 "Done quand" #5 — «aucun secret dans le dépôt».
//
// That criterion was verified BY HAND when J9 shipped (`.gitignore:32`, no
// tracked `worker.env`, no literal token, only RFC 5737 placeholder IPs). A
// hand check proves the state on the day it was run and nothing after: the very
// next contributor who pastes a real token into `worker.env.example` "just to
// show the shape" lands it in a PUBLIC repository, and no gate says a word.
//
// So the criterion gets a gate. Three claims, each one a thing a human actually
// did wrong somewhere at some point:
//
//   1. `ops/worker/worker.env` is ignored. If that line is ever dropped from
//      .gitignore, every developer's real token becomes one `git add -A` away
//      from the public history.
//   2. `worker.env.example` assigns NO value to any token key. The example is
//      the file people copy; a filled one is a leak with a friendly name.
//   3. No tracked worker file assigns a long literal to a token/secret key.
//      This is the one that catches the paste-into-a-script mistake.
//
// Claim 3 deliberately scans a NARROW, ENUMERATED set of files rather than the
// whole tree: a repo-wide secret scanner is a different tool with a different
// false-positive budget (gitleaks, and `.husky/pre-commit` is where it belongs).
// This one guards the J9 worker surface, which is the surface J9 created.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** Reads a repo-relative file. Throws (loudly) if the path moved. */
function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * Every tracked file the worker surface is made of. Enumerated on disk rather
 * than hard-coded so a NEW script added to `ops/worker/` is scanned the day it
 * lands — the failure mode being guarded against is precisely "someone added a
 * file and nobody thought about the token in it".
 */
function workerSurfaceFiles(): string[] {
  const files: string[] = [];

  const walk = (relativeDir: string, keep: (name: string) => boolean) => {
    const abs = join(REPO_ROOT, relativeDir);
    for (const name of readdirSync(abs)) {
      const rel = `${relativeDir}/${name}`;
      if (statSync(join(REPO_ROOT, rel)).isDirectory()) continue;
      if (keep(name)) files.push(rel);
    }
  };

  walk('ops/worker', () => true);
  walk('ops/cron', (name) => name.startsWith('fxmily-worker') || name.startsWith('crontab.fxmily'));
  files.push('.github/workflows/worker-host-sync.yml');

  return files;
}

/** `KEY=value` on a non-comment line. Captures the raw right-hand side. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

/** A key that would hold a credential if it held anything. */
const SECRETISH = /(TOKEN|SECRET|PASSWORD|PASSPHRASE|API_KEY|_KEY)$/;

/**
 * Strips one layer of quotes and trailing shell noise so `TOKEN="abc" # note`
 * is compared as `abc`, not as the whole line.
 */
function literalValue(raw: string): string {
  let v = raw.trim();
  const quoted = /^(['"])(.*)\1/.exec(v);
  if (quoted?.[2] !== undefined) return quoted[2];
  // Unquoted: a comment or trailing token ends the value.
  v = v.split(/\s+/)[0] ?? '';
  return v;
}

/**
 * A value is INERT when it cannot be a credential: empty, a variable reference,
 * a command substitution, or an obvious placeholder. Anything else that is long
 * is treated as a real secret — the gate errs toward crying wolf, because the
 * cost of a false negative here is a public token.
 */
function isInert(value: string): boolean {
  if (value === '') return true;
  if (value.includes('$')) return true; // ${VAR}, $(cmd), "$1"
  if (value.includes('`')) return true;
  if (/^<.*>$/.test(value)) return true; // <paste-token-here>
  if (/^(x{8,}|\.{3,}|changeme|CHANGEME|REPLACE_ME|TODO)$/.test(value)) return true;
  return false;
}

const SECRET_LENGTH = 32;

describe('J9 Done-quand #5 — the repository ships no worker secret', () => {
  it('keeps ops/worker/worker.env out of git', () => {
    // The runtime file. Everything else in ops/worker/ is meant to be public;
    // this one holds six tokens and must never be tracked.
    const lines = read('.gitignore')
      .split('\n')
      .map((l) => l.trim());

    expect(lines).toContain('ops/worker/worker.env');
  });

  it('ships an EXAMPLE env whose token keys are all unset', () => {
    // The whole point of the example is to be copied. If a key in it has a
    // value, that value is in the public history and in every copy anyone made.
    const filled: string[] = [];

    for (const line of read('ops/worker/worker.env.example').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = ASSIGNMENT.exec(line);
      if (!m) continue;
      const [, key = '', raw = ''] = m;
      if (!SECRETISH.test(key)) continue;
      const value = literalValue(raw);
      if (!isInert(value)) filled.push(`${key}=${value.slice(0, 8)}…`);
    }

    expect(filled).toEqual([]);
  });

  it('has no long literal assigned to a token key anywhere on the worker surface', () => {
    // The paste-into-a-script mistake. A real token is 32+ chars; a variable
    // reference or a placeholder is not a token at any length.
    const offenders: string[] = [];

    for (const file of workerSurfaceFiles()) {
      const body = read(file);
      body.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('#')) return;
        const m = ASSIGNMENT.exec(line);
        if (!m) return;
        const [, key = '', raw = ''] = m;
        if (!SECRETISH.test(key)) return;
        const value = literalValue(raw);
        if (isInert(value)) return;
        if (value.length >= SECRET_LENGTH) {
          offenders.push(`${file}:${i + 1} ${key} (${value.length} chars)`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('actually scans something — an empty file list would make the gate vacuous', () => {
    // Same defect this repo already had to fix in install-worker-vps.sh:180-197:
    // a check that passes on an empty set proves nothing. If the directory walk
    // ever silently returns [], the two scans above go green on zero files.
    const files = workerSurfaceFiles();

    expect(files.length).toBeGreaterThan(8);
    expect(files).toContain('ops/worker/worker.env.example');
    expect(files).toContain('ops/worker/run-batch.sh');
    expect(files).toContain('ops/cron/fxmily-worker-watchdog');
  });
});
