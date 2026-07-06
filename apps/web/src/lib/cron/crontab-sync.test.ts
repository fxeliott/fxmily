import { describe, expect, it } from 'vitest';

// FIX-4 — unit + integration coverage for the cron-schedule drift guard
// (`scripts/check-cron-crontab-sync.mjs`). The pure helpers are tested against
// synthetic inputs (so every drift class is provably caught), and the LIVE repo
// is asserted to be in sync (so this very test fails the suite the moment a new
// cron route lands without its crontab line / allowlist entry).
//
// The script is an ESM `.mjs` at the repo root, four levels up from this file
// (apps/web/src/lib/cron → repo root). Imports may cross package roots; only the
// test file itself must live under apps/web/src to be picked up by vitest.config.
import {
  LOCAL_CRON_TASKS,
  UNSCHEDULED_CRON_ROUTES,
  checkCronScheduleSync,
  diffCronSchedule,
  parseCrontabRoutes,
  parseWrapperAllowlist,
} from '../../../../../scripts/check-cron-crontab-sync.mjs';

describe('parseCrontabRoutes', () => {
  it('extracts the route token after `/fxmily-cron`, ignoring comments + blanks', () => {
    const body = [
      '# a comment line that mentions fxmily-cron recompute-scores should be IGNORED',
      'SHELL=/bin/bash',
      '',
      '0 2 * * *   fxmily   /usr/local/bin/fxmily-cron recompute-scores',
      '*/2 * * * * fxmily   /usr/local/bin/fxmily-cron dispatch-notifications',
    ].join('\n');
    expect(parseCrontabRoutes(body)).toEqual(['dispatch-notifications', 'recompute-scores']);
  });

  it('does NOT match the separate host backup scripts (fxmily-backup / fxmily-caddy-backup)', () => {
    // These are real crontab lines that invoke standalone host scripts, NOT
    // /api/cron routes — they must never be treated as cron routes.
    const body = [
      '30 2 * * *  fxmily  /usr/local/bin/fxmily-backup',
      '30 6 * * 0  fxmily  /usr/local/bin/fxmily-caddy-backup',
      '0 2 * * *   fxmily  /usr/local/bin/fxmily-cron recompute-scores',
    ].join('\n');
    expect(parseCrontabRoutes(body)).toEqual(['recompute-scores']);
  });
});

describe('parseWrapperAllowlist', () => {
  it('extracts the pipe-delimited route alternation from the `case "$ROUTE" in` block', () => {
    const body = [
      'case "$ROUTE" in',
      '  checkin-reminders|recompute-scores|purge-deleted) ;;',
      '  *)',
      '    echo "not allowed" >&2',
      '    exit 2',
      '    ;;',
      'esac',
    ].join('\n');
    expect(parseWrapperAllowlist(body)).toEqual([
      'checkin-reminders',
      'purge-deleted',
      'recompute-scores',
    ]);
  });
});

