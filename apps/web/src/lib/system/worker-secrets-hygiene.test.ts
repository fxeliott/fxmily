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
//
// WHAT IT DOES NOT PROVE, stated because a gate whose name overpromises is worse
// than one that is modest. An earlier version of this file called itself "the
// repository ships no worker secret". It does not prove that, and a review
// showed exactly how to walk past it: a bearer inside `curl -H "…: <token>"`, a
// key spelled in lower case, an `AWS_ACCESS_KEY_ID`, a hash starting with `$`.
// Three of those are now covered (header form, lower case, YAML `key: value`),
// the rest are not, and the `describe` below says only what is measured.
//
// The one that matters most here is covered on purpose: a populated
// Healthchecks.io ping URL. The ops workflow calls it "a capability token" in
// its own header, so a gate on this surface that ignored it would be theatre —
// which is why `cron.env.example` joined the walk and `PING_URL` joined the
// secret-ish key list.

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
  walk(
    'ops/cron',
    (name) =>
      name.startsWith('fxmily-worker') ||
      name.startsWith('crontab.fxmily') ||
      // The seven Healthchecks.io ping URLs live here. The ops workflow calls a
      // populated one "a capability token" in its own header, so leaving this
      // file out of a gate about secrets on the worker surface made no sense.
      name === 'cron.env.example',
  );
  files.push('.github/workflows/worker-host-sync.yml');

  return files;
}

/**
 * Three shapes a credential is pasted in, on this surface.
 *
 * Only the first existed at first, and a review walked past the gate with the
 * other two in about a minute: a bearer inside `curl -H "X-Admin-Token: …"` (no
 * `=` anywhere) and a YAML `KEY: value` — in a workflow file this very list
 * already scanned. The key is matched case-INSENSITIVELY for the same reason:
 * `token=…` in a shell script is the same mistake as `TOKEN=…`.
 */
const PATTERNS: { label: string; re: RegExp }[] = [
  // KEY=value / export KEY=value
  { label: 'assignment', re: /(?:^|\s)(?:export\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/ },
  // YAML `KEY: value` — anchored, so a prose colon does not match.
  { label: 'yaml', re: /^\s*-?\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s+(.*)$/ },
  // HTTP header, quoted or not: `X-Admin-Token: <value>` inside a curl call.
  { label: 'header', re: /([A-Za-z][A-Za-z0-9-]*)\s*:\s*([^"'\s]+)["']?\s*$/ },
];

/**
 * A key that would hold a credential if it held anything.
 *
 * Most forms are anchored at the end (`…_TOKEN`, `…_SECRET`). `PING_URL` is NOT,
 * on purpose: the real keys are `HEALTHCHECK_PING_URL_WORKER_WEEKLY` and its six
 * siblings, so the marker sits in the middle. Anchoring it — as a first version
 * did — matched none of the seven keys it was added for.
 */
const SECRETISH = /(TOKEN|SECRET|PASSWORD|PASSPHRASE|API_KEY|_KEY|AUTHORIZATION)$|PING_URL/i;

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
  if (/^(x{8,}|\.{3,})$/.test(value)) return true;
  // Placeholder PREFIXES, not exact words. The repo's own idiom is
  // `CRON_SECRET=changeme_openssl_rand_hex_24_BYTES_REQUIRED` — 43 characters,
  // which an exact-word list read as a real secret. This gate flagged it on its
  // first run, which is how the rule got written: a guard that cries wolf on the
  // documented placeholder is a guard that gets muted within a week. A prefix is
  // safe because nobody pastes a real token that starts with "changeme".
  if (/^(changeme|change_me|replace_?me|placeholder|todo|your[_-]|paste[_-])/i.test(value)) {
    return true;
  }
  return false;
}

const SECRET_LENGTH = 32;

/**
 * Every `key → value` a line yields, across the three shapes. A line can match
 * more than one (a YAML entry also looks like a header), which is fine: the
 * caller only cares whether ANY reading is a secret-ish key with a long value.
 */
function candidatesOn(line: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const { re } of PATTERNS) {
    const m = re.exec(line);
    if (!m) continue;
    const [, key = '', raw = ''] = m;
    out.push({ key, value: literalValue(raw) });
  }
  return out;
}

/** True when a line, read any way, hides a long literal under a secret-ish key. */
function secretOn(line: string): { key: string; value: string } | null {
  for (const c of candidatesOn(line)) {
    if (!SECRETISH.test(c.key)) continue;
    if (isInert(c.value)) continue;
    if (c.value.length >= SECRET_LENGTH) return c;
  }
  return null;
}

// The name says what is measured, not what would be reassuring. This proves
// three specific things about a listed set of files — not that the repository is
// free of secrets, which is gitleaks' job at the pre-commit hook.
describe('J9 Done-quand #5 — no long literal sits under a secret-ish key on the worker surface', () => {
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

    // Here the bar is ANY value, not a long one: an example file has no reason
    // to carry a short one either.
    for (const line of read('ops/worker/worker.env.example').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      for (const c of candidatesOn(line)) {
        if (!SECRETISH.test(c.key)) continue;
        if (isInert(c.value)) continue;
        filled.push(`${c.key}=${c.value.slice(0, 8)}…`);
      }
    }

    expect(filled).toEqual([]);
  });

  it('has no long literal under a secret-ish key anywhere on the worker surface', () => {
    // The paste-into-a-script mistake. A real token is 32+ chars; a variable
    // reference or a placeholder is not a token at any length.
    const offenders: string[] = [];

    for (const file of workerSurfaceFiles()) {
      read(file)
        .split('\n')
        .forEach((line, i) => {
          if (line.trim().startsWith('#')) return;
          const hit = secretOn(line);
          if (hit) offenders.push(`${file}:${i + 1} ${hit.key} (${hit.value.length} chars)`);
        });
    }

    expect(offenders).toEqual([]);
  });

  it('catches the three paste shapes, including the two that walked past v1', () => {
    // Not a check on the repo: a check on the CHECKER. Without it, broadening
    // the patterns could silently stop matching and every scan above would go
    // green for the wrong reason.
    const token = 'a'.repeat(40);

    expect(secretOn(`FXMILY_ADMIN_TOKEN=${token}`)?.key).toBe('FXMILY_ADMIN_TOKEN');
    expect(secretOn(`  curl -H "X-Admin-Token: ${token}"`)?.key).toBe('X-Admin-Token');
    expect(secretOn(`  ADMIN_BATCH_TOKEN: ${token}`)?.key).toBe('ADMIN_BATCH_TOKEN');
    expect(secretOn(`  token=${token}`)?.key).toBe('token'); // lower case counts
    expect(
      secretOn(`HEALTHCHECK_PING_URL_WORKER_WEEKLY=https://hc-ping.com/${token}`),
    ).not.toBeNull();

    // And the things that must NOT fire, or the gate cries wolf and gets muted.
    expect(secretOn('FXMILY_ADMIN_TOKEN="${FXMILY_ADMIN_TOKEN:-}"')).toBeNull();
    expect(secretOn(`FXMILY_ADMIN_TOKEN=${'a'.repeat(31)}`)).toBeNull();
    expect(secretOn('# FXMILY_ADMIN_TOKEN=<paste-it-here>')).toBeNull();
    expect(secretOn(`FXMILY_APP_URL=https://app.fxmilyapp.com/${token}`)).toBeNull(); // not secret-ish
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
    expect(files).toContain('ops/cron/cron.env.example');
  });
});
