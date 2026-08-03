import { describe, expect, it } from 'vitest';

// J9 follow-up — unit + integration coverage for the worker-pipeline drift guard
// (`scripts/check-worker-pipeline-sync.mjs`).
//
// The seven AI pipelines are hard-coded in SIX independent files, in three
// languages. Nothing compared them. `check-cron-crontab-sync.mjs` does this job
// for the app's `/api/cron/*` routes and never mentions the worker.
//
// Every `it()` below is written as a MUTATION: it feeds the checker a list with
// exactly one thing wrong and asserts the checker goes red *for that reason*. A
// test that only ever sees the healthy repo proves that the parser runs, not
// that the guard guards — and this repo has already shipped one gate that turned
// green on an empty set (install-worker-vps.sh:180-197).
//
// Same import shape as cron/crontab-sync.test.ts: the script is an ESM `.mjs` at
// the repo root, five levels up from apps/web/src/lib/system.
import {
  ACTION_FOR,
  CANONICAL_ORDER,
  checkWorkerPipelineSync,
  diffWorkerPipelines,
  parseBashArray,
  parseCaseAllowlist,
  parseCrontabPipelines,
  parseInstallerScripts,
  scriptFileFor,
} from '../../../../../scripts/check-worker-pipeline-sync.mjs';

const SEVEN = [...CANONICAL_ORDER].sort();

/** A fully-consistent input set — the baseline every mutation perturbs by one. */
function healthyInput() {
  return {
    crontab: [...SEVEN],
    wrapper: [...SEVEN],
    runBatch: [...SEVEN],
    watchdog: [...SEVEN],
    verify: [...SEVEN],
    installer: [...SEVEN],
    unmappedScripts: [],
    boardBody: CANONICAL_ORDER.map((p) => `action: '${ACTION_FOR[p]}',`).join('\n'),
  };
}

describe('parseCrontabPipelines', () => {
  it('reads the pipeline token after `/fxmily-worker`, ignoring comments', () => {
    const body = [
      '# a comment naming /fxmily-worker monthly must be IGNORED',
      'SHELL=/bin/bash',
      '',
      '1,21,41 * * * *   fxmily   /usr/local/bin/fxmily-worker onboarding',
      '10 5 * * *        fxmily   /usr/local/bin/fxmily-worker calendar',
    ].join('\n');
    expect(parseCrontabPipelines(body)).toEqual(['calendar', 'onboarding']);
  });

  it('does NOT read the watchdog row as a pipeline called "watchdog"', () => {
    // `/usr/local/bin/fxmily-worker-watchdog` has no space before its suffix.
    // If the regex dropped the `\s+`, this row would inject a phantom pipeline
    // into the reference set and every other source would be reported as
    // "missing watchdog" — a permanently red gate on a healthy repo.
    const body = [
      '7,37 * * * *  fxmily  /usr/local/bin/fxmily-worker-watchdog',
      '10 5 * * *    fxmily  /usr/local/bin/fxmily-worker calendar',
    ].join('\n');
    expect(parseCrontabPipelines(body)).toEqual(['calendar']);
  });
});

describe('parseCaseAllowlist', () => {
  it('reads the SPACED alternation used by ops/cron/fxmily-worker', () => {
    const body = 'case "$BATCH" in\n  onboarding | weekly | seances) ;;\n  *) die ;;\nesac';
    expect(parseCaseAllowlist(body)).toEqual(['onboarding', 'seances', 'weekly']);
  });

  it('reads the TIGHT alternation used by ops/worker/run-batch.sh', () => {
    // The two wrappers genuinely differ in spacing. A parser that handled only
    // one shape would silently return [] for the other — and an empty list is
    // exactly what `diffWorkerPipelines` must refuse to call agreement.
    const body =
      'case "$BATCH" in\n  onboarding|weekly|seances) ;;\n  *)\n    exit 2\n    ;;\nesac';
    expect(parseCaseAllowlist(body)).toEqual(['onboarding', 'seances', 'weekly']);
  });
});

describe('parseBashArray / parseInstallerScripts', () => {
  it('reads a multi-line bash array', () => {
    expect(parseBashArray('PIPELINES=(\n  a b\n  c\n)', 'PIPELINES')).toEqual(['a', 'b', 'c']);
  });

  it('maps `profile` back through its documented non-conventional filename', () => {
    // run-batch.sh:82-86 — `profile` is the one pipeline whose script is not
    // `<name>-batch-local.sh`. If that mapping is ever lost, the installer list
    // silently stops containing `profile`.
    expect(scriptFileFor('profile')).toBe('member-profile-monthly-local.sh');
    expect(scriptFileFor('weekly')).toBe('weekly-batch-local.sh');

    const body =
      'EXPECTED_BATCH_SCRIPTS=(\n  weekly-batch-local.sh\n  member-profile-monthly-local.sh\n)';
    expect(parseInstallerScripts(body)).toEqual({
      pipelines: ['profile', 'weekly'],
      unmapped: [],
    });
  });

  it('reports a script filename that maps to no pipeline instead of dropping it', () => {
    const body = 'EXPECTED_BATCH_SCRIPTS=(\n  weekly-batch-local.sh\n  ghost-batch-local.sh\n)';
    expect(parseInstallerScripts(body).unmapped).toEqual(['ghost-batch-local.sh']);
  });
});