describe('diffCronSchedule (pure core)', () => {
  const base = {
    routes: ['health', 'recompute-scores', 'purge-deleted'],
    crontab: ['recompute-scores', 'purge-deleted'],
    allowlist: ['recompute-scores', 'purge-deleted'],
  };

  it('reports ok when code, crontab and allowlist agree (excluding `health`)', () => {
    const r = diffCronSchedule(base);
    expect(r.ok).toBe(true);
    expect(r.missingFromCrontab).toEqual([]);
    expect(r.missingFromAllowlist).toEqual([]);
    expect(r.staleCrontab).toEqual([]);
    expect(r.staleAllowlist).toEqual([]);
  });

  it('treats `health` as scheduled-NOT-required (the documented exclusion)', () => {
    // `health` is in code but absent from crontab + allowlist — must stay ok.
    expect(UNSCHEDULED_CRON_ROUTES.has('health')).toBe(true);
    expect(diffCronSchedule(base).ok).toBe(true);
  });

  it('FAILS when a code route has no crontab line (the core drift bug)', () => {
    const r = diffCronSchedule({
      routes: ['recompute-scores', 'brand-new-cron'],
      crontab: ['recompute-scores'],
      allowlist: ['recompute-scores', 'brand-new-cron'],
    });
    expect(r.ok).toBe(false);
    expect(r.missingFromCrontab).toEqual(['brand-new-cron']);
  });

  it('FAILS when a code route is missing from the wrapper allowlist', () => {
    const r = diffCronSchedule({
      routes: ['recompute-scores', 'brand-new-cron'],
      crontab: ['recompute-scores', 'brand-new-cron'],
      allowlist: ['recompute-scores'],
    });
    expect(r.ok).toBe(false);
    expect(r.missingFromAllowlist).toEqual(['brand-new-cron']);
  });

  it('FAILS when the crontab fires a route that no longer exists in code (stale schedule → 404)', () => {
    const r = diffCronSchedule({
      routes: ['recompute-scores'],
      crontab: ['recompute-scores', 'deleted-cron'],
      allowlist: ['recompute-scores'],
    });
    expect(r.ok).toBe(false);
    expect(r.staleCrontab).toEqual(['deleted-cron']);
  });

  it('FAILS when the allowlist references a route that no longer exists in code', () => {
    const r = diffCronSchedule({
      routes: ['recompute-scores'],
      crontab: ['recompute-scores'],
      allowlist: ['recompute-scores', 'deleted-cron'],
    });
    expect(r.ok).toBe(false);
    expect(r.staleAllowlist).toEqual(['deleted-cron']);
  });

  // Tour 15 — LOCAL wrapper tasks (host binaries fired via `fxmily-cron <task>`,
  // e.g. restore-drill) are scheduled + allowlisted WITHOUT a route.ts.
  it('tolerates a LOCAL task in crontab + allowlist with no code route', () => {
    expect(LOCAL_CRON_TASKS.has('restore-drill')).toBe(true);
    const r = diffCronSchedule({
      routes: ['recompute-scores'],
      crontab: ['recompute-scores', 'restore-drill'],
      allowlist: ['recompute-scores', 'restore-drill'],
    });
    expect(r.ok).toBe(true);
    expect(r.staleCrontab).toEqual([]);
    expect(r.staleAllowlist).toEqual([]);
  });

  it('the tolerance is carried ONLY by LOCAL_CRON_TASKS (empty set → stale again)', () => {
    const r = diffCronSchedule({
      routes: ['recompute-scores'],
      crontab: ['recompute-scores', 'restore-drill'],
      allowlist: ['recompute-scores', 'restore-drill'],
      localTasks: new Set(),
    });
    expect(r.ok).toBe(false);
    expect(r.staleCrontab).toEqual(['restore-drill']);
    expect(r.staleAllowlist).toEqual(['restore-drill']);
  });
});

describe('checkCronScheduleSync (LIVE repo — regression net)', () => {
  it('the real api/cron routes, crontab.fxmily and fxmily-cron allowlist are in sync', () => {
    const report = checkCronScheduleSync();
    // Sanity: derivation actually found the routes (guards a wrong-cwd empty list).
    expect(report.routes.length).toBeGreaterThanOrEqual(17);
    // Helpful failure message enumerating any drift, mirroring the CLI output.
    expect(
      report.ok,
      [
        'cron schedule drift in the repo:',
        `  missingFromCrontab: ${report.missingFromCrontab.join(', ') || '(none)'}`,
        `  missingFromAllowlist: ${report.missingFromAllowlist.join(', ') || '(none)'}`,
        `  staleCrontab: ${report.staleCrontab.join(', ') || '(none)'}`,
        `  staleAllowlist: ${report.staleAllowlist.join(', ') || '(none)'}`,
      ].join('\n'),
    ).toBe(true);
  });
});
