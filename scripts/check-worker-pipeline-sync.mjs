#!/usr/bin/env node
// scripts/check-worker-pipeline-sync.mjs — CI drift guard for the SEVEN AI
// worker pipelines (J9), the sibling of check-cron-crontab-sync.mjs.
//
// WHY THIS EXISTS.
// J9 moved the seven `claude --print` pipelines off Eliott's PC and onto the app
// host. It did so by hard-coding the same list of seven names in SIX independent
// places, in three languages, with no gate asserting they agree:
//
//   1. ops/cron/crontab.fxmily-worker      the schedule rows (what actually FIRES)
//   2. ops/cron/fxmily-worker              the wrapper allowlist (what may RUN)
//   3. ops/worker/run-batch.sh             the second allowlist (defense in depth)
//   4. ops/cron/fxmily-worker-watchdog     PIPELINES=() (what is WATCHED)
//   5. ops/worker/verify-worker-vps.sh     ORDER=() (what the switchover gate PROVES)
//   6. ops/worker/install-worker-vps.sh    EXPECTED_BATCH_SCRIPTS=() (what must EXIST)
//
// Nothing in CI compares them. `check-cron-crontab-sync.mjs` does this job for
// the app's `/api/cron/*` routes and does not contain the word "worker" — the
// worker crontab is entirely outside the existing guard.
//
// THE TWO FAILURES THIS CATCHES, and they are asymmetric:
//
//   * scheduled but NOT watched — a row in (1) missing from (4). The pipeline
//     runs, and the day it dies nothing says so. This is the worse one: it is
//     invisible precisely when it matters, which is the exact failure mode J9
//     exists to remove.
//   * watched but NOT scheduled — a name in (4) missing from (1). The watchdog
//     emits `task_missing:<name>` on every tick, forever. On the `server`
//     profile that label is CRITICAL, so the board is red permanently and stops
//     being read — the "cries wolf" failure the whole J9 board design fears.
//
// Renaming a pipeline, or adding an eighth, currently requires six correct edits
// in a row with no feedback if you make five.
//
// TWO NAMING RULES, and they are the reason this cannot be a plain `diff`:
//
//   * script filename — `<pipeline>-batch-local.sh`, EXCEPT `profile`, whose
//     script is `member-profile-monthly-local.sh`. That exception is not
//     invented here: it is the branch at ops/worker/run-batch.sh:82-86, and this
//     file mirrors it rather than restating it loosely.
//   * heartbeat action — `<pipeline>.batch.pulled` for four of them, but the
//     board predates the worker and uses the DOMAIN name for the other three
//     (`weekly_report`, `monthly_debrief`, `member_profile_monthly`, `seance`).
//     See apps/web/src/lib/system/health.ts:799-805.
//
// SCOPE, deliberately uneven, and stated rather than hidden:
//   * sources 1-6 are shell and cron — unambiguous to parse, so they are held to
//     STRICT SET EQUALITY.
//   * the board (health.ts) is TypeScript. Regex-parsing two adjacent readonly
//     arrays out of it would be brittle, and a drift guard that cries wolf is
//     worth less than none. So the board is checked with the weakest claim that
//     cannot false-positive: every pipeline's action string must APPEAR in the
//     file. That catches "a pipeline the server runs has no board entry at all"
//     and does not pretend to catch which profile it landed in.
//
// READ-ONLY. It never SSHes, never installs, never touches the host. It reads
// six files already in the checkout and compares them.
//
// USAGE :
//   node scripts/check-worker-pipeline-sync.mjs      # exit 0 = in sync, 1 = drift
// Importable — the pure helpers below are unit-tested.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The seven pipelines, in the order the switchover gate runs them. This file is
 * the ONE place the list is asserted; every other copy is checked against the
 * sources, never against this constant — so this is a reading order, not a
 * seventh hard-coded truth.
 */
export const CANONICAL_ORDER = [
  'onboarding',
  'verification',
  'seances',
  'calendar',
  'weekly',
  'monthly',
  'profile',
];

/**
 * Pipeline → batch script filename. Mirrors ops/worker/run-batch.sh:82-86: the
 * convention is `<batch>-batch-local.sh`, and `profile` is the documented
 * exception because the script predates the pipeline name.
 * @param {string} pipeline
 * @returns {string}
 */
export function scriptFileFor(pipeline) {
  return pipeline === 'profile' ? 'member-profile-monthly-local.sh' : `${pipeline}-batch-local.sh`;
}

/**
 * Pipeline → `/admin/system` heartbeat action. The board names things after the
 * DOMAIN object, the worker after the pipeline; four coincide, three do not.
 * Source of truth: apps/web/src/lib/system/health.ts:799-805.
 */
