#!/usr/bin/env node
// scripts/check-cron-crontab-sync.mjs — CI drift guard between the cron ROUTES
// shipped in the Next.js image and the host-side SCHEDULE that fires them.
//
// WHY THIS EXISTS (FIX-4).
// The schedule that HITS the cron routes lives ONLY on the Hetzner host, in two
// files that `deploy.yml` deliberately never touches (cron is host-state, synced
// by hand via `ops/sync-cron-host.sh` because pushing crontab from CI would mutate
// prod on every deploy — see that script's header). The failure mode this guards:
// a developer adds `src/app/api/cron/<new>/route.ts` but forgets the matching
// crontab line + wrapper-allowlist entry → the route ships, never fires, and the
// heartbeat (`/api/cron/health`) only flips red AFTER 1.5× its period elapses,
// silently. This check catches that class of drift at PR time, READ-ONLY, with
// ZERO production side-effect (it never SSHes, never installs anything — it only
// reads three files already in the repo and compares them).
//
// CONTRACT (all three lists must agree, modulo the documented exclusion) :
//   1. every cron ROUTE in code (api/cron/<name>/route.ts) MUST have a crontab
//      line `... /usr/local/bin/fxmily-cron <name>` in ops/cron/crontab.fxmily;
//   2. every cron ROUTE in code MUST be in the wrapper allowlist (ops/cron/fxmily-cron);
//   3. no crontab line / allowlist entry may reference a route that does NOT exist
//      in code (a stale schedule firing a 404).
//
// EXCLUSION : `health` is a cron-secret-GATED route but is NOT a scheduled job —
// it is the monitoring endpoint pulled by `.github/workflows/cron-watch.yml`
// (hourly) + UptimeRobot, never by the host crontab. It is therefore expected to
// be present in code WITHOUT a crontab line. The exclusion is centralised below so
// the rule is explicit and reviewable, never an accidental silent skip.
//
// USAGE :
//   node scripts/check-cron-crontab-sync.mjs            # exit 0 = in sync, 1 = drift
// Importable (for the Vitest unit test) — exports the pure helpers below.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Routes that ship a `route.ts` under api/cron but are intentionally NOT
 * scheduled on the host crontab. Keep this list as small as possible — every
 * entry is a deliberate hole in the drift guard and must be justified inline.
 */
export const UNSCHEDULED_CRON_ROUTES = new Set([
  // Heartbeat status endpoint — pulled by cron-watch.yml + UptimeRobot, not by
  // the host crontab. (Mirrors the e2e spec's note in session10-cron-permanence.)
  'health',
]);

/**
 * The INVERSE exclusion: wrapper tasks that are scheduled + allowlisted but are
 * NOT /api/cron routes — the wrapper executes a LOCAL host binary instead of
 * curling the app. They must be tolerated in the crontab and the allowlist
 * without a matching route.ts. Keep as small as UNSCHEDULED_CRON_ROUTES and
 * justify every entry inline.
 */
export const LOCAL_CRON_TASKS = new Set([
  // Tour 15 — weekly proven-restore drill. Routed through fxmily-cron (instead
  // of a direct `fxmily-restore-drill` crontab line) because the root validator
  // on the host never self-converges: crontab lines may only use shapes its
  // OLDEST deployed generation accepts, and `fxmily-cron <task>` is the one
  // stable shape (the tour-14 direct line failed the 2026-07-06 deploy).
  'restore-drill',
]);

const CRON_ROUTES_DIR = join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'api', 'cron');
const CRONTAB_FILE = join(REPO_ROOT, 'ops', 'cron', 'crontab.fxmily');
const WRAPPER_FILE = join(REPO_ROOT, 'ops', 'cron', 'fxmily-cron');

/**
 * Derive the cron route names from the filesystem (every directory under
 * api/cron that ships a `route.ts`). Same derivation strategy as
 * apps/web/tests/e2e/session10-cron-permanence.spec.ts so the two never drift.
 * @param {string} cronDir
 * @returns {string[]} sorted route names
 */
