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
// TWO PATHS, because one of them will always be incomplete.
//
//   · BY NAME — a long literal under a secret-ish key, across the syntaxes this
//     surface is actually written in (shell, PowerShell, YAML, JSON, cron, an
//     HTTP header inside a curl call).
//   · BY SHAPE — a recognisable credential format, whatever it is called and
//     whatever syntax surrounds it.
//
// The second exists because the first cannot be finished. An adversarial pass
// walked past the name-based rules with the two heaviest secrets in this infra:
// the passphrase that decrypts every Postgres dump, and a
// `postgresql://user:password@host` URL. Neither advertises itself in its key
// name. Guessing names is an endless list; a shape is not.
//
// WHAT IT DOES NOT PROVE, stated because a gate whose name overpromises is worse
// than one that is modest. It does not prove the repository is free of secrets.
// It proves three specific things about an enumerated list of files. A repo-wide
// scanner is a different tool with a different false-positive budget (gitleaks,
// at the pre-commit hook). The `describe` below says only what is measured.
//
// Every bypass an adversarial pass demonstrated is kept as a regression case in
// "catches every form an adversarial pass walked past" — narrowing any pattern
// for any reason must make one of them fail loudly.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** Reads a repo-relative file. Throws (loudly) if the path moved. */
function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * Paths under `ops/` that `.gitignore` excludes, read FROM `.gitignore` rather
 * than restated here.
 *
 * This closes a real defect in the first version of this gate. It enumerated
 * files on disk and scanned everything it found — including `ops/worker/worker.env`
 * on any machine where a developer had created it. That file is gitignored
 * BECAUSE it holds six real tokens: scanning it would fail the suite for a
 * legitimate reason, on a file the repository does not ship, and the "fix" a
 * hurried developer would reach for is to delete the assertion.
 *
 * The gate is about what the REPOSITORY SHIPS. Deriving the exclusion from
 * `.gitignore` keeps the two coupled by construction: add an ignore rule under
 * `ops/`, and this scan honours it without anyone remembering to.
 */
function ignoredUnderOps(): string[] {
  return read('.gitignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ops/') && !l.startsWith('#'));
}

/**
 * Every shippable file the worker surface is made of. Enumerated on disk rather
 * than hard-coded so a NEW script added to `ops/worker/` is scanned the day it
 * lands — the failure mode being guarded against is precisely "someone added a
 * file and nobody thought about the token in it".
 */