export const ACTION_FOR = {
  onboarding: 'onboarding.batch.pulled',
  verification: 'verification.batch.pulled',
  seances: 'seance.batch.pulled',
  calendar: 'calendar.batch.pulled',
  weekly: 'weekly_report.batch.pulled',
  monthly: 'monthly_debrief.batch.pulled',
  profile: 'member_profile_monthly.batch.pulled',
};

const FILES = {
  crontab: join(REPO_ROOT, 'ops', 'cron', 'crontab.fxmily-worker'),
  wrapper: join(REPO_ROOT, 'ops', 'cron', 'fxmily-worker'),
  runBatch: join(REPO_ROOT, 'ops', 'worker', 'run-batch.sh'),
  watchdog: join(REPO_ROOT, 'ops', 'cron', 'fxmily-worker-watchdog'),
  verify: join(REPO_ROOT, 'ops', 'worker', 'verify-worker-vps.sh'),
  installer: join(REPO_ROOT, 'ops', 'worker', 'install-worker-vps.sh'),
  board: join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'system', 'health.ts'),
};

/**
 * Pipelines actually SCHEDULED — `/usr/local/bin/fxmily-worker <name>` rows.
 * The trailing `\s+` is what keeps `fxmily-worker-watchdog` (no space before its
 * suffix) from being read as a pipeline called "watchdog".
 * @param {string} body
 * @returns {string[]} sorted, de-duplicated
 */
export function parseCrontabPipelines(body) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = line.match(/\/fxmily-worker\s+([a-z0-9-]+)\b/);
    if (m) found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * A `case "$BATCH" in  a | b | c) ;;` allowlist. Both wrappers use this shape;
 * one spaces the pipes and one does not, so whitespace is tolerated inside the
 * alternation — a parser that only accepted the tight form would silently read
 * an EMPTY allowlist from ops/cron/fxmily-worker and report perfect agreement
 * with nothing. An empty result is therefore never treated as success by the
 * caller (see diffWorkerPipelines).
 * @param {string} body
 * @returns {string[]} sorted, de-duplicated
 */
export function parseCaseAllowlist(body) {
  /** @type {Set<string>} */
  const found = new Set();
  const m = body.match(/case\s+"\$BATCH"\s+in[\s\S]*?\n\s*([a-z0-9|\s-]+?)\)\s*;;/);
  if (m) {
    for (const token of m[1].split('|')) {
      const name = token.trim();
      if (name !== '') found.add(name);
    }
  }
  return [...found].sort();
}

/**
 * A bash array literal `NAME=(a b c)`, possibly spanning lines.
 * @param {string} body
 * @param {string} varName
 * @returns {string[]} sorted, de-duplicated
 */
export function parseBashArray(body, varName) {
  const m = body.match(new RegExp(`^${varName}=\\(([^)]*)\\)`, 'm'));
  if (!m) return [];
  return [
    ...new Set(
      m[1]
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    ),
  ].sort();
}

/**
 * The installer's EXPECTED_BATCH_SCRIPTS, mapped BACK to pipeline names so it
 * can be compared with the other five as a set of pipelines.
 * @param {string} body
 * @returns {{ pipelines: string[], unmapped: string[] }}
 */
export function parseInstallerScripts(body) {
  const files = parseBashArray(body, 'EXPECTED_BATCH_SCRIPTS');
  /** @type {Map<string, string>} */
  const byFile = new Map(CANONICAL_ORDER.map((p) => [scriptFileFor(p), p]));
  /** @type {string[]} */
  const pipelines = [];
  /** @type {string[]} */
  const unmapped = [];
  for (const f of files) {
    const p = byFile.get(f);
    if (p) pipelines.push(p);
    else unmapped.push(f);
  }
  return { pipelines: pipelines.sort(), unmapped: unmapped.sort() };
}

/**
 * Pure comparison core. No I/O.
 * @param {{
 *   crontab: string[], wrapper: string[], runBatch: string[],
 *   watchdog: string[], verify: string[], installer: string[],
 *   unmappedScripts?: string[], boardBody?: string,
 * }} input
 */
