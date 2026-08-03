import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PC_WATCHDOG_VERSION,
  SERVER_WATCHDOG_VERSION_BASE,
  SERVER_WATCHDOG_VERSION_LIVE,
  SERVER_WATCHDOG_VERSION_OBSERVING,
} from './watchdog-versions.fixture';

/**
 * J9 — binds the test fixtures to the emitters.
 *
 * `health.ts` routes a repair command to a machine by reading `watchdogVersion`
 * off the heartbeat. The suite that covers that routing used to assert against
 * `v4` / `v4-obs` — strings no emitter has ever produced. It was green against
 * code that, fed the REAL strings, would have printed a PowerShell command for a
 * Linux fault. A test whose fixture is fiction proves the fixture, not the code.
 *
 * So this file reads the two shell/PowerShell emitters and re-derives the three
 * strings. Bump a version, drop the `-srv` append, reorder the suffixes: this
 * goes red and the fixture must be re-read from source. It is the only thing
 * keeping the routing suite anchored to production.
 *
 * It runs in a separate file on purpose — `health.test.ts` mocks `node:fs`.
 */
function readRepoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url)), 'utf8');
}

describe('watchdog version strings match their emitters', () => {
  const shell = readRepoFile('ops/cron/fxmily-worker-watchdog');

  it('derives the server strings from ops/cron/fxmily-worker-watchdog', () => {
    // Base assignment: WATCHDOG_VERSION="j9-1.0"
    const base = /^WATCHDOG_VERSION="([^"$]+)"/m.exec(shell);
    expect(base, 'no literal WATCHDOG_VERSION= assignment found').not.toBeNull();
    expect(base![1]).toBe(SERVER_WATCHDOG_VERSION_BASE);

    // `-srv` is appended UNCONDITIONALLY (no `[[ ... ]] &&` guard on that line).
    // That is what keeps the server identifiable once DRY_RUN flips to 0.
    const srvLine = shell
      .split('\n')
      .find((l) => l.includes('-srv"') && l.includes('WATCHDOG_VERSION='));
    expect(srvLine, 'no line appends the -srv marker').toBeDefined();
    expect(srvLine!.trim()).toMatch(/^WATCHDOG_VERSION="\$\{WATCHDOG_VERSION\}-srv"$/);

    // `-obs` is appended ONLY in the observation window, and AFTER `-srv`.
    const obsLine = shell
      .split('\n')
      .find((l) => l.includes('-obs"') && l.includes('WATCHDOG_VERSION='));
    expect(obsLine, 'no line appends the -obs marker').toBeDefined();
    expect(obsLine!).toMatch(/OBSERVATION.*&&.*WATCHDOG_VERSION="\$\{WATCHDOG_VERSION\}-obs"/);
    expect(shell.indexOf(srvLine!)).toBeLessThan(shell.indexOf(obsLine!));

    // Composed, in emission order.
    expect(`${SERVER_WATCHDOG_VERSION_BASE}-srv`).toBe(SERVER_WATCHDOG_VERSION_LIVE);
    expect(`${SERVER_WATCHDOG_VERSION_LIVE}-obs`).toBe(SERVER_WATCHDOG_VERSION_OBSERVING);
  });

  it('derives the PC string from ops/worker/watchdog.ps1', () => {
    const ps1 = readRepoFile('ops/worker/watchdog.ps1');
    const pc = /\$WatchdogVersion\s*=\s*'([^']+)'/.exec(ps1);
    expect(pc, 'no $WatchdogVersion assignment found').not.toBeNull();
    expect(pc![1]).toBe(PC_WATCHDOG_VERSION);
  });

  it('gives the PC no marker the server routing looks for', () => {
    // The whole discriminator rests on this: if the Windows version string ever
    // contained `-srv`, `-obs` or a `j9-` prefix, every PC fault would start
    // printing `sudo bash ...` at the member-serving machine.
    expect(PC_WATCHDOG_VERSION).not.toContain('-srv');
    expect(PC_WATCHDOG_VERSION).not.toContain('-obs');
    expect(PC_WATCHDOG_VERSION.startsWith('j9-')).toBe(false);
  });
});