function workerSurfaceFiles(): string[] {
  const files: string[] = [];
  const ignored = ignoredUnderOps();

  const walk = (relativeDir: string, keep: (name: string) => boolean) => {
    const abs = join(REPO_ROOT, relativeDir);
    for (const name of readdirSync(abs)) {
      const rel = `${relativeDir}/${name}`;
      if (statSync(join(REPO_ROOT, rel)).isDirectory()) continue;
      // A trailing slash means a DIRECTORY rule (prefix); anything else is an
      // exact path. Treating a file rule as a prefix — which the first attempt
      // did — silently excluded `worker.env.example` too, because it starts with
      // `worker.env`. The gate caught that itself, on the run that was meant to
      // prove the exclusion worked.
      if (ignored.some((rule) => (rule.endsWith('/') ? rel.startsWith(rule) : rel === rule))) {
        continue;
      }
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
 * The syntaxes a credential gets pasted into, on THIS surface.
 *
 * The list grew every time someone tried to walk past it, and each entry below
 * names the walk-past it closes rather than a language in the abstract. Keys are
 * matched case-INSENSITIVELY: `token=…` in a shell script is the same mistake as
 * `TOKEN=…`.
 */
const PATTERNS: { label: string; re: RegExp }[] = [
  // KEY=value / export KEY=value. GLOBAL: `A=1 B=<token>` on one line is an
  // idiom this repo documents (ops/worker/README.md), and a single `exec` only
  // ever returned the leftmost pair — so the token in second position was never
  // even looked at.
  { label: 'assignment', re: /(?:^|\s)(?:export\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*([^\s]*)/g },
  // PowerShell. FOUR of the files this gate scans are `.ps1`, and every
  // PowerShell variable starts with `$`, which `[A-Za-z]` cannot match — so the
  // entire language was invisible to a gate that reads it. `watchdog.ps1` holds
  // `$adminToken` and builds an `X-Admin-Token` header from it: the single most
  // likely place in this repo for a debugging paste.
  { label: 'powershell', re: /\$(?:env:)?([A-Za-z][A-Za-z0-9_:]*)\s*=\s*([^\s]+)/g },
  // PowerShell hashtable / JSON / TOML: `'X-Admin-Token' = $t`, `"token": "…"`.
  { label: 'quoted-key', re: /["']([A-Za-z][A-Za-z0-9_-]*)["']\s*[:=]\s*([^\s,}]+)/g },
  // YAML `KEY: value` — anchored, so a prose colon does not match.
  { label: 'yaml', re: /^\s*-?\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s+(.*)$/ },
  // HTTP header inside a curl call. NOT anchored at end-of-line: every single
  // one of this repo's real `curl -H "X-Admin-Token: …"` lines ends with a
  // line-continuation backslash, and the anchored version could not match one
  // of them. The only place the un-backslashed form existed was the test that
  // "proved" the pattern worked.
  { label: 'header', re: /([A-Za-z][A-Za-z0-9-]*)\s*:\s*["']?([^"'\s\\]+)/g },
];

/**
 * Credential SHAPES, matched on the whole line, independently of any key name.
 *
 * This is the second, orthogonal path. Everything above depends on guessing what
 * someone called the variable — and the two heaviest secrets in this infra do
 * not advertise themselves in their name: the passphrase that decrypts every
 * Postgres dump, and a `postgresql://user:password@host` URL. Naming will always
 * be an incomplete list. A shape is not.
 *
 * Deliberately restricted to formats with an UNAMBIGUOUS prefix. Generic
 * "40 hex characters" was tried and rejected: this gate scans
 * `worker-host-sync.yml`, where every action is pinned to a 40-hex commit SHA,
 * so entropy alone would light up on correct, required lines. A gate that cries
 * wolf on the pinning convention is a gate that gets muted.
 */
const SECRET_SHAPES: { label: string; re: RegExp }[] = [
  { label: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { label: 'openai-style', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { label: 'resend', re: /\bre_[A-Za-z0-9_-]{20,}/ },
  { label: 'github-pat', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/ },
  { label: 'slack', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { label: 'aws-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { label: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // Credentials inside a URL — the classic `DATABASE_URL` leak. The password
  // must be non-trivial, so `postgres://user@host` and `https://a:b@x` (a
  // placeholder shape) do not fire.
  { label: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{8,}@/ },
];

/**
 * A key that would hold a credential if it held anything.
 *
 * Most forms are anchored at the end (`…_TOKEN`, `…_SECRET`). `PING_URL` is NOT,
 * on purpose: the real keys are `HEALTHCHECK_PING_URL_WORKER_WEEKLY` and its six
 * siblings, so the marker sits in the middle. Anchoring it — as a first version
 * did — matched none of the seven keys it was added for.
 */
/**
 * A key that would hold a credential if it held anything.
 *
 * Two deliberate exclusions, both learned by watching this list misfire:
 *
 *   · `DATABASE_URL` is NOT here. It was, and it fired on
 *     `postgresql://fxmily@localhost/fxmily` — a connection string with no
 *     password, which is not a secret and is legitimate in examples. The
 *     dangerous form (`user:password@host`) is caught precisely by the
 *     `url-credentials` SHAPE instead. Prefer the precise detector to the noisy
 *     one; the noisy one is how a gate gets muted.
 *   · `GPG_PASS` is ANCHORED, so `GPG_PASS_FILE=/etc/fxmily/…` — a path, not a
 *     passphrase — cannot trip it as the file path grows.
 */
const SECRETISH =
  /(TOKEN|SECRET|PASSWORD|PASSPHRASE|API_KEY|_KEY|AUTHORIZATION|CREDENTIALS?|BEARER|SALT|COOKIE|SIGNING|GPG_PASS|PASS|PASSWD|PWD)$|PING_URL/i;

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
  // A VARIABLE REFERENCE, not "contains a dollar anywhere". The looser rule
  // waved through `$2b$12$…` — a bcrypt/argon hash, which is attackable offline
  // and has no business in a public repo.
  if (/^["']?\$[({A-Za-z_]/.test(value)) return true; // $VAR, ${VAR}, $(cmd)
  if (/\$\{|\$\(/.test(value)) return true; // interpolation anywhere
  if (value.includes('`')) return true;
  if (/<[^>]*>/.test(value)) return true; // <uuid>, https://hc-ping.com/<uuid>
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
 * Every `key → value` a line yields, across every shape. A line can match more
 * than one (a YAML entry also looks like a header), and a single line can carry
 * SEVERAL pairs — which is why the global patterns are drained rather than
 * probed once.
 */
function candidatesOn(line: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const { re } of PATTERNS) {
    if (re.global) {
      re.lastIndex = 0; // a global regex carries state between calls
      for (const m of line.matchAll(re)) {
        const [, key = '', raw = ''] = m;
        out.push({ key, value: literalValue(raw) });
      }
      continue;
    }
    const m = re.exec(line);
    if (!m) continue;
    const [, key = '', raw = ''] = m;
    out.push({ key, value: literalValue(raw) });
  }
  return out;
}

/**
 * True when a line hides a credential — by NAME (a long literal under a
 * secret-ish key) or by SHAPE (a recognisable credential format, whatever it is
 * called and whatever syntax surrounds it).
 *
 * Shape is checked FIRST and on the raw line, because it is the path that does
 * not depend on guessing the variable's name — which is exactly how a
 * `GPG_PASS`, a `DATABASE_URL` or a PEM block walked past the name-based rules.
 */
function secretOn(line: string): { key: string; value: string } | null {
  for (const { label, re } of SECRET_SHAPES) {
    const m = re.exec(line);
    if (m) return { key: `shape:${label}`, value: m[0] };
  }
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
          // Comment lines are NOT skipped here. "I'll just comment it out while
          // I test" is one of the most common ways a credential reaches a public
          // repository, and `#` is a comment marker in shell, cron AND
          // PowerShell — three of the four languages on this surface. The
          // example-env check below still skips them, because there the comments
          // ARE the documentation.
          const hit = secretOn(line);
          if (hit) offenders.push(`${file}:${i + 1} ${hit.key} (${hit.value.length} chars)`);
        });
    }

    expect(offenders).toEqual([]);
  });

  it('catches every form an adversarial pass walked past', () => {
    // Each line below is a bypass that was DEMONSTRATED against an earlier
    // version of this file. They are kept as a regression suite: narrowing a
    // pattern for any reason must make one of them fail loudly.
    const tok = 'a'.repeat(40);

    // PowerShell — four of the sixteen scanned files are .ps1, and every
    // variable starts with `$`, which the original `[A-Za-z]` could not match.
    // `watchdog.ps1` holds `$adminToken` and builds an X-Admin-Token header.
    expect(secretOn(`$adminToken = '${tok}'`)?.key).toBe('adminToken');
    expect(secretOn(`$env:FXMILY_ADMIN_TOKEN = "${tok}"`)).not.toBeNull();
    expect(secretOn(`  $headers = @{ 'X-Admin-Token' = '${tok}' }`)).not.toBeNull();

    // Line-continuation backslash. EVERY real `curl -H` in this repo ends with
    // one; the anchored pattern could not match a single one of them.
    expect(secretOn(`  curl -H "X-Admin-Token: ${tok}" \\`)).not.toBeNull();

    // Two assignments on one line — a documented idiom of this repo
    // (ops/worker/README.md). A non-global exec only ever saw the first.
    expect(
      secretOn(`FXMILY_BASE_URL=http://localhost:3000 FXMILY_ADMIN_TOKEN=${tok} \\`)?.key,
    ).toBe('FXMILY_ADMIN_TOKEN');

    // JSON.
    expect(secretOn(`  "token": "${tok}",`)?.key).toBe('token');

    // A commented-out secret is still a secret in a public repository.
    expect(secretOn(`# FXMILY_ADMIN_TOKEN=${tok}`)).not.toBeNull();

    // SHAPE, independent of the key name — the path that does not require
    // guessing what someone called the variable.
    expect(secretOn(`GPG_PASS=${tok}`)?.key).toBe('GPG_PASS');
    expect(secretOn(`ANY_NAME=sk-ant-api03-${'x'.repeat(40)}`)?.key).toBe('shape:anthropic');
    expect(secretOn(`  anything: re_${'A1b2C3d4'.repeat(3)}`)?.key).toBe('shape:resend');
    expect(secretOn(`export FOO=ghp_${'B'.repeat(36)}`)?.key).toBe('shape:github-pat');
    expect(secretOn(`  id = AKIAIOSFODNN7EXAMPLE`)?.key).toBe('shape:aws-key-id');
    expect(secretOn(`Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef`)?.key).toBe(
      'shape:jwt',
    );
    expect(secretOn('-----BEGIN OPENSSH PRIVATE KEY-----')?.key).toBe('shape:private-key-block');
    expect(
      secretOn('DATABASE_URL=postgresql://fxmily:S3cr3tPassw0rd@db.internal:5432/fxmily')?.key,
    ).toBe('shape:url-credentials');

    // A bcrypt/argon hash is attackable offline; `includes('$')` used to wave
    // it through as if it were a variable reference.
    expect(secretOn(`ADMIN_PASSWORD=$2b$12$${'c'.repeat(40)}`)).not.toBeNull();

    // …and the lines that must stay SILENT, or this gate gets muted.
    // A pinned GitHub Action is 40 hex characters on a file this gate scans.
    expect(
      secretOn('        uses: appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2 # v1'),
    ).toBeNull();
    expect(secretOn('  key: ${{ secrets.HETZNER_SSH_KEY }}')).toBeNull();
    expect(
      secretOn('HEALTHCHECK_PING_URL_WORKER_ONBOARDING=https://hc-ping.com/<uuid>'),
    ).toBeNull();
    expect(secretOn('DATABASE_URL=postgresql://fxmily@localhost:5432/fxmily')).toBeNull();
    expect(secretOn('# Generate via : `openssl rand -hex 24`')).toBeNull();
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

    // …and NOT the runtime secret file, on a machine where it exists. The gate
    // is about what the repository ships; `worker.env` is gitignored precisely
    // because it holds six real tokens, and failing the suite on it would push
    // the next developer to delete the assertion rather than fix anything.
    expect(files).not.toContain('ops/worker/worker.env');
    expect(ignoredUnderOps()).toContain('ops/worker/worker.env');
  });
});