export function diffWorkerPipelines({
  crontab,
  wrapper,
  runBatch,
  watchdog,
  verify,
  installer,
  unmappedScripts = [],
  boardBody = '',
}) {
  /** @type {{ source: string, list: string[] }[]} */
  const sources = [
    { source: 'ops/cron/crontab.fxmily-worker (schedule)', list: crontab },
    { source: 'ops/cron/fxmily-worker (wrapper allowlist)', list: wrapper },
    { source: 'ops/worker/run-batch.sh (allowlist)', list: runBatch },
    { source: 'ops/cron/fxmily-worker-watchdog (PIPELINES)', list: watchdog },
    { source: 'ops/worker/verify-worker-vps.sh (ORDER)', list: verify },
    { source: 'ops/worker/install-worker-vps.sh (EXPECTED_BATCH_SCRIPTS)', list: installer },
  ];

  // An EMPTY list means the parser failed, not that the file agrees. A guard
  // that turns green on an empty set is the exact false proof J9's own installer
  // had to be fixed for (install-worker-vps.sh:180-197) — do not repeat it here.
  const emptySources = sources.filter((s) => s.list.length === 0).map((s) => s.source);

  // The schedule is the reference: it is the only one of the six that has a
  // real-world effect all by itself.
  const reference = crontab;
  const refSet = new Set(reference);
  /** @type {{ source: string, missing: string[], extra: string[] }[]} */
  const mismatches = [];
  for (const { source, list } of sources) {
    if (list === reference) continue;
    const set = new Set(list);
    const missing = reference.filter((p) => !set.has(p));
    const extra = list.filter((p) => !refSet.has(p));
    if (missing.length > 0 || extra.length > 0) mismatches.push({ source, missing, extra });
  }

  // Weakest claim that cannot false-positive: the action string must appear.
  const missingFromBoard = boardBody
    ? reference.filter((p) => {
        const action = ACTION_FOR[p];
        return !action || !boardBody.includes(`'${action}'`);
      })
    : [];

  const ok =
    emptySources.length === 0 &&
    mismatches.length === 0 &&
    unmappedScripts.length === 0 &&
    missingFromBoard.length === 0;

  return { ok, reference, emptySources, mismatches, unmappedScripts, missingFromBoard };
}

/** Read the six sources from disk and run the diff. */
export function checkWorkerPipelineSync(paths = {}) {
  const f = { ...FILES, ...paths };
  const read = (p) => readFileSync(p, 'utf8');
  const { pipelines: installer, unmapped } = parseInstallerScripts(read(f.installer));

  return diffWorkerPipelines({
    crontab: parseCrontabPipelines(read(f.crontab)),
    wrapper: parseCaseAllowlist(read(f.wrapper)),
    runBatch: parseCaseAllowlist(read(f.runBatch)),
    watchdog: parseBashArray(read(f.watchdog), 'PIPELINES'),
    verify: parseBashArray(read(f.verify), 'ORDER'),
    installer,
    unmappedScripts: unmapped,
    boardBody: read(f.board),
  });
}

// ── CLI entry ───────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = checkWorkerPipelineSync();

  // eslint-disable-next-line no-console
  console.log(
    `worker pipelines scheduled : ${report.reference.length} (${report.reference.join(', ')})`,
  );

  if (report.ok) {
    // eslint-disable-next-line no-console
    console.log('✅ the 6 pipeline lists agree, and every one has a board entry.');
    process.exit(0);
  }

  const lines = ['❌ worker pipeline drift detected:'];
  for (const s of report.emptySources) {
    lines.push(`  • parsed NOTHING from ${s} — the parser broke, or the file changed shape.`);
  }
  for (const { source, missing, extra } of report.mismatches) {
    if (missing.length > 0) {
      lines.push(
        `  • ${source}: MISSING ${missing.join(', ')} — scheduled but absent here. ` +
          `If this is the watchdog, that pipeline runs UNWATCHED.`,
      );
    }
    if (extra.length > 0) {
      lines.push(
        `  • ${source}: EXTRA ${extra.join(', ')} — present here but NOT scheduled. ` +
          `If this is the watchdog, it will emit task_missing:<name> on every tick, forever.`,
      );
    }
  }
  for (const f of report.unmappedScripts) {
    lines.push(
      `  • ops/worker/install-worker-vps.sh expects '${f}', which maps to no known pipeline ` +
        `(see scriptFileFor() and ops/worker/run-batch.sh:82-86).`,
    );
  }
  for (const p of report.missingFromBoard) {
    lines.push(
      `  • '${p}' is scheduled but its heartbeat action '${ACTION_FOR[p] ?? '<none>'}' appears ` +
        `nowhere in apps/web/src/lib/system/health.ts — it would run with no board entry.`,
    );
  }
  lines.push('');
  lines.push('Adding or renaming a pipeline means editing all six lists. This is the gate.');
  // eslint-disable-next-line no-console
  console.error(lines.join('\n'));
  process.exit(1);
}