export function listCronRoutes(cronDir) {
  return readdirSync(cronDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(cronDir, entry.name, 'route.ts')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Parse the cron route names referenced by `fxmily-cron <route>` invocations in
 * a crontab file body. Comment lines (`#`) are ignored. Matches the wrapper
 * binary path used in ops/cron/crontab.fxmily.
 * @param {string} crontabBody
 * @returns {string[]} sorted, de-duplicated route names
 */
export function parseCrontabRoutes(crontabBody) {
  /** @type {Set<string>} */
  const routes = new Set();
  for (const rawLine of crontabBody.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    // The wrapper is always invoked as `.../fxmily-cron <route>` ; the route is
    // the token immediately after the binary path. `fxmily-backup` /
    // `fxmily-caddy-backup` are SEPARATE host scripts (not /api/cron routes) and
    // are correctly NOT matched by this pattern.
    const match = line.match(/\/fxmily-cron\s+([a-z0-9-]+)\b/);
    if (match) routes.add(match[1]);
  }
  return [...routes].sort();
}

/**
 * Parse the route allowlist baked into the host wrapper (ops/cron/fxmily-cron).
 * The allowlist is the single `case "$ROUTE" in <a|b|c>) ;;` line — we extract
 * the alternation of bare route tokens. Routes elsewhere (echoes, comments) are
 * not pipe-delimited route runs and are not matched.
 * @param {string} wrapperBody
 * @returns {string[]} sorted, de-duplicated route names
 */
export function parseWrapperAllowlist(wrapperBody) {
  /** @type {Set<string>} */
  const routes = new Set();
  // Find the `case ... in` body up to the first pattern terminator `) ;;`.
  // The allowlist line is `<a>|<b>|...|<z>) ;;` — capture the alternation only.
  const caseMatch = wrapperBody.match(/case\s+"\$ROUTE"\s+in[\s\S]*?\n\s*([a-z0-9|-]+)\)\s*;;/);
  if (caseMatch) {
    for (const token of caseMatch[1].split('|')) {
      const route = token.trim();
      if (route !== '') routes.add(route);
    }
  }
  return [...routes].sort();
}

/**
 * Pure comparison core — given the three derived lists, return a structured
 * report of every drift class. No I/O, fully unit-testable.
 * @param {{ routes: string[], crontab: string[], allowlist: string[], excluded?: Set<string>, localTasks?: Set<string> }} input
 * @returns {{
 *   ok: boolean,
 *   missingFromCrontab: string[],
 *   missingFromAllowlist: string[],
 *   staleCrontab: string[],
 *   staleAllowlist: string[],
 * }}
 */
export function diffCronSchedule({
  routes,
  crontab,
  allowlist,
  excluded = UNSCHEDULED_CRON_ROUTES,
  localTasks = LOCAL_CRON_TASKS,
}) {
  // Routes that SHOULD be scheduled = code routes minus the documented exclusions.
  const scheduled = routes.filter((r) => !excluded.has(r));
  const crontabSet = new Set(crontab);
  const allowlistSet = new Set(allowlist);
  const routeSet = new Set(routes);

  // (1) code route with no crontab line.
  const missingFromCrontab = scheduled.filter((r) => !crontabSet.has(r)).sort();
  // (2) code route not in the wrapper allowlist (the wrapper would refuse it,
  // exit 2, so even a manual fire is dead). Excluded routes need no allowlist
  // entry either, since they are never wrapper-invoked.
  const missingFromAllowlist = scheduled.filter((r) => !allowlistSet.has(r)).sort();
  // (3) crontab line firing a route that no longer exists in code (→ 404 spam).
  // Local wrapper tasks (LOCAL_CRON_TASKS) run a host binary, never the app —
  // they are legitimately scheduled without a route.ts.
  const staleCrontab = crontab.filter((r) => !routeSet.has(r) && !localTasks.has(r)).sort();
  // (3b) allowlist entry for a route that no longer exists in code (dead allow).
  const staleAllowlist = allowlist.filter((r) => !routeSet.has(r) && !localTasks.has(r)).sort();

  const ok =
    missingFromCrontab.length === 0 &&
    missingFromAllowlist.length === 0 &&
    staleCrontab.length === 0 &&
    staleAllowlist.length === 0;

  return { ok, missingFromCrontab, missingFromAllowlist, staleCrontab, staleAllowlist };
}

/**
 * Read the three sources from disk and run the diff. Separated from the CLI so
 * the I/O wiring stays testable against a fixture repo root if ever needed.
 * @param {{ cronDir?: string, crontabFile?: string, wrapperFile?: string }} [paths]
 */
export function checkCronScheduleSync(paths = {}) {
  const cronDir = paths.cronDir ?? CRON_ROUTES_DIR;
  const crontabFile = paths.crontabFile ?? CRONTAB_FILE;
  const wrapperFile = paths.wrapperFile ?? WRAPPER_FILE;

  const routes = listCronRoutes(cronDir);
  const crontab = parseCrontabRoutes(readFileSync(crontabFile, 'utf8'));
  const allowlist = parseWrapperAllowlist(readFileSync(wrapperFile, 'utf8'));

  return { routes, crontab, allowlist, ...diffCronSchedule({ routes, crontab, allowlist }) };
}

// ── CLI entry ───────────────────────────────────────────────────────────────
// Only runs when invoked directly (`node scripts/check-cron-crontab-sync.mjs`),
// never on import (so the Vitest unit test can import the helpers cleanly).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = checkCronScheduleSync();

  // eslint-disable-next-line no-console
  console.log(
    `cron routes in code : ${report.routes.length} ` +
      `(${report.routes.length - UNSCHEDULED_CRON_ROUTES.size} scheduled + ` +
      `${UNSCHEDULED_CRON_ROUTES.size} unscheduled-by-design)`,
  );

  if (report.ok) {
    // eslint-disable-next-line no-console
    console.log('✅ cron routes ↔ crontab ↔ wrapper allowlist are in sync.');
    process.exit(0);
  }

  const lines = ['❌ cron schedule drift detected:'];
  if (report.missingFromCrontab.length > 0) {
    lines.push(
      `  • routes in code with NO crontab line (ops/cron/crontab.fxmily): ${report.missingFromCrontab.join(', ')}`,
    );
  }
  if (report.missingFromAllowlist.length > 0) {
    lines.push(
      `  • routes in code NOT in the wrapper allowlist (ops/cron/fxmily-cron): ${report.missingFromAllowlist.join(', ')}`,
    );
  }
  if (report.staleCrontab.length > 0) {
    lines.push(
      `  • crontab lines firing a route that no longer exists in code: ${report.staleCrontab.join(', ')}`,
    );
  }
  if (report.staleAllowlist.length > 0) {
    lines.push(
      `  • wrapper allowlist entries for a route that no longer exists in code: ${report.staleAllowlist.join(', ')}`,
    );
  }
  lines.push('');
  lines.push('Fix: add/remove the matching line in ops/cron/crontab.fxmily AND the allowlist');
  lines.push(
    'in ops/cron/fxmily-cron, then re-sync the host with: bash ops/sync-cron-host.sh <ssh-host>.',
  );
  // eslint-disable-next-line no-console
  console.error(lines.join('\n'));
  process.exit(1);
}