describe('diffWorkerPipelines — the healthy baseline', () => {
  it('is green when all six lists agree and the board names every action', () => {
    expect(diffWorkerPipelines(healthyInput()).ok).toBe(true);
  });
});

describe('diffWorkerPipelines — one mutation at a time, each must go red', () => {
  it('SCHEDULED BUT NOT WATCHED: a pipeline missing from the watchdog', () => {
    // The worse of the two failures: the pipeline runs, and the day it dies,
    // nothing says so. This is the exact blindness J9 exists to remove.
    const input = healthyInput();
    input.watchdog = SEVEN.filter((p) => p !== 'seances');

    const r = diffWorkerPipelines(input);
    expect(r.ok).toBe(false);
    const hit = r.mismatches.find((m) => m.source.includes('watchdog'));
    expect(hit?.missing).toEqual(['seances']);
  });

  it('WATCHED BUT NOT SCHEDULED: a pipeline the watchdog knows and cron does not', () => {
    // The watchdog would emit `task_missing:<name>` on every tick forever. On
    // the `server` profile that label is critical → the board is red
    // permanently, and a board that is always red stops being read.
    const input = healthyInput();
    input.crontab = SEVEN.filter((p) => p !== 'monthly');

    const r = diffWorkerPipelines(input);
    expect(r.ok).toBe(false);
    const hit = r.mismatches.find((m) => m.source.includes('watchdog'));
    expect(hit?.extra).toEqual(['monthly']);
  });

  it('a pipeline scheduled but refused by the wrapper allowlist', () => {
    // The wrapper would `die` with exit 2 on every tick — the pipeline is
    // scheduled and can never run.
    const input = healthyInput();
    input.wrapper = SEVEN.filter((p) => p !== 'calendar');
    expect(diffWorkerPipelines(input).ok).toBe(false);
  });

  it('a pipeline the switchover gate would never prove', () => {
    // verify-worker-vps.sh is the gate ADR-007 ticks "7/7" against. A pipeline
    // absent from ORDER makes that 7/7 a claim about six things.
    const input = healthyInput();
    input.verify = SEVEN.filter((p) => p !== 'profile');
    expect(diffWorkerPipelines(input).ok).toBe(false);
  });

  it('an installer that does not require one of the scheduled scripts', () => {
    const input = healthyInput();
    input.installer = SEVEN.filter((p) => p !== 'verification');
    expect(diffWorkerPipelines(input).ok).toBe(false);
  });

  it('a script filename matching no pipeline', () => {
    const input = healthyInput();
    input.unmappedScripts = ['ghost-batch-local.sh'];
    const r = diffWorkerPipelines(input);
    expect(r.ok).toBe(false);
    expect(r.unmappedScripts).toEqual(['ghost-batch-local.sh']);
  });

  it('a scheduled pipeline with no heartbeat entry on the board', () => {
    // It would run on the server with nothing on /admin/system representing it.
    const input = healthyInput();
    input.boardBody = CANONICAL_ORDER.filter((p) => p !== 'seances')
      .map((p) => `action: '${ACTION_FOR[p]}',`)
      .join('\n');

    const r = diffWorkerPipelines(input);
    expect(r.ok).toBe(false);
    expect(r.missingFromBoard).toEqual(['seances']);
  });

  it('REFUSES to call an EMPTY parse "agreement"', () => {
    // The false-green class this repo has already been bitten by: a parser that
    // matches nothing produces [], every `missing` check trivially passes on an
    // empty set, and the gate reports sync between a list and nothing at all.
    const input = healthyInput();
    input.runBatch = [];

    const r = diffWorkerPipelines(input);
    expect(r.ok).toBe(false);
    expect(r.emptySources).toContain('ops/worker/run-batch.sh (allowlist)');
  });
});

describe('the LIVE repository', () => {
  it('has its six worker pipeline lists in sync, and all seven on the board', () => {
    // This is what fails the suite the moment someone adds an eighth pipeline,
    // or renames one, and edits five files out of six.
    const report = checkWorkerPipelineSync();
    expect({
      emptySources: report.emptySources,
      mismatches: report.mismatches,
      unmappedScripts: report.unmappedScripts,
      missingFromBoard: report.missingFromBoard,
    }).toEqual({
      emptySources: [],
      mismatches: [],
      unmappedScripts: [],
      missingFromBoard: [],
    });
    expect(report.reference).toEqual(SEVEN);
  });
});
